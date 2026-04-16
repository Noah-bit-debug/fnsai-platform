// content/content.js — SentrixAI Time Tracker content script
//
// Privacy rules:
//   - NEVER reads form values, passwords, input field contents, or clipboard
//   - NEVER reads page body text or DOM beyond the bare minimum metadata
//   - Strips query strings and hashes from URLs before reporting
//   - Sends only: domain, stripped URL base, and (optionally) page title

(function () {
  'use strict';

  // Only send once per page load; guard against re-injection
  if (window.__sentrixaiInjected) return;
  window.__sentrixaiInjected = true;

  /**
   * Build the safe page metadata payload.
   * urlBase = origin + pathname only — no query params, no hash, no credentials.
   */
  function buildPayload() {
    let urlBase = '';
    try {
      const u = new URL(location.href);
      urlBase = u.origin + u.pathname;
    } catch (_) {
      urlBase = location.origin + location.pathname;
    }

    return {
      type: 'PAGE_VISIT',
      domain: location.hostname,
      // Title is sent; the service worker decides whether to store it
      // based on the allowTitleTracking setting.
      title: document.title,
      urlBase,
      timestamp: Date.now(),
    };
  }

  /**
   * Send the payload to the service worker.
   * chrome.runtime.sendMessage can throw if the extension context is invalidated
   * (e.g., after an extension reload). We swallow the error silently.
   */
  function reportPageVisit() {
    try {
      chrome.runtime.sendMessage(buildPayload(), (_response) => {
        // Suppress "Could not establish connection" errors
        if (chrome.runtime.lastError) { /* intentionally ignored */ }
      });
    } catch (_) {
      // Extension context invalidated — nothing to do
    }
  }

  // Report immediately on script injection (document_idle means DOM is ready)
  reportPageVisit();

  // Also report on SPA navigation (History API pushState/replaceState)
  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _pushState(...args);
    // Brief delay to allow the page title to update after navigation
    setTimeout(reportPageVisit, 150);
  };

  history.replaceState = function (...args) {
    _replaceState(...args);
    setTimeout(reportPageVisit, 150);
  };

  window.addEventListener('popstate', () => setTimeout(reportPageVisit, 150));

  // ---------------------------------------------------------------------------
  // Listen for messages FROM the service worker (future extensibility)
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', domain: location.hostname });
    }
    // All other inbound messages are intentionally ignored
    return false;
  });
})();
