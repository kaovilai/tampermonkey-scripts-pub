// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.17
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
    try {
      return ATLASSIAN_HOST_RE.test(url);
    } catch {
      return false;
    }
  }

  function isLoggedIn() {
    // Jira: top nav present when authenticated
    if (document.querySelector('#jira-frontend, [data-testid="navigation-apps-switcher-button"]')) return true;
    // Confluence: page header present when authenticated
    if (document.querySelector('#confluence-ui, .ia-nav-header')) return true;
    return false;
  }

  const BROKEN_PAGE_PHRASES = Object.freeze([
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
    // Generic error pages
    'something went wrong',
    'if this keeps happening',
    // HTTP error indicators
    '403 forbidden',
    '401 unauthorized',
    'access denied',
    'not authorized',
  ]);

  const BROKEN_TITLE_RE = /\b(403|401|forbidden|unauthorized|access denied|error|sign in|log in)\b/i;

  // Limit scan to first 5 000 chars — error banners appear near the top and
  // scanning the full DOM text of large Atlassian pages is unnecessarily slow.
  const MAX_TEXT_SCAN = 5000;

  function pageLooksBroken() {
    if (isLoggedIn()) return false;
    if (BROKEN_TITLE_RE.test(document.title)) return true;
    const text = (document.body?.textContent || '').slice(0, MAX_TEXT_SCAN).toLowerCase();
    return BROKEN_PAGE_PHRASES.some(phrase => text.includes(phrase));
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
  let timer;
  let redirected = false;

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(debounceHandle);
    debounceHandle = null;
    clearInterval(timer);
    timer = null;
  }

  function redirectOnce() {
    if (redirected) return;
    if (isLoggedIn()) {
      cleanup();
      return;
    }
    if (!pageLooksBroken()) return;

    const target = buildLoginUrl();

    if (target && window.location.href !== target) {
      redirected = true;
      cleanup();
      window.location.replace(target);
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
    timer = setInterval(() => {
      tries += 1;
      redirectOnce();
      if (tries >= 10) cleanup();
    }, 1000);
  }

  // Re-run on SPA navigation (popstate / hashchange / pushState / replaceState)
  window.addEventListener('popstate', startRetryLoop);
  window.addEventListener('hashchange', startRetryLoop);

  // Intercept history.pushState and history.replaceState for SPA navigations
  // that don't fire popstate (e.g. Jira's React router transitions).
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      startRetryLoop();
      return result;
    };
  });

  startRetryLoop();
})();
