/**
 * Field Capture — app-shell bridge (iPhone / Android app built with Capacitor).
 *
 * The App Store / Play Store app is this same website (app.atmosphereteam.com)
 * shown in the phone's web view. Capacitor injects `window.Capacitor` into that
 * web view; this file only does anything when it is there. In a normal browser
 * it returns on the first line, so the website looks and works exactly as it
 * did.
 *
 * In the app it:
 *   - keeps the screen awake while a day is being filmed (KeepAwake plugin);
 *   - finishes the day — saving and filing what was filmed — when the phone
 *     locks, the app goes to the background, or a call takes the camera/mic,
 *     instead of leaving a recorder iOS is about to freeze;
 *   - answers navigator.geolocation from the app's own location permission
 *     (Geolocation plugin), so the crew gets the one iOS location prompt
 *     instead of a web-page prompt every time the app is opened.
 *
 * app.js announces `fieldcapture:recording-start` / `fieldcapture:recording-stop`
 * and listens for `fieldcapture:finish-now`. No other coupling.
 */
(function (global) {
  'use strict';

  var FINISH_NOTE =
    'Recording stopped when the phone locked or the app was closed. What was filmed is saved.';
  var INTERRUPT_NOTE =
    'Recording stopped when the camera or microphone was taken by another app. What was filmed is saved.';
  var MUTE_GRACE_MS = 1500;

  function nativeCapacitor(win) {
    var cap = win && win.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function') return null;
    try {
      return cap.isNativePlatform() ? cap : null;
    } catch (e) {
      return null;
    }
  }

  function hasPlugin(cap, name) {
    var headers = cap.PluginHeaders;
    if (!headers || typeof headers.length !== 'number') return false;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] && headers[i].name === name) return true;
    }
    return false;
  }

  function positionFrom(data) {
    var c = (data && data.coords) || {};
    var coords = {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy,
      altitude: c.altitude == null ? null : c.altitude,
      altitudeAccuracy: c.altitudeAccuracy == null ? null : c.altitudeAccuracy,
      heading: c.heading == null ? null : c.heading,
      speed: c.speed == null ? null : c.speed,
    };
    return { coords: coords, timestamp: (data && data.timestamp) || Date.now() };
  }

  /* GeolocationPositionError-shaped: 1 denied, 2 unavailable, 3 timeout. */
  function positionErrorFrom(err) {
    var message = String((err && (err.message || err.errorMessage)) || 'Location unavailable');
    var code = /denied|permission|restricted|not granted/i.test(message)
      ? 1
      : /time ?out|timed out/i.test(message)
        ? 3
        : 2;
    return {
      code: code,
      message: message,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
  }

  function geoOptions(opts) {
    var out = { enableHighAccuracy: Boolean(opts && opts.enableHighAccuracy) };
    if (opts && typeof opts.timeout === 'number' && isFinite(opts.timeout))
      out.timeout = opts.timeout;
    if (opts && typeof opts.maximumAge === 'number') out.maximumAge = opts.maximumAge;
    return out;
  }

  function installGeolocation(win, cap) {
    if (!hasPlugin(cap, 'Geolocation') || typeof cap.nativePromise !== 'function') return false;
    if (typeof cap.nativeCallback !== 'function' || !win.navigator) return false;
    var watches = {};
    var nextWatch = 1;
    var shim = {
      getCurrentPosition: function (success, error, opts) {
        cap.nativePromise('Geolocation', 'getCurrentPosition', geoOptions(opts)).then(
          function (data) {
            if (typeof success === 'function') success(positionFrom(data));
          },
          function (err) {
            if (typeof error === 'function') error(positionErrorFrom(err));
          },
        );
      },
      watchPosition: function (success, error, opts) {
        var id = nextWatch++;
        watches[id] = cap.nativeCallback(
          'Geolocation',
          'watchPosition',
          geoOptions(opts),
          function (data, err) {
            if (!watches[id]) return;
            if (err) {
              if (typeof error === 'function') error(positionErrorFrom(err));
              return;
            }
            if (data && typeof success === 'function') success(positionFrom(data));
          },
        );
        return id;
      },
      clearWatch: function (id) {
        var nativeId = watches[id];
        if (!nativeId) return;
        delete watches[id];
        var p = cap.nativePromise('Geolocation', 'clearWatch', { id: nativeId });
        if (p && typeof p.catch === 'function') p.catch(function () {});
      },
    };
    try {
      Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        get: function () {
          return shim;
        },
      });
      return win.navigator.geolocation === shim;
    } catch (e) {
      return false;
    }
  }

  function install(win) {
    var doc = win.document;
    var cap = nativeCapacitor(win);
    if (!cap || !doc || win.__fieldCaptureNativeBridge) return null;

    var recording = false;
    var stream = null;
    var trackCleanups = [];
    var muteTimer = null;

    function callNative(plugin, method) {
      try {
        if (typeof cap.nativePromise === 'function') {
          var p = cap.nativePromise(plugin, method, {});
          if (p && typeof p.catch === 'function') p.catch(function () {});
          return;
        }
        var plugins = cap.Plugins || {};
        if (plugins[plugin] && typeof plugins[plugin][method] === 'function') {
          var q = plugins[plugin][method]();
          if (q && typeof q.catch === 'function') q.catch(function () {});
        }
      } catch (e) {}
    }

    function finishNow(reason) {
      if (!recording) return;
      try {
        doc.dispatchEvent(
          new win.CustomEvent('fieldcapture:finish-now', { detail: { reason: reason } }),
        );
      } catch (e) {}
    }

    function clearTracks() {
      trackCleanups.forEach(function (fn) {
        try {
          fn();
        } catch (e) {}
      });
      trackCleanups = [];
      if (muteTimer) {
        win.clearTimeout(muteTimer);
        muteTimer = null;
      }
    }

    function watchTracks(s) {
      clearTracks();
      if (!s || typeof s.getTracks !== 'function') return;
      s.getTracks().forEach(function (track) {
        if (!track || typeof track.addEventListener !== 'function') return;
        var onEnded = function () {
          finishNow(INTERRUPT_NOTE);
        };
        /* A phone call or another app takes the mic/camera: the track is
           muted. Give it a moment (iOS mutes briefly on route changes). */
        var onMute = function () {
          if (muteTimer) return;
          muteTimer = win.setTimeout(function () {
            muteTimer = null;
            if (track.muted && track.readyState !== 'ended') finishNow(INTERRUPT_NOTE);
          }, MUTE_GRACE_MS);
        };
        track.addEventListener('ended', onEnded);
        track.addEventListener('mute', onMute);
        trackCleanups.push(function () {
          track.removeEventListener('ended', onEnded);
          track.removeEventListener('mute', onMute);
        });
      });
    }

    doc.addEventListener('fieldcapture:recording-start', function (ev) {
      recording = true;
      stream = (ev && ev.detail && ev.detail.stream) || null;
      watchTracks(stream);
      callNative('KeepAwake', 'keepAwake');
    });

    doc.addEventListener('fieldcapture:recording-stop', function () {
      recording = false;
      stream = null;
      clearTracks();
      callNative('KeepAwake', 'allowSleep');
    });

    /* The web view hides on lock and on leaving the app. */
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') finishNow(FINISH_NOTE);
    });

    /* Capacitor's App plugin fires `pause` as the app leaves the foreground —
       sometimes before the web view's visibilitychange. */
    try {
      if (typeof cap.addListener === 'function') {
        cap.addListener('App', 'pause', function () {
          finishNow(FINISH_NOTE);
        });
      }
    } catch (e) {}

    var nativeLocation = installGeolocation(win, cap);

    var api = {
      isRecording: function () {
        return recording;
      },
      nativeLocation: nativeLocation,
    };
    win.__fieldCaptureNativeBridge = api;
    try {
      doc.documentElement.setAttribute(
        'data-native-app',
        String(cap.getPlatform ? cap.getPlatform() : 'native'),
      );
    } catch (e) {}
    return api;
  }

  var exported = { install: install, FINISH_NOTE: FINISH_NOTE, INTERRUPT_NOTE: INTERRUPT_NOTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (global && global.document) install(global);
})(typeof window !== 'undefined' ? window : this);
