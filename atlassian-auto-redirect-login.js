// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      1.4
// @description  On Atlassian Cloud error pages, redirect to id.atlassian.com/login with dynamic continue URL
// @match        https://*.atlassian.net/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @downloadURL  https://raw.githubusercontent.com/kaovilai/tampermonkey-scripts-pub/main/atlassian-auto-redirect-login.js
// @supportURL   https://github.com/kaovilai/tampermonkey-scripts-pub
// ==/UserScript==

(function () {
  'use strict';

  const LOGIN_BASE = 'https://id.atlassian.com/login';
  const APPLICATION = 'jira';

  function pageIsLoggedIn(text) {
    return text.includes('assignee') || text.includes('reporter');
  }

  function pageLooksBroken() {
    const text = (document.body?.innerText || '').toLowerCase();
    if (pageIsLoggedIn(text)) return false;
    return (
      text.includes('log in to jira to see this work item') ||
      text.includes('something went wrong on our end') ||
      text.includes('something went wrong') ||
      text.includes('if this keeps happening')
    );
  }

  function buildLoginUrl() {
    const currentUrl = window.location.href;

    // Minimal dynamic version:
    // send the user back to exactly the page they were on after login
    const url = new URL(LOGIN_BASE);
    url.searchParams.set('continue', currentUrl);
    url.searchParams.set('application', APPLICATION);

    return url.toString();
  }

  let debounceHandle = null;
  let observer;
  let timer;

  function redirectOnce() {
    if (!pageLooksBroken()) return;

    const target = buildLoginUrl();

    if (window.location.href !== target) {
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
