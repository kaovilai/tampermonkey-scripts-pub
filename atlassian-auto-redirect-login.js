// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.27
// @description  On Atlassian Cloud error pages, redirect to id.atlassian.com/login with dynamic continue URL
// @match        https://*.atlassian.net/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @downloadURL  https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @supportURL   https://github.com/kaovilai/tampermonkey-scripts-pub
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

  const ATLASSIAN_HOST_RE = /^https:\/\/[^/]+\.atlassian\.net(\/|$)/;

  function isSafeAtlassianUrl(url) {
    return ATLASSIAN_HOST_RE.test(url);
  }

  function isLoggedIn() {
    // Jira: top nav present when authenticated
    if (document.querySelector('#jira-frontend, [data-testid="navigation-apps-switcher-button"]')) return true;
    // Confluence: page header present when authenticated
    if (document.querySelector('#confluence-ui, .ia-nav-header')) return true;
    return false;
  }

  // Definitive auth-required signals — any one of these alone justifies a redirect.
  const AUTH_PHRASES = Object.freeze([
    // Jira auth prompts
    'log in to jira to see this work item',
    'you need to log in to jira',
    // Confluence auth prompts
    'log in to confluence',
    'you need to log in to confluence',
    // Generic Atlassian session/auth
    'your session has expired',
    'sign in to continue',
    'you must be logged in',
    // HTTP error indicators
    '403 forbidden',
    '401 unauthorized',
    'access denied',
    'not authorized',
    // Additional Atlassian / generic auth prompts
    'please sign in',
    'session expired',
    'you are not logged in',
    'authentication required',
  ]);

  const BROKEN_TITLE_RE = /\b(403|401|forbidden|unauthorized|access denied|error|sign in|log in)\b/i;

  // Limit scan to first 5 000 chars — error banners appear near the top and
  // scanning the full DOM text of large Atlassian pages is unnecessarily slow.
  const MAX_TEXT_SCAN = 5000;

  function pageLooksBroken() {
    const titleBroken = BROKEN_TITLE_RE.test(document.title);
    const text = (document.body?.textContent || '').slice(0, MAX_TEXT_SCAN).toLowerCase();
    if (titleBroken) return true;
    if (AUTH_PHRASES.some(phrase => text.includes(phrase))) return true;
    return false;
  }

  function buildLoginUrl() {
    const currentUrl = window.location.href;

    if (!isSafeAtlassianUrl(currentUrl)) return null;

    const url = new URL(LOGIN_BASE);
    url.searchParams.set('continue', currentUrl);
    url.searchParams.set('application', detectApplication(currentUrl));

    return url.toString();
  }

  let debounceHandle = null;
  let observer;
  let intervalHandle;
  let redirected = false;
  let navDebounce = null;

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(debounceHandle);
    debounceHandle = null;
    clearInterval(intervalHandle);
    intervalHandle = null;
    clearTimeout(navDebounce);
    navDebounce = null;
  }

  function redirectOnce() {
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
      } catch (e) {
        // Replace failed (e.g. blocked by browser policy); allow a retry.
        redirected = false;
      }
    }
  }

  function startRetryLoop() {
    cleanup();
    redirected = false;

    const observeTarget = document.body ?? document.documentElement;
    if (observeTarget) {
      observer = new MutationObserver(() => {
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(redirectOnce, 150);
      });
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        characterData: false,
      });
    }

    redirectOnce();

    let tries = 0;
    intervalHandle = setInterval(() => {
      tries += 1;
      redirectOnce();
      if (tries >= 10) cleanup();
    }, 1000);
  }

  // Re-run on SPA navigation. hashchange and popstate can both fire for the
  // same navigation; debounce them together to avoid a redundant second loop.
  function onNavigation() {
    clearTimeout(navDebounce);
    navDebounce = setTimeout(startRetryLoop, 0);
  }
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);

  // Re-run when the user returns to an idle tab whose session may have expired
  // while they were away — the retry loop only runs for ~10 s after page load.
  // Debounce to avoid rapid restarts when the user switches tabs quickly.
  let visibilityDebounce = null;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !redirected) {
      clearTimeout(visibilityDebounce);
      visibilityDebounce = setTimeout(startRetryLoop, 200);
    }
  });

  // Intercept history.pushState and history.replaceState for SPA navigations
  // that don't fire popstate (e.g. Jira's React router transitions).
  // Only restart when the URL actually changes to avoid redundant loops
  // caused by state-only updates (e.g. replaceState with the same URL).
  // Guard against double-patching if the script is somehow injected twice.
  // Wrapped in try/catch — some hardened browsers disallow overriding history methods.
  try {
    ['pushState', 'replaceState'].forEach(method => {
      if (history[method].__atlassianRedirectPatched) return;
      const original = history[method];
      history[method] = function (...args) {
        const prevUrl = window.location.href;
        const result = original.apply(this, args);
        if (window.location.href !== prevUrl) startRetryLoop();
        return result;
      };
      history[method].__atlassianRedirectPatched = true;
    });
  } catch (e) {
    // history patching unavailable; popstate/hashchange listeners provide fallback coverage
  }

  startRetryLoop();
})();
