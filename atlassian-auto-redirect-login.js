// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.56
// @author       kaovilai
// @description  On Atlassian Cloud error pages, redirect to id.atlassian.com/login with dynamic continue URL
// @match        https://*.atlassian.net/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @downloadURL  https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @supportURL   https://github.com/kaovilai/tampermonkey-scripts-pub
// @homepageURL  https://github.com/kaovilai/tampermonkey-scripts-pub
// @icon         https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png
// ==/UserScript==

(function () {
  'use strict';

  const LOGIN_BASE = 'https://id.atlassian.com/login';
  const CONFLUENCE_PATH_RE = /^\/wiki(\/|$)/;

  function detectApplication(url) {
    try {
      return CONFLUENCE_PATH_RE.test(new URL(url).pathname) ? 'confluence' : 'jira';
    } catch {
      return 'jira';
    }
  }

  function isSafeAtlassianUrl(url) {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === 'https:' && hostname.endsWith('.atlassian.net');
    } catch {
      return false;
    }
  }

  const LOGGED_IN_SELECTOR = [
    '#jira-frontend',                                    // Jira: top nav
    '[data-testid="navigation-apps-switcher-button"]',  // Jira: app switcher
    '#confluence-ui',                                    // Confluence: page frame
    '.ia-nav-header',                                    // Confluence: nav header
  ].join(', ');

  function isLoggedIn() {
    return !!document.querySelector(LOGGED_IN_SELECTOR);
  }

  // Definitive auth-required signals — any one matching alone justifies a redirect.
  // Pre-compiled as a single RegExp so repeated DOM scans use one engine pass
  // instead of iterating through an array of string includes().
  const AUTH_RE = new RegExp([
    'log in to jira to see this work item',
    'you need to log in to jira',
    'log in to confluence',
    'you need to log in to confluence',
    'your session has expired',
    'sign in to continue',
    'you must be logged in',
    '403 forbidden',
    '401 unauthorized',
    'access denied',
    'not authorized',
    'please sign in',
    'session expired',
    'you are not logged in',
    'authentication required',
    'session timed out',
    'login required',
    'you have been logged out',
    'your login session',
    'login is required',
    'requires login',
    'saml authentication required',
    'sso login required',
    'single sign-on required',
    'identity provider',
    'idp redirect required',
    'redirecting to login',
  ].join('|'), 'i');

  const BROKEN_TITLE_RE = /\b(403|401|forbidden|unauthorized|access denied|error|sign in|log in)\b/i;

  // Limit scan to first 5 000 chars — error banners appear near the top and
  // scanning the full DOM text of large Atlassian pages is unnecessarily slow.
  const MAX_TEXT_SCAN = 5000;

  // Walk text nodes with early exit once we've collected MAX_TEXT_SCAN chars,
  // avoiding the cost of building the full textContent string for large subtrees.
  // Excludes <script> and <style> nodes to prevent false positives from inline
  // JS/CSS that may contain auth-related strings (e.g. 'loginRequired').
  // TEMPLATE contents are inert (not rendered) but still contain text nodes —
  // including them would produce false-positive auth-string matches.
  const textNodeFilter = {
    acceptNode(node) {
      return node.parentElement?.closest('script, style, noscript, template')
        ? NodeFilter.FILTER_SKIP
        : NodeFilter.FILTER_ACCEPT;
    },
  };

  function collectText(root, limit) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, textNodeFilter);
    let text = '';
    let node;
    while ((node = walker.nextNode()) !== null) {
      text += node.nodeValue;
      if (text.length >= limit) return text.slice(0, limit);
    }
    return text;
  }

  function pageLooksBroken() {
    if (BROKEN_TITLE_RE.test(document.title)) return true;

    // Always scan overlay banners (alert/dialog) independently — an auth error
    // may appear in a modal that lives outside <main>, so checking only the
    // first matched element would silently miss it.
    const overlays = document.querySelectorAll('[role="alert"], [role="dialog"]');
    for (const el of overlays) {
      if (AUTH_RE.test(collectText(el, MAX_TEXT_SCAN))) return true;
    }

    // Prefer scanning the main content area — Atlassian's nav HTML can push
    // error messages beyond MAX_TEXT_SCAN when scanning the full body.
    const mainTarget =
      document.querySelector('main, [role="main"], #main-content, #content') ??
      document.body;
    return AUTH_RE.test(collectText(mainTarget, MAX_TEXT_SCAN));
  }

  function buildLoginUrl() {
    const currentUrl = window.location.href;

    if (!isSafeAtlassianUrl(currentUrl)) return null;

    const url = new URL(LOGIN_BASE);
    url.searchParams.set('continue', currentUrl);
    url.searchParams.set('application', detectApplication(currentUrl));

    return url.toString();
  }

  const MUTATION_DEBOUNCE_MS = 150;  // DOM mutation → redirect check delay
  const POLL_INTERVAL_MS = 1000;     // polling interval after page load
  const POLL_MAX_TRIES = 10;         // stop polling after this many ticks (~10 s)
  const NAV_DEBOUNCE_MS = 100;       // SPA navigation → retry loop delay
  const VISIBILITY_DEBOUNCE_MS = 200; // tab visibility restore → retry loop delay

  const MAX_REDIRECT_FAILURES = 3;  // give up after this many consecutive replace() failures

  let debounceHandle = null;
  let observer;
  let intervalHandle;
  let redirected = false;
  let redirectFailures = 0;
  let navDebounce = null;
  let visibilityDebounce = null;

  // Stop only the polling interval and debounce — keeps the MutationObserver alive
  // so DOM changes that arrive after the poll window still trigger a redirect.
  function stopPolling() {
    clearInterval(intervalHandle);
    intervalHandle = null;
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }

  function cleanup() {
    stopPolling();
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(navDebounce);
    navDebounce = null;
    clearTimeout(visibilityDebounce);
    visibilityDebounce = null;
  }

  function redirectOnce() {
    try {
      if (redirected) return;
      const loggedIn = isLoggedIn();
      if (loggedIn) {
        cleanup();
        return;
      }
      if (!pageLooksBroken()) return;

      const target = buildLoginUrl();

      if (target && window.location.href !== target) {
        redirected = true;
        cleanup();
        try {
          window.location.replace(target);
          redirectFailures = 0;
        } catch (e) {
          // Replace failed (e.g. blocked by browser policy); restore state and
          // reschedule monitoring — cleanup() already ran, so without this the
          // script would be silently dead with no active observer or interval.
          redirected = false;
          redirectFailures += 1;
          if (redirectFailures < MAX_REDIRECT_FAILURES) {
            setTimeout(startRetryLoop, 500);
          } else {
            console.warn('[atlassian-redirect] Redirect failed repeatedly, giving up.');
          }
        }
      }
    } catch (e) {
      // Guard against unexpected DOM errors so the monitoring loop stays alive.
      console.warn('[atlassian-redirect] redirectOnce error:', e);
    }
  }

  function startRetryLoop() {
    cleanup();
    redirected = false;

    const observeTarget = document.body ?? document.documentElement;
    observer = new MutationObserver(() => {
      try {
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(redirectOnce, MUTATION_DEBOUNCE_MS);
      } catch (e) {
        console.warn('[atlassian-redirect] MutationObserver callback error:', e);
      }
    });
    // characterData is intentionally omitted: auth error messages are injected
    // as new DOM elements (childList), not as in-place text node modifications.
    // Including characterData would fire on every React text reconciliation
    // during page load, repeatedly resetting the debounce and delaying detection.
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
    });

    redirectOnce();

    let tries = 0;
    intervalHandle = setInterval(() => {
      tries += 1;
      redirectOnce();
      if (tries >= POLL_MAX_TRIES) stopPolling();
    }, POLL_INTERVAL_MS);
  }

  // Re-run on SPA navigation. hashchange and popstate can both fire for the
  // same navigation; debounce them together to avoid a redundant second loop.
  function onNavigation() {
    redirectFailures = 0;
    clearTimeout(navDebounce);
    navDebounce = setTimeout(startRetryLoop, NAV_DEBOUNCE_MS);
  }
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);

  // Re-run when the user returns to an idle tab whose session may have expired
  // while they were away — the retry loop only runs for ~10 s after page load.
  // Skip the restart if the polling interval is still active (e.g. the tab
  // became hidden and visible again within the first 10 s).
  // Debounce to avoid rapid restarts when the user switches tabs quickly.
  document.addEventListener('visibilitychange', () => {
    try {
      if (!document.hidden && !redirected && !intervalHandle && !isLoggedIn()) {
        clearTimeout(visibilityDebounce);
        visibilityDebounce = setTimeout(startRetryLoop, VISIBILITY_DEBOUNCE_MS);
      }
    } catch (e) {
      console.warn('[atlassian-redirect] visibilitychange error:', e);
    }
  });

  // Intercept history.pushState and history.replaceState for SPA navigations
  // that don't fire popstate (e.g. Jira's React router transitions).
  // Only restart when the URL actually changes to avoid redundant loops
  // caused by state-only updates (e.g. replaceState with the same URL).
  // Guard against double-patching if the script is somehow injected twice.
  // A string key is used intentionally — Symbol() creates a new unique symbol on
  // each IIFE invocation, so a symbol-based guard would fail to detect a patch
  // applied by a prior injection of this same script.
  // Wrapped in try/catch — some hardened browsers disallow overriding history methods.
  const PATCH_KEY = '__atlassianRedirectPatched';
  try {
    ['pushState', 'replaceState'].forEach(method => {
      if (history[method][PATCH_KEY]) return;
      const original = history[method];
      const patched = function (...args) {
        const prevUrl = window.location.href;
        const result = original.apply(this, args);
        if (window.location.href !== prevUrl) onNavigation();
        return result;
      };
      try {
        Object.defineProperty(patched, 'name', { value: method });
        Object.defineProperty(patched, 'length', { value: original.length });
      } catch (_) { /* best-effort — not all environments allow this */ }
      patched[PATCH_KEY] = true;
      history[method] = patched;
    });
  } catch (e) {
    // history patching unavailable; popstate/hashchange listeners provide fallback coverage
  }

  startRetryLoop();
})();
