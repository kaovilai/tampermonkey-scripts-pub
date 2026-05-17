// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.7
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

  function pageIsLoggedIn() {
    // Jira: top nav present when authenticated
    if (document.querySelector('#jira-frontend, [data-testid="navigation-apps-switcher-button"]')) return true;
    // Confluence: page header present when authenticated
    if (document.querySelector('#confluence-ui, .ia-nav-header')) return true;
    return false;
  }

  const BROKEN_PAGE_PHRASES = [
    'log in to jira to see this work item',
    'something went wrong on our end',
    'something went wrong',
    'if this keeps happening',
  ];

  function pageLooksBroken() {
    if (pageIsLoggedIn()) return false;
    const text = (document.body?.innerText || '').toLowerCase();
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

  function redirectOnce() {
    if (!pageLooksBroken()) return;

    const target = buildLoginUrl();

    if (target && window.location.href !== target) {
      cleanup();
      window.location.replace(target);
    }
  }

  function cleanup() {
    if (observer) observer.disconnect();
    clearTimeout(debounceHandle);
    clearInterval(timer);
  }

  // Debounce MutationObserver to avoid excessive calls on rapid DOM updates
  observer = new MutationObserver(() => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(redirectOnce, 150);
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Run now
  redirectOnce();

  // Retry a few times in case Atlassian renders late
  let tries = 0;
  timer = setInterval(() => {
    tries += 1;
    redirectOnce();
    if (tries >= 10) clearInterval(timer);
  }, 1000);
})();
