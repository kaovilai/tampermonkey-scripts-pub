// ==UserScript==
// @name         Atlassian error auto-redirect to login
// @namespace    tiger-tools
// @version      2.10
// @author       kaovilai
// @description  Detects Atlassian Cloud auth failures (DOM error pages, API 401/403, Navigation Timing) and redirects to id.atlassian.com/login with a dynamic continue URL
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
    if (!url) return false;
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
    'sign in to continue',
    'you must be logged in',
    '403 forbidden',
    '401 unauthorized',
    'access denied',
    'not authorized',
    'please sign in',
    'session expired',
    'authentication required',
    'session timed out',
    'login required',
    'you have been logged out',
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
    'invalid session',
    'your session is invalid',
    'session no longer active',
    'please log in to continue',
    'you need to be logged in',
    'not logged in',
    'login to continue',
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
    } catch { return 0; }
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
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH']);
  const textNodeFilter = {
    acceptNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) {
        return SKIP_TAGS.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
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
      .replace(/[\u2013\u2014]/g, '-')                 // en/em dash → hyphen
      .replace(/[\u00A0\u202F\u2009\u200B]/g, ' ');   // non-breaking/narrow/zero-width spaces → space
  }

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

    if (BROKEN_TITLE_RE.test(normalizeText(document.title))) return true;

    // Always scan overlay banners (alert/dialog) independently — an auth error
    // may appear in a modal that lives outside <main>, so checking only the
    // first matched element would silently miss it.
    // Cap at MAX_OVERLAY_SCAN to avoid slow iteration on notification-heavy pages
    // (e.g. Jira boards with many toast alerts). Auth errors appear in the first
    // few overlays so scanning a bounded subset is sufficient.
    const MAX_OVERLAY_SCAN = 10;
    const overlays = document.querySelectorAll('[role="alert"], [role="alertdialog"], [role="dialog"], [aria-live="assertive"]');
    const overlayCount = Math.min(overlays.length, MAX_OVERLAY_SCAN);
    for (let i = 0; i < overlayCount; i++) {
      try {
        if (AUTH_RE.test(normalizeText(collectText(overlays[i], MAX_TEXT_SCAN)))) return true;
      } catch (_) { /* skip malformed overlay element */ }
    }

    // Prefer scanning the main content area — Atlassian's nav HTML can push
    // error messages beyond MAX_TEXT_SCAN when scanning the full body.
    try {
      const mainTarget =
        document.querySelector('main, [role="main"], #main-content, #content') ??
        document.body ??
        document.documentElement;
      return AUTH_RE.test(normalizeText(collectText(mainTarget, MAX_TEXT_SCAN)));
    } catch (_) {
      return false;
    }
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
    // 2048-char limit; omitting it is preferable to producing a URL that silently fails.
    const candidate = new URL(url);
    candidate.searchParams.set('continue', currentUrl);
    if (candidate.toString().length <= MAX_LOGIN_URL_LENGTH) {
      url.searchParams.set('continue', currentUrl);
    } else {
      console.warn(`${LOG_PREFIX} continue URL too long (${currentUrl.length} chars) — omitting continue param`);
    }

    return url.toString();
  }

  const MUTATION_DEBOUNCE_MS = 150;  // DOM mutation → redirect check delay
  const POLL_INTERVAL_MS = 1000;     // polling interval after page load
  const POLL_MAX_TRIES = 10;         // stop polling after this many ticks (~10 s)
  const NAV_DEBOUNCE_MS = 100;       // SPA navigation → retry loop delay
  const VISIBILITY_DEBOUNCE_MS = 200; // tab visibility restore → retry loop delay

  // Delays (ms) for follow-up checks after fetch/XHR detect a 401/403.
  // The SPA may need a few render cycles before the auth-error UI appears in
  // the DOM; a single setTimeout(0) often fires before that paint.
  const API_AUTH_RETRY_DELAYS = [0, 300, 700, 1500];

  // Schedule a short burst of redirectOnce() calls when an API 401/403 is
  // observed. Uses clearTimeout + a shared handle so rapid successive API
  // errors (common on auth-gated pages that fire multiple concurrent requests)
  // collapse into a single burst rather than piling up.
  let apiRetryHandle = null;
  function scheduleRetryAfterApiError() {
    if (redirected) return;
    clearTimeout(apiRetryHandle);
    let i = 0;
    function next() {
      if (i >= API_AUTH_RETRY_DELAYS.length) { apiRetryHandle = null; return; }
      apiRetryHandle = setTimeout(() => { redirectOnce(); i++; if (!redirected) next(); }, API_AUTH_RETRY_DELAYS[i]);
    }
    next();
  }

  const MAX_REDIRECT_FAILURES = 3;  // give up after this many consecutive replace() failures

  // Cross-page-load rate limit: if this many redirects occur within the window,
  // stop redirecting for the rest of the browser session to prevent redirect loops.
  const RATE_LIMIT_KEY = 'atlassian-redirect-ts';
  const RATE_LIMIT_WINDOW_MS = 30000;
  const RATE_LIMIT_MAX = 3;

  // In-memory fallback for when sessionStorage is unavailable (e.g. strict
  // privacy mode, storage quota exceeded). Resets on page reload, so it only
  // guards within the current page session — less durable than sessionStorage
  // but far safer than failing open with no rate limiting at all.
  let _inMemoryRateLimitTimestamps = [];

  function isRedirectRateLimited() {
    const now = Date.now();
    try {
      const stored = sessionStorage.getItem(RATE_LIMIT_KEY);
      let parsed;
      try { parsed = JSON.parse(stored); } catch { parsed = null; }
      const timestamps = Array.isArray(parsed)
        ? parsed.filter(t => now - t < RATE_LIMIT_WINDOW_MS)
        : [];
      if (timestamps.length >= RATE_LIMIT_MAX) return true;
      timestamps.push(now);
      sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps));
      return false;
    } catch {
      // sessionStorage unavailable — fall back to in-memory rate limiting.
      _inMemoryRateLimitTimestamps = _inMemoryRateLimitTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
      if (_inMemoryRateLimitTimestamps.length >= RATE_LIMIT_MAX) return true;
      _inMemoryRateLimitTimestamps.push(now);
      return false;
    }
  }

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
      if (!pageLooksBroken()) return;

      const target = buildLoginUrl();

      if (!target) {
        // The current URL is not a safe Atlassian product URL (e.g. the page
        // navigated away or an excluded subdomain slipped through). There is
        // nothing to redirect to, so stop all monitoring to avoid running the
        // MutationObserver and polling interval indefinitely.
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
          console.info(`${LOG_PREFIX} Redirecting to login:`, target);
          window.location.replace(target);
        } catch (e) {
          // Replace failed (e.g. blocked by browser policy); restore state and
          // reschedule monitoring — cleanup() already ran, so without this the
          // script would be silently dead with no active observer or interval.
          redirected = false;
          redirectFailures += 1;
          if (redirectFailures < MAX_REDIRECT_FAILURES) {
            setTimeout(() => startRetryLoop(false), 500);
          } else {
            console.warn(`${LOG_PREFIX} Redirect failed repeatedly, giving up.`, e);
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
