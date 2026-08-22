/**
 * Where Field Capture talks when it is opened as a phone app.
 *
 * On the hosted office origin, same-origin `/api` is the BFF. A leftover
 * `?api=http://localhost:4000` from a laptop recipe must not follow the
 * phone onto Railway — the phone cannot reach that loopback.
 */
(function (global) {
  'use strict';

  function isLoopbackHost(host) {
    var h = String(host || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  }

  /**
   * @param {string} queryApi `?api=` value, may be empty
   * @param {string} pageHref full page URL
   * @returns {string} origin to prefix `/api`, or '' for same-origin
   */
  function resolveApiBase(queryApi, pageHref) {
    var page;
    try {
      page = new URL(pageHref);
    } catch (e) {
      return '';
    }
    if (!queryApi) return '';
    var api;
    try {
      api = new URL(queryApi, page.origin);
    } catch (e2) {
      return '';
    }
    if (isLoopbackHost(api.hostname) && !isLoopbackHost(page.hostname)) {
      return '';
    }
    return api.origin;
  }

  function displayHost(pageHref, apiBase) {
    try {
      if (apiBase) return new URL(apiBase).host;
      return new URL(pageHref).host;
    } catch (e) {
      return '';
    }
  }

  function isStandaloneDisplay() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        return true;
      }
    } catch (e) {}
    return Boolean(window.navigator && window.navigator.standalone);
  }

  global.FieldCaptureHost = {
    isLoopbackHost: isLoopbackHost,
    resolveApiBase: resolveApiBase,
    displayHost: displayHost,
    isStandaloneDisplay: isStandaloneDisplay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
