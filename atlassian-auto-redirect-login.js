// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.89
// @author       kaovilai
// @description  On Atlassian Cloud error pages, redirect to id.atlassian.com/login with dynamic continue URL
// @match        https://*.atlassian.net/*
// @match        https://*.atlassian.com/*
// @exclude      https://id.atlassian.com/*
// @exclude      https://community.atlassian.com/*
// @exclude      https://developer.atlassian.com/*
// @exclude      https://support.atlassian.com/*
// @exclude      https://marketplace.atlassian.com/*
// @exclude      https://www.atlassian.com/*
// @exclude      https://status.atlassian.com/*
// @exclude      https://trust.atlassian.com/*
// @exclude      https://api.atlassian.com/*
// @exclude      https://auth.atlassian.com/*
// @exclude      https://accounts.atlassian.com/*
// @exclude      https://blog.atlassian.com/*
// @exclude      https://design.atlassian.com/*
// @exclude      https://hello.atlassian.com/*
// @exclude      https://university.atlassian.com/*
// @exclude      https://learning.atlassian.com/*
// @exclude      https://events.atlassian.com/*
// @exclude      https://partners.atlassian.com/*
// @exclude      https://wac-cdn.atlassian.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @downloadURL  https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @supportURL   https://github.com/kaovilai/tampermonkey-scripts-pub
// @license      MIT
// @homepageURL  https://github.com/kaovilai/tampermonkey-scripts-pub
// @icon         https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png
// ==/UserScript==

(function () {
  'use strict';

  const LOGIN_BASE = 'https://id.atlassian.com/login';
  const AUTH_STATUS_CODES = new Set([401, 403]);
  const LOG_PREFIX = '[atlassian-redirect]';

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const CONFLUENCE_PATH_RE = /^\/wiki(\/|$)/;

  function detectApplication(url) {
    try {
      const parsed = new URL(url);
      if (CONFLUENCE_PATH_RE.test(parsed.pathname)) return 'confluence';
      if (parsed.hostname === 'admin.atlassian.com') return 'admin';
      return 'jira';
    } catch {
      return 'jira';
    }
  }

  // Public/non-product Atlassian subdomains that should never trigger a login
  // redirect — mirrors the @exclude list in the metadata block.
  const EXCLUDED_HOSTNAMES = new Set([
    'id.atlassian.com',
    'community.atlassian.com',
    'developer.atlassian.com',
    'support.atlassian.com',
    'marketplace.atlassian.com',
    'www.atlassian.com',
    'status.atlassian.com',
    'trust.atlassian.com',
    'api.atlassian.com',
    'auth.atlassian.com',
    'accounts.atlassian.com',
    'blog.atlassian.com',
    'design.atlassian.com',
    'hello.atlassian.com',
    'university.atlassian.com',
    'learning.atlassian.com',
    'events.atlassian.com',
    'partners.atlassian.com',
    'wac-cdn.atlassian.com',
  ]);

  function isSafeAtlassianUrl(url) {
    try {
      const { protocol, hostname } = new URL(url);
      if (protocol !== 'https:') return false;
      if (EXCLUDED_HOSTNAMES.has(hostname)) return false;
      // Allow *.atlassian.net and *.atlassian.com (product tenants).
      if (hostname.endsWith('.atlassian.net')) return true;
      if (hostname.endsWith('.atlassian.com')) return true;
      return false;
    } catch {
      return false;
    }
  }

  function isAtlassianApiUrl(url) {
    try {
      const { protocol, hostname, pathname } = new URL(url, window.location.href);
      if (protocol !== 'https:') return false;
      if (!hostname.endsWith('.atlassian.net') && !hostname.endsWith('.atlassian.com')) return false;
      return pathname.startsWith('/rest/')
        || pathname.startsWith('/wiki/rest/')
        || pathname.startsWith('/graphql')
        || pathname.startsWith('/wiki/graphql')
        || pathname.startsWith('/gateway/api/');
    } catch {
      return false;
    }
  }

  const LOGGED_IN_SELECTOR = [
    '#jira-frontend',                                    // Jira: top nav
    '[data-testid="navigation-apps-switcher-button"]',  // Jira/Confluence: app switcher
    '[data-testid="atlassian-navigation"]',             // Atlaskit nav (Jira, Confluence, Admin)
    '[data-testid="navigation-header"]',                // Jira: navigation header
    '#confluence-ui',                                    // Confluence: page frame
    '.ia-nav-header',                                    // Confluence: nav header
    '[data-testid="confluence-breadcrumbs"]',           // Confluence: page breadcrumbs
    '[data-testid="admin-home"]',                        // Admin: home page
    '#admin-portal',                                     // Admin: portal root
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
    'idp redirect required',
    "you've been signed out",
    'you have been signed out',
    'sign in to your account',
    'continue to log in',
    'your account has been signed out',
    'please log in again',
    'log back in',
    'your session is no longer valid',
    'this page requires you to log in',
    'verify your identity',
    'reauthenticate to continue',
    'token expired',
    'your token has expired',
    'invalid session',
    'your session is invalid',
  ].map(escapeRegExp).join('|'), 'i');

  // Use Navigation Timing API to detect HTTP 401/403 responses directly.
  // More reliable than text scanning for server-rendered error pages where
  // the auth error message may not match any AUTH_RE pattern.
  // responseStatus was added in Chromium 107 / Firefox 131; older browsers
  // return undefined, so the fallback (0) safely bypasses the check.
  function getNavigationHttpStatus() {
    try {
      return performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0;
    } catch { return 0; }
  }

  // "error" is intentionally excluded — it is too generic and would cause false-positive
  // redirects on non-auth error pages (e.g. 500 pages) if the logged-in DOM selectors
  // ever fail to match. The remaining terms are auth/access-specific.
  const BROKEN_TITLE_RE = /\b(403|401|forbidden|unauthorized|access denied|sign in|log in|session expired)\b/i;

  // Limit scan to first 5 000 chars — error banners appear near the top and
  // scanning the full DOM text of large Atlassian pages is unnecessarily slow.
  const MAX_TEXT_SCAN = 5000;

  // Walk text nodes with early exit once we've collected MAX_TEXT_SCAN chars,
  // avoiding the cost of building the full textContent string for large subtrees.
  // Excludes <script>, <style>, <noscript>, and <template> subtrees entirely via
  // FILTER_REJECT (skips descent into matching elements) rather than checking
  // node.parentElement.closest() on every text node (O(depth) per node).
  // Using SHOW_TEXT | SHOW_ELEMENT lets the filter see element nodes so it can
  // prune whole subtrees; FILTER_SKIP on other elements means "don't yield this
  // node but do descend", while FILTER_REJECT means "skip this subtree entirely".
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const textNodeFilter = {
    acceptNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) {
        return SKIP_TAGS.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  function collectText(root, limit) {
    if (!root) return '';
    // eslint-disable-next-line no-bitwise
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, textNodeFilter);
    let text = '';
    let node;
    try {
      while ((node = walker.nextNode()) !== null) {
        text += node.nodeValue;
        if (text.length >= limit) return text.slice(0, limit);
      }
    } catch (_) {
      // TreeWalker throws InvalidStateError if the DOM tree is mutated during
      // traversal (e.g. React reconciliation removes a node mid-walk).
      // Return whatever text was collected up to this point.
    }
    return text;
  }

  // If the page already contains a <meta http-equiv="refresh"> pointing to a
  // login URL, Atlassian's native redirect is in progress — don't interfere.
  function isAlreadyRedirecting() {
    const meta = document.querySelector('meta[http-equiv="refresh" i]');
    if (!meta) return false;
    const content = meta.getAttribute('content') ?? '';
    // content format: "N; url=https://..." — check for login-related destination
    return /url=.*(?:login|signin|sso|saml|idp)/i.test(content);
  }

  function pageLooksBroken() {
    // Fast path: HTTP status from Navigation Timing API (no DOM access needed).
    const httpStatus = getNavigationHttpStatus();
    if (AUTH_STATUS_CODES.has(httpStatus)) return true;

    if (BROKEN_TITLE_RE.test(document.title)) return true;

    // Always scan overlay banners (alert/dialog) independently — an auth error
    // may appear in a modal that lives outside <main>, so checking only the
    // first matched element would silently miss it.
    // Cap at MAX_OVERLAY_SCAN to avoid slow iteration on notification-heavy pages
    // (e.g. Jira boards with many toast alerts). Auth errors appear in the first
    // few overlays so scanning a bounded subset is sufficient.
    const MAX_OVERLAY_SCAN = 10;
    const overlays = document.querySelectorAll('[role="alert"], [role="dialog"], [aria-live="assertive"]');
    const overlayCount = Math.min(overlays.length, MAX_OVERLAY_SCAN);
    for (let i = 0; i < overlayCount; i++) {
      try {
        if (AUTH_RE.test(collectText(overlays[i], MAX_TEXT_SCAN))) return true;
      } catch (_) { /* skip malformed overlay element */ }
    }

    // Prefer scanning the main content area — Atlassian's nav HTML can push
    // error messages beyond MAX_TEXT_SCAN when scanning the full body.
    try {
      const mainTarget =
        document.querySelector('main, [role="main"], #main-content, #content') ??
        document.body ??
        document.documentElement;
      return AUTH_RE.test(collectText(mainTarget, MAX_TEXT_SCAN));
    } catch (_) {
      return false;
    }
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
  let observer = null;
  let intervalHandle = null;
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
      if (isAlreadyRedirecting()) { cleanup(); return; }
      if (!pageLooksBroken()) return;

      const target = buildLoginUrl();

      if (!target) {
        console.warn(`${LOG_PREFIX} buildLoginUrl() returned null for broken-looking page:`, window.location.href);
        return;
      }
      if (window.location.href !== target) {
        redirected = true;
        cleanup();
        try {
          window.location.replace(target);
        } catch (e) {
          // Replace failed (e.g. blocked by browser policy); restore state and
          // reschedule monitoring — cleanup() already ran, so without this the
          // script would be silently dead with no active observer or interval.
          redirected = false;
          redirectFailures += 1;
          if (redirectFailures < MAX_REDIRECT_FAILURES) {
            setTimeout(startRetryLoop, 500);
          } else {
            console.warn(`${LOG_PREFIX} Redirect failed repeatedly, giving up.`);
          }
        }
      }
    } catch (e) {
      // Guard against unexpected DOM errors so the monitoring loop stays alive.
      console.warn(`${LOG_PREFIX} redirectOnce error:`, e);
    }
  }

  function startRetryLoop(resetFailures = false) {
    cleanup();
    redirected = false;
    // Only reset the failure counter on genuine navigations (new page context),
    // not when rescheduled after a failed window.location.replace() call.
    // Resetting on every call would defeat MAX_REDIRECT_FAILURES and allow
    // infinite retries if the browser blocks the redirect repeatedly.
    if (resetFailures) redirectFailures = 0;

    const observeTarget = document.body ?? document.documentElement;
    observer = new MutationObserver(() => {
      try {
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(redirectOnce, MUTATION_DEBOUNCE_MS);
      } catch (e) {
        console.warn(`${LOG_PREFIX} MutationObserver callback error:`, e);
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
    clearTimeout(navDebounce);
    navDebounce = setTimeout(() => startRetryLoop(true), NAV_DEBOUNCE_MS);
  }
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);

  // Chrome 102+ Navigation API — fires for all SPA navigations including
  // those that don't trigger popstate (e.g. same-document navigations).
  // Complements the history.pushState/replaceState patch below.
  try {
    window.navigation?.addEventListener('navigate', (e) => {
      if (e.navigationType !== 'reload' && e.destination?.url && e.destination.url !== window.location.href) onNavigation();
    });
  } catch (_) { /* Navigation API unavailable or restricted */ }

  // Re-run when the user returns to an idle tab whose session may have expired
  // while they were away — the retry loop only runs for ~10 s after page load.
  // Skip the restart if the polling interval is still active (e.g. the tab
  // became hidden and visible again within the first 10 s).
  // Debounce to avoid rapid restarts when the user switches tabs quickly.
  document.addEventListener('visibilitychange', () => {
    try {
      if (!document.hidden && !redirected && intervalHandle === null && !isLoggedIn() && !isAlreadyRedirecting()) {
        clearTimeout(visibilityDebounce);
        if (observer === null) {
          // Both polling and observation have stopped — full restart needed.
          visibilityDebounce = setTimeout(() => startRetryLoop(true), VISIBILITY_DEBOUNCE_MS);
        } else {
          // Observer is still connected — skip teardown/reconnect and just
          // trigger a redirect check directly to avoid a brief monitoring gap.
          visibilityDebounce = setTimeout(redirectOnce, VISIBILITY_DEBOUNCE_MS);
        }
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} visibilitychange error:`, e);
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
        try {
          return original.apply(this, args);
        } finally {
          // Use finally so onNavigation() fires even if the original throws.
          if (window.location.href !== prevUrl) onNavigation();
        }
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

  // Intercept fetch() to detect 401/403 from Atlassian API endpoints in SPA
  // contexts where auth failures surface before (or without) DOM text changes.
  // Guards against double-patching when the script is injected more than once.
  try {
    if (typeof window.fetch === 'function' && !window.fetch[PATCH_KEY]) {
      const _originalFetch = window.fetch;
      const _patchedFetch = async function (...args) {
        const response = await _originalFetch.apply(this, args);
        try {
          if (AUTH_STATUS_CODES.has(response.status)
            && isAtlassianApiUrl(response.url)
            && !isLoggedIn()
            && !redirected) {
            setTimeout(redirectOnce, 0);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} fetch intercept error:`, e);
        }
        return response;
      };
      _patchedFetch[PATCH_KEY] = true;
      window.fetch = _patchedFetch;
    }
  } catch (_) { /* fetch patching unavailable */ }

  // Intercept XMLHttpRequest to detect 401/403 from Atlassian API endpoints in
  // older SPA code paths.
  try {
    if (!XMLHttpRequest.prototype.open[PATCH_KEY]) {
      const _originalXHROpen = XMLHttpRequest.prototype.open;
      const _patchedXHROpen = function (...args) {
        // Guard against listener accumulation: XHR.open() may be called more
        // than once on the same instance (e.g. connection reuse), which would
        // attach a duplicate readystatechange listener on each call.
        if (!this[PATCH_KEY]) {
          this[PATCH_KEY] = true;
          this.addEventListener('readystatechange', function () {
            try {
              if (this.readyState === XMLHttpRequest.DONE
                && AUTH_STATUS_CODES.has(this.status)
                && isAtlassianApiUrl(this.responseURL)
                && !isLoggedIn()
                && !redirected) {
                setTimeout(redirectOnce, 0);
              }
            } catch (e) {
              console.warn(`${LOG_PREFIX} XHR intercept error:`, e);
            }
          });
        }
        return _originalXHROpen.apply(this, args);
      };
      _patchedXHROpen[PATCH_KEY] = true;
      XMLHttpRequest.prototype.open = _patchedXHROpen;
    }
  } catch (_) { /* XHR patching unavailable */ }

  // Defer the DOM-dependent retry loop until the document is interactive.
  // fetch/XHR patches above are already installed at document-start so early
  // API auth failures (before DOMContentLoaded) are captured immediately.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startRetryLoop(true), { once: true });
  } else {
    startRetryLoop(true);
  }
})();
