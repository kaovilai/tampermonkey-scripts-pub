// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      2.47
// @author       kaovilai
// @description  Detects Atlassian Cloud auth failures (DOM error pages, API 401/403, Navigation Timing) and redirects to id.atlassian.com/login with a dynamic continue URL
// @match        https://*.atlassian.net/*
// @match        https://*.atlassian.com/*
// @match        https://bitbucket.org/*
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
// @exclude      https://bitbucket.org/account/*
// @exclude      https://bitbucket.org/site/*
// @exclude      https://bitbucket.org/blog/*
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
      if (parsed.hostname === 'bitbucket.org') return 'bitbucket';
      if (CONFLUENCE_PATH_RE.test(parsed.pathname)) return 'confluence';
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

  // Bitbucket URL path prefixes that are non-product pages (account settings,
  // marketing, sign-up flows) and should never trigger a login redirect.
  const EXCLUDED_BITBUCKET_PATHS = ['/account/', '/site/', '/blog/'];

  // Returns true for *.atlassian.net, *.atlassian.com, and bitbucket.org (product tenant domains).
  // Centralises the repeated suffix check used by isSafeAtlassianUrl and
  // isAtlassianApiUrl so that adding a new Atlassian TLD only requires one edit.
  function isAtlassianProductHost(hostname) {
    return hostname.endsWith('.atlassian.net') || hostname.endsWith('.atlassian.com') || hostname === 'bitbucket.org';
  }

  function isSafeAtlassianUrl(url) {
    try {
      const { protocol, hostname, pathname } = new URL(url);
      if (protocol !== 'https:') return false;
      if (EXCLUDED_HOSTNAMES.has(hostname)) return false;
      if (!isAtlassianProductHost(hostname)) return false;
      // Exclude Bitbucket non-product path prefixes (mirrors @exclude entries).
      if (hostname === 'bitbucket.org'
        && EXCLUDED_BITBUCKET_PATHS.some(p => pathname.startsWith(p))) return false;
      return true;
    } catch {
      return false;
    }
  }

  function isAtlassianApiUrl(url) {
    if (!url) return false;
    try {
      const { protocol, hostname, pathname } = new URL(url, window.location.href);
      if (protocol !== 'https:') return false;
      if (!isAtlassianProductHost(hostname)) return false;
      // Exclude non-product subdomains (mirrors EXCLUDED_HOSTNAMES) so that a
      // 401/403 from e.g. id.atlassian.com or api.atlassian.com doesn't trigger
      // a product-page login redirect.
      if (EXCLUDED_HOSTNAMES.has(hostname)) return false;
      if (hostname === 'bitbucket.org') {
        // Bitbucket REST API v2 paths
        return pathname.startsWith('/!api/2.0/')
          || pathname.startsWith('/api/2.0/')
          || pathname.startsWith('/api/internal/');
      }
      return pathname.startsWith('/rest/')
        || pathname.startsWith('/wiki/rest/')
        || pathname.startsWith('/wiki/api/')   // Confluence Cloud v2 REST API
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
    '[data-qa="account-nav-button"]',                   // Bitbucket: account nav
    '[data-testid="workspace-switcher"]',               // Bitbucket: workspace switcher
  ].join(', ');

  function isLoggedIn() {
    return !!document.querySelector(LOGGED_IN_SELECTOR);
  }

  const OVERLAY_SELECTOR = [
    '[role="alert"]',
    '[role="alertdialog"]',
    '[role="dialog"]',
    '[aria-live="assertive"]',
  ].join(', ');

  const MAIN_CONTENT_SELECTOR = 'main, [role="main"], #main-content, #content';

  const MAX_OVERLAY_SCAN = 10;

  // Definitive auth-required signals — any one matching alone justifies a redirect.
  // Pre-compiled as a single RegExp so repeated DOM scans use one engine pass
  // instead of iterating through an array of string includes().
  const AUTH_RE = new RegExp([
    'log in to jira to see this work item',
    'you need to log in to jira',
    'log in to confluence',
    'you need to log in to confluence',
    'sign in to continue',
    'you must be logged in',
    '403 forbidden',
    '401 unauthorized',
    'access denied',
    'not authorized',
    'please sign in',
    'session expired',
    'session has expired',
    'authentication required',
    'session timed out',
    'session has timed out',
    'login required',
    'you have been logged out',
    "you've been logged out",
    'your login session',
    'login is required',
    'requires login',
    'single sign-on required',
    'idp redirect required',
    "you've been signed out",
    'you have been signed out',
    'sign in to your account',
    'continue to log in',
    'your account has been signed out',
    'your account has been logged out',
    'please log in again',
    'log back in',
    'your session is no longer valid',
    'this page requires you to log in',
    'verify your identity',
    'reauthenticate to continue',
    're-authenticate',
    'token expired',
    'token has expired',
    'invalid session',
    'your session is invalid',
    'session no longer active',
    'please log in to continue',
    'you need to be logged in',
    'not logged in',
    'login to continue',
    'requires authentication',
    'authentication failed',
    'your credentials have expired',
    'credential expired',
    'your session has timed out',
    'please sign in again',
    'sign in with sso',
    'log in with sso',
    'saml authentication failed',
    'sso authentication failed',
    'identity provider error',
    'you have been inactive',
    'inactive for too long',
    'your request could not be completed because it failed security validation',
    'xsrf check failed',
    'xsrf security token missing or incorrect',
    'csrf check failed',
    'csrf token invalid',
  ].map(escapeRegExp).join('|'), 'i');

  // Use Navigation Timing API to detect HTTP 401/403 responses directly.
  // More reliable than text scanning for server-rendered error pages where
  // the auth error message may not match any AUTH_RE pattern.
  // responseStatus was added in Chromium 107 / Firefox 131; older browsers
  // return undefined, so the fallback (0) safely bypasses the check.
  // Cached after first successful read — the navigation entry is immutable once
  // the page loads, and getEntriesByType('navigation') allocates a new array on
  // every call. null means "not yet read"; 0 means "unavailable or not auth error".
  let _cachedNavHttpStatus = null;
  function getNavigationHttpStatus() {
    if (_cachedNavHttpStatus !== null) return _cachedNavHttpStatus;
    try {
      const status = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0;
      _cachedNavHttpStatus = status;
      return status;
    } catch { _cachedNavHttpStatus = 0; return 0; }
  }

  // "error" is intentionally excluded — it is too generic and would cause false-positive
  // redirects on non-auth error pages (e.g. 500 pages) if the logged-in DOM selectors
  // ever fail to match. The remaining terms are auth/access-specific.
  const BROKEN_TITLE_RE = /\b(403|401|forbidden|unauthorized|access denied|sign in|log in|session expired|authentication required|session timed out)\b/i;

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
  // SVG and MATH are excluded to avoid traversing large inline vector/formula
  // subtrees that can never contain auth error text.
  // Uses localName (always lowercase) instead of tagName so that SVG/MathML
  // elements — whose tagName is lowercase in HTML documents — are correctly
  // matched. HTML elements (SCRIPT, STYLE, etc.) also have a lowercase localName.
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math']);
  const textNodeFilter = {
    acceptNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) {
        return SKIP_TAGS.has(node.localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  // Normalize typographic/curly quotes and dashes to their ASCII equivalents
  // so AUTH_RE (which uses straight apostrophes and hyphens) reliably matches
  // Atlassian error messages that render with Unicode punctuation.
  function normalizeText(s) {
    return s
      .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")   // curly/modifier single quotes → '
      .replace(/[\u201C\u201D\u201F]/g, '"')           // curly double quotes → "
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u00AD]/g, '-') // Unicode hyphens/dashes → hyphen (includes soft hyphen)
      .replace(/[\u00A0\u202F\u2009\u200B]/g, ' ')    // non-breaking/narrow/zero-width spaces → space
      .replace(/\s+/g, ' ');                           // collapse whitespace runs so phrase matching works across newlines
  }

  function collectText(root, limit) {
    if (!root) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, textNodeFilter);
    let text = '';
    let node;
    try {
      while ((node = walker.nextNode()) !== null) {
        // Insert a space between adjacent text nodes so that phrases split
        // across sibling elements (e.g. <strong>Sign in</strong> to continue)
        // are still matchable by AUTH_RE. normalizeText() will collapse any
        // double-spaces produced by nodes that already end/start with whitespace.
        if (text.length > 0) {
          text += ' ';
          // If adding the space alone hits the limit, we're done.
          if (text.length >= limit) return text.slice(0, limit);
        }
        const value = node.nodeValue;
        const remaining = limit - text.length;
        // Avoid creating a large temporary string when a single text node would
        // push past the limit — slice node.nodeValue directly instead of
        // concatenating and then slicing the combined string.
        if (value.length >= remaining) return text + value.slice(0, remaining);
        text += value;
      }
    } catch (_) {
      // TreeWalker throws InvalidStateError if the DOM tree is mutated during
      // traversal (e.g. React reconciliation removes a node mid-walk).
      // Return whatever text was collected up to this point.
    }
    return text;
  }

  // Matches the url= portion of a <meta http-equiv="refresh"> content attribute
  // (format: "N; url=https://...") when it points to a login-related destination.
  // Extracted as a module-level constant so the RegExp is compiled once and
  // reused across all calls to isAlreadyRedirecting() / canAttemptRedirect().
  const ALREADY_REDIRECTING_RE = /url=[^,]*(?:login|signin|sso|saml|idp)/i;

  // If the page already contains a <meta http-equiv="refresh"> pointing to a
  // login URL, Atlassian's native redirect is in progress — don't interfere.
  function isAlreadyRedirecting() {
    const meta = document.querySelector('meta[http-equiv="refresh" i]');
    if (!meta) return false;
    const content = meta.getAttribute('content') ?? '';
    // content format: "N; url=https://..." — check for login-related destination
    return ALREADY_REDIRECTING_RE.test(content);
  }

  // Returns true when it is safe to attempt a redirect check.
  // Centralises the repeated guard used in event handlers to avoid drift.
  // Includes an offline check so the retry loop is never started when the
  // network is unavailable — avoids spinning up a MutationObserver and
  // setInterval that would immediately no-op in every redirectOnce() tick.
  // The `online` event handler (below) restarts the loop once connectivity
  // is restored, so no detection window is lost.
  function canAttemptRedirect() {
    return !redirected && navigator.onLine !== false && !isLoggedIn() && !isAlreadyRedirecting();
  }

  // Returns a non-empty reason string when the page looks like an auth error,
  // or null when it does not. Callers can use the reason for console logging.
  function pageLooksBroken() {
    // Fast path: HTTP status from Navigation Timing API (no DOM access needed).
    const httpStatus = getNavigationHttpStatus();
    if (AUTH_STATUS_CODES.has(httpStatus)) return `HTTP ${httpStatus} (Navigation Timing)`;

    // Fast path: an API 401/403 was observed for this page — treat as broken
    // even when the SPA renders a generic (non-auth-keyword) error UI.
    if (_apiAuthDetected) return 'API 401/403 intercepted';

    if (BROKEN_TITLE_RE.test(normalizeText(document.title))) return `broken title: "${document.title}"`;

    // Always scan overlay banners (alert/dialog) independently — an auth error
    // may appear in a modal that lives outside <main>, so checking only the
    // first matched element would silently miss it.
    // Cap at MAX_OVERLAY_SCAN to avoid slow iteration on notification-heavy pages
    // (e.g. Jira boards with many toast alerts). Auth errors appear in the first
    // few overlays so scanning a bounded subset is sufficient.
    const overlays = document.querySelectorAll(OVERLAY_SELECTOR);
    const overlayCount = Math.min(overlays.length, MAX_OVERLAY_SCAN);
    for (let i = 0; i < overlayCount; i++) {
      try {
        if (AUTH_RE.test(normalizeText(collectText(overlays[i], MAX_TEXT_SCAN)))) return `auth keyword in overlay[${i}]`;
      } catch (_) { /* skip malformed overlay element */ }
    }

    // Prefer scanning the main content area — Atlassian's nav HTML can push
    // error messages beyond MAX_TEXT_SCAN when scanning the full body.
    try {
      const mainTarget =
        document.querySelector(MAIN_CONTENT_SELECTOR) ??
        document.body ??
        document.documentElement;
      if (AUTH_RE.test(normalizeText(collectText(mainTarget, MAX_TEXT_SCAN)))) return 'auth keyword in main content';
    } catch (_) { /* ignore DOM errors */ }

    return null;
  }

  // Maximum total login-URL length. Values above this risk being silently
  // truncated or rejected by browsers and servers (common limit: 2048 chars).
  const MAX_LOGIN_URL_LENGTH = 2048;

  function buildLoginUrl() {
    const currentUrl = window.location.href;

    if (!isSafeAtlassianUrl(currentUrl)) return null;

    const url = new URL(LOGIN_BASE);
    url.searchParams.set('application', detectApplication(currentUrl));

    // Include the continue URL only when the total length stays within browser limits.
    // Long Jira filter / board URLs can push the encoded continue value well past the
    // 2048-char limit; fall back to origin+pathname (no query string) before omitting
    // the continue param entirely, so the user is at least returned to the right page.
    url.searchParams.set('continue', currentUrl);
    if (url.toString().length > MAX_LOGIN_URL_LENGTH) {
      const shortUrl = window.location.origin + window.location.pathname;
      url.searchParams.set('continue', shortUrl);
      if (url.toString().length > MAX_LOGIN_URL_LENGTH) {
        url.searchParams.delete('continue');
        console.warn(`${LOG_PREFIX} continue URL too long (${currentUrl.length} chars) — omitting continue param`);
      } else {
        console.info(`${LOG_PREFIX} continue URL truncated to path only (${currentUrl.length} chars original)`);
      }
    }

    return url.toString();
  }

  const MUTATION_DEBOUNCE_MS = 150;  // DOM mutation → redirect check delay
  const POLL_INTERVAL_MS = 1000;     // polling interval after page load
  const POLL_MAX_TRIES = 10;         // stop polling after this many ticks (~10 s)
  const NAV_DEBOUNCE_MS = 100;       // SPA navigation → retry loop delay
  const VISIBILITY_DEBOUNCE_MS = 200; // tab visibility restore → retry loop delay
  const ONLINE_DEBOUNCE_MS = 300;    // connectivity restore → retry loop delay

  // Delays (ms) for follow-up checks after fetch/XHR detect a 401/403.
  // The SPA may need a few render cycles before the auth-error UI appears in
  // the DOM; a single setTimeout(0) often fires before that paint.
  const API_AUTH_RETRY_DELAYS = [0, 300, 700, 1500];

  // Schedule a short burst of redirectOnce() calls when an API 401/403 is
  // observed. Uses clearTimeout + a shared handle so rapid successive API
  // errors (common on auth-gated pages that fire multiple concurrent requests)
  // collapse into a single burst rather than piling up.
  // Skips scheduling when offline or when a native redirect is already in
  // progress — mirrors the guards in redirectOnce() to avoid spurious
  // _apiAuthDetected activations that would outlast the current page.
  let apiRetryHandle = null;
  function scheduleRetryAfterApiError() {
    if (redirected) return;
    if (navigator.onLine === false) return;
    if (isAlreadyRedirecting()) return;
    _apiAuthDetected = true;
    clearTimeout(apiRetryHandle);
    let i = 0;
    function next() {
      if (i >= API_AUTH_RETRY_DELAYS.length) {
        apiRetryHandle = null;
        // All retries exhausted without redirecting — clear the stale flag so
        // future monitoring cycles (e.g. visibility-change or online-event
        // restarts) don't treat this transient API 401/403 as evidence of a
        // broken page and fire spurious redirect attempts.
        if (!redirected) _apiAuthDetected = false;
        return;
      }
      apiRetryHandle = setTimeout(() => { redirectOnce(); i++; if (!redirected) next(); }, API_AUTH_RETRY_DELAYS[i]);
    }
    next();
  }

  const MAX_REDIRECT_FAILURES = 3;  // give up after this many consecutive replace() failures

  // Cross-page-load rate limit: if this many redirects occur within the window,
  // stop redirecting for the rest of the browser session to prevent redirect loops.
  const RATE_LIMIT_KEY = '__tm-atlassian-redirect-ts';
  const RATE_LIMIT_WINDOW_MS = 30000;
  const RATE_LIMIT_MAX = 3;

  // In-memory fallback for when localStorage is unavailable (e.g. strict
  // privacy mode, storage quota exceeded). Resets on page reload, so it only
  // guards within the current page session — less durable than localStorage
  // but far safer than failing open with no rate limiting at all.
  let _inMemoryRateLimitTimestamps = [];
  // Set to false the first time localStorage.setItem (or getItem) throws so
  // that subsequent calls skip localStorage entirely and accumulate into
  // _inMemoryRateLimitTimestamps. Without this flag, a persistent setItem
  // failure causes every call to read the stale (un-incremented) localStorage
  // value and overwrite _inMemoryRateLimitTimestamps with only the current
  // call's timestamp — silently resetting the counter on every invocation and
  // making the rate limit ineffective.
  let _localStorageAvailable = true;

  function isRedirectRateLimited() {
    const now = Date.now();
    // localStorage is shared across all tabs of the same origin, so multiple
    // open Atlassian tabs that all detect a session expiry are collectively
    // capped at RATE_LIMIT_MAX redirects — preventing a redirect storm where
    // N tabs each independently redirect up to RATE_LIMIT_MAX times.
    let timestamps = [];
    if (_localStorageAvailable) {
      try {
        const stored = localStorage.getItem(RATE_LIMIT_KEY);
        let parsed;
        try { parsed = JSON.parse(stored); } catch { parsed = null; }
        // Validate each entry is a finite number and not in the future (guards
        // against clock skew / system-clock jumps that could lock out redirects).
        timestamps = Array.isArray(parsed)
          ? parsed.filter(t => typeof t === 'number' && Number.isFinite(t) && t <= now && now - t < RATE_LIMIT_WINDOW_MS)
          : [];
      } catch {
        // localStorage.getItem unavailable — switch to in-memory for this session.
        _localStorageAvailable = false;
      }
    }

    if (!_localStorageAvailable) {
      // Guard against future timestamps (clock skew) same as localStorage path.
      timestamps = _inMemoryRateLimitTimestamps.filter(t => t <= now && now - t < RATE_LIMIT_WINDOW_MS);
    }

    if (timestamps.length >= RATE_LIMIT_MAX) return true;
    timestamps.push(now);

    if (_localStorageAvailable) {
      try {
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps));
      } catch {
        // setItem failed (e.g. quota exceeded) — switch to in-memory permanently
        // so future calls accumulate correctly rather than re-reading the stale
        // localStorage value and discarding the history built up so far.
        _localStorageAvailable = false;
        _inMemoryRateLimitTimestamps = timestamps;
      }
    } else {
      _inMemoryRateLimitTimestamps = timestamps;
    }
    return false;
  }

  let debounceHandle = null;
  let observer = null;
  let intervalHandle = null;
  let redirected = false;
  let redirectFailures = 0;
  let navDebounce = null;
  let visibilityDebounce = null;
  let onlineDebounce = null;
  // Set to true when a 401/403 is observed from an Atlassian API endpoint.
  // Allows pageLooksBroken() to return true even when the SPA renders a generic
  // error page that doesn't contain any AUTH_RE keywords — the HTTP status code
  // from the API is authoritative evidence that the session has expired.
  // Reset on genuine SPA navigations (startRetryLoop(true)) so a stale API error
  // from the previous page doesn't trigger a redirect on the next page.
  let _apiAuthDetected = false;

  // Stop only the polling interval and debounce — keeps the MutationObserver alive
  // so DOM changes that arrive after the poll window still trigger a redirect.
  function stopPolling() {
    clearInterval(intervalHandle);
    intervalHandle = null;
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }

  // Restart a bounded polling burst without reconnecting the MutationObserver.
  // Used after connectivity/visibility restores when the observer is still active
  // but polling has already stopped — ensures delayed auth-error UI rendering is
  // caught within POLL_MAX_TRIES ticks even when no further DOM mutations occur.
  function restartPollingBurst() {
    stopPolling();
    let tries = 0;
    intervalHandle = setInterval(() => {
      tries += 1;
      redirectOnce();
      if (tries >= POLL_MAX_TRIES) stopPolling();
    }, POLL_INTERVAL_MS);
  }

  function cleanup() {
    stopPolling();
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(navDebounce);
    navDebounce = null;
    clearTimeout(visibilityDebounce);
    visibilityDebounce = null;
    clearTimeout(onlineDebounce);
    onlineDebounce = null;
    clearTimeout(apiRetryHandle);
    apiRetryHandle = null;
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
      // Skip redirect when offline — auth-like errors may surface due to network
      // unavailability rather than session expiry; redirecting to a login page
      // that cannot load would be misleading and waste a rate-limit slot.
      if (navigator.onLine === false) return;
      // Early exit if the current URL is not a safe Atlassian product URL (e.g.
      // the SPA navigated to an excluded subdomain or a non-HTTPS page). Avoids
      // the expensive pageLooksBroken() DOM scan when there is no valid redirect
      // target. buildLoginUrl() performs the same check but only after the scan.
      if (!isSafeAtlassianUrl(window.location.href)) {
        cleanup();
        return;
      }
      const brokenReason = pageLooksBroken();
      if (!brokenReason) return;

      const target = buildLoginUrl();

      if (!target) {
        // Should not normally be reached after the isSafeAtlassianUrl guard
        // above, but kept as a defensive fallback in case window.location.href
        // changes between the guard and buildLoginUrl() (e.g. a race with a
        // concurrent SPA navigation).
        console.warn(`${LOG_PREFIX} buildLoginUrl() returned null for broken-looking page:`, window.location.href);
        cleanup();
        return;
      }
      if (window.location.href !== target) {
        if (isRedirectRateLimited()) {
          console.warn(`${LOG_PREFIX} Rate limit reached — too many redirects in ${RATE_LIMIT_WINDOW_MS / 1000}s. Stopping.`);
          cleanup();
          return;
        }
        redirected = true;
        cleanup();
        try {
          console.info(`${LOG_PREFIX} Redirecting to login (reason: ${brokenReason}):`, target);
          window.location.replace(target);
        } catch (e) {
          // replace() failed (e.g. blocked by browser policy); try assign() as
          // a fallback before falling back to the retry loop.
          try {
            console.info(`${LOG_PREFIX} replace() blocked, trying assign():`, target);
            window.location.assign(target);
          } catch (e2) {
            // Both navigation methods blocked; restore state and reschedule
            // monitoring — cleanup() already ran, so without this the script
            // would be silently dead with no active observer or interval.
            redirected = false;
            redirectFailures += 1;
            if (redirectFailures < MAX_REDIRECT_FAILURES) {
              setTimeout(() => startRetryLoop(false), 500);
            } else {
              console.warn(`${LOG_PREFIX} Redirect failed repeatedly, giving up.`, e2);
            }
          }
        }
      }
    } catch (e) {
      // Guard against unexpected DOM errors so the monitoring loop stays alive.
      console.warn(`${LOG_PREFIX} redirectOnce error:`, e);
    }
  }

  // resetApiAuth defaults to resetFailures so callers that pass true/false for
  // both (genuine navigations vs. reschedules) get the existing behaviour. Pass
  // resetApiAuth=false explicitly to reset the failure counter while preserving
  // the _apiAuthDetected flag (e.g. tab visibility restore: we want fresh retries
  // but must not discard an API 401/403 that was detected while the tab was hidden).
  function startRetryLoop(resetFailures = false, resetApiAuth = resetFailures) {
    cleanup();
    redirected = false;
    // Only reset the failure counter on genuine navigations (new page context),
    // not when rescheduled after a failed window.location.replace() call.
    // Resetting on every call would defeat MAX_REDIRECT_FAILURES and allow
    // infinite retries if the browser blocks the redirect repeatedly.
    if (resetFailures) redirectFailures = 0;
    if (resetApiAuth) _apiAuthDetected = false;

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
    restartPollingBurst();
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
  // Guard with isSafeAtlassianUrl() so that our own window.location.replace()
  // to the login page does not trigger a spurious onNavigation() call that
  // would reset the monitoring loop (and `redirected`) mid-redirect.
  try {
    window.navigation?.addEventListener('navigate', (e) => {
      if (e.navigationType !== 'reload'
        && e.destination?.url
        && e.destination.url !== window.location.href
        && isSafeAtlassianUrl(e.destination.url)) onNavigation();
    });
  } catch (_) { /* Navigation API unavailable or restricted */ }

  // Re-run when the user returns to an idle tab whose session may have expired
  // while they were away — the retry loop only runs for ~10 s after page load.
  // Skip the restart if the polling interval is still active (e.g. the tab
  // became hidden and visible again within the first 10 s).
  // Debounce to avoid rapid restarts when the user switches tabs quickly.
  document.addEventListener('visibilitychange', () => {
    try {
      if (!document.hidden && canAttemptRedirect() && intervalHandle === null) {
        clearTimeout(visibilityDebounce);
        if (observer === null) {
          // Both polling and observation have stopped — full restart needed.
          // Pass resetApiAuth=false to preserve any API 401/403 flag that was
          // set while the tab was hidden (so pageLooksBroken() still returns
          // true even if the DOM error UI hasn't rendered yet on tab restore).
          visibilityDebounce = setTimeout(() => startRetryLoop(true, false), VISIBILITY_DEBOUNCE_MS);
        } else {
          // Observer is still connected — skip teardown/reconnect. Trigger an
          // immediate redirect check then restart the polling burst so that auth
          // errors whose DOM rendering is delayed (e.g. SPA state update pending)
          // are caught within the next POLL_MAX_TRIES ticks even if no further
          // DOM mutations occur.
          visibilityDebounce = setTimeout(() => {
            redirectOnce();
            if (!redirected) restartPollingBurst();
          }, VISIBILITY_DEBOUNCE_MS);
        }
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} visibilitychange error:`, e);
    }
  });

  // Re-run when connectivity is restored — a broken-looking page that was
  // skipped due to being offline should be re-evaluated once the network is back.
  // Debounced to avoid rapid restarts when connectivity toggles quickly.
  window.addEventListener('online', () => {
    try {
      if (canAttemptRedirect()) {
        clearTimeout(onlineDebounce);
        onlineDebounce = setTimeout(() => {
          if (canAttemptRedirect()) {
            if (observer === null) {
              startRetryLoop(false);
            } else {
              // Observer is active — immediate check plus a polling burst to
              // catch auth-error UI that renders a few seconds after connectivity
              // is restored (e.g. background API calls returning 401/403).
              redirectOnce();
              if (!redirected && intervalHandle === null) restartPollingBurst();
            }
          }
        }, ONLINE_DEBOUNCE_MS);
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} online event error:`, e);
    }
  });

  // Stop polling while offline to avoid wasteful no-op redirectOnce() ticks.
  // The 'online' handler above restarts monitoring once connectivity returns,
  // so no detection window is lost. The MutationObserver is intentionally kept
  // alive so that DOM changes queued during the offline period are still seen
  // once the network comes back; only the periodic polling interval is paused.
  window.addEventListener('offline', () => {
    try {
      stopPolling();
    } catch (e) {
      console.warn(`${LOG_PREFIX} offline event error:`, e);
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
    for (const method of ['pushState', 'replaceState']) {
      if (history[method][PATCH_KEY]) continue;
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
    }
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
        // Capture request URL at call time — mirrors the XHR open() capture.
        // response.url reflects the final URL after redirects and can be empty
        // for opaque (no-cors) responses; the original request URL is the reliable source.
        // args[0] may be a string, a Request object (has .url), or a URL object (has .href).
        const requestUrl = typeof args[0] === 'string' ? args[0]
          : args[0] instanceof URL ? args[0].href
          : (args[0]?.url ?? '');
        const response = await _originalFetch.apply(this, args);
        try {
          if (AUTH_STATUS_CODES.has(response.status)
            && isAtlassianApiUrl(requestUrl || response.url)
            && !isLoggedIn()
            && !redirected) {
            scheduleRetryAfterApiError();
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} fetch intercept error:`, e);
        }
        return response;
      };
      try {
        Object.defineProperty(_patchedFetch, 'name', { value: 'fetch' });
        Object.defineProperty(_patchedFetch, 'length', { value: _originalFetch.length });
      } catch (_) { /* best-effort */ }
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
          // Capture the URL at open() time rather than reading responseURL at
          // completion — responseURL can be empty for synchronous requests and
          // may point to a redirect destination instead of the original URL.
          // isAtlassianApiUrl() accepts relative URLs (resolves against window.location),
          // so using the raw args[1] value is safe here.
          const requestUrl = args[1] ?? '';
          this.addEventListener('readystatechange', function () {
            try {
              if (this.readyState === XMLHttpRequest.DONE
                && AUTH_STATUS_CODES.has(this.status)
                && isAtlassianApiUrl(requestUrl || this.responseURL)
                && !isLoggedIn()
                && !redirected) {
                scheduleRetryAfterApiError();
              }
            } catch (e) {
              console.warn(`${LOG_PREFIX} XHR intercept error:`, e);
            }
          });
        }
        return _originalXHROpen.apply(this, args);
      };
      try {
        Object.defineProperty(_patchedXHROpen, 'name', { value: 'open' });
        Object.defineProperty(_patchedXHROpen, 'length', { value: _originalXHROpen.length });
      } catch (_) { /* best-effort */ }
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
