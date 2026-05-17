// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.13
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

  const BROKEN_PAGE_PHRASES = [
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
  ];

  // Limit scan to first 5 000 chars — error banners appear near the top and
  // scanning the full DOM text of large Atlassian pages is unnecessarily slow.
  const MAX_TEXT_SCAN = 5000;

  function pageLooksBroken() {
    if (isLoggedIn()) return false;
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

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(debounceHandle);
    debounceHandle = null;
    clearInterval(timer);
    timer = null;
  }

  function redirectOnce() {
    if (isLoggedIn()) {
      cleanup();
      return;
    }
    if (!pageLooksBroken()) return;

    const target = buildLoginUrl();

    if (target && window.location.href !== target) {
      cleanup();
      window.location.replace(target);
    }
  }

  // Debounce MutationObserver to avoid excessive calls on rapid DOM updates
  observer = new MutationObserver(() => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(redirectOnce, 150);
  });

  const observeTarget = document.body ?? document.documentElement;
  if (observeTarget) {
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: false, // skip text-only mutations — structural changes are sufficient
    });
  }

  // Run now
  redirectOnce();

  // Retry a few times in case Atlassian renders late
  let tries = 0;
  timer = setInterval(() => {
    tries += 1;
    redirectOnce();
    if (tries >= 10) cleanup();
  }, 1000);
})();
