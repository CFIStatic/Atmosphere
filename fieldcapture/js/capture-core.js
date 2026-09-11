/**
 * Production capture helpers for Field Capture (no bundler).
 * Mirrors frontend/src/lib/proofCapture.ts — hash, duration, frames, geolocation.
 */
(function (global) {
  'use strict';

  var LONG_FORM_CLIENT_SECONDS = 15 * 60;
  var SAFE_HASH_BYTES = 512 * 1024 * 1024;
  /** Pocket-proof: the day film stops only after a continuous 5s hold. */
  var HOLD_TO_FINISH_MS = 5000;
  /**
   * Day-film quality cap (~720p / ~24–30fps / ~2 Mbps). Keep mic.
   * Mirrored in backend/src/media/capturePolicy.ts PREFERRED_DAY_FILM.
   */
  var DAY_FILM_MAX_WIDTH = 1280;
  var DAY_FILM_MAX_HEIGHT = 720;
  var DAY_FILM_FPS_IDEAL = 30;
  var DAY_FILM_FPS_MIN = 24;
  var DAY_FILM_VIDEO_BITS_PER_SECOND = 2000000;
  var LIVE_OFFICE_ORIGIN = 'https://platform.atmosphereteam.com';
  var FIELD_CAPTURE_HOST = /^field-capture(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
  var FIELD_CAPTURE_CUSTOM = /^(?:www\.)?app\.atmosphereteam\.com$/i;

  /**
   * Put the live camera on screen. iPhone Safari / home-screen Field Capture
   * will stay black unless the video is muted, playsinline, and play() is
   * called again after metadata arrives.
   */
  function bindLivePreview(videoEl, stream) {
    if (!videoEl || !stream) return;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    var play = function () {
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    };
    play();
    videoEl.onloadedmetadata = play;
  }

  function resolveFinishHold(input) {
    input = input || {};
    if (input.recorder) return 'live';
    if (input.demoFinish) return 'demo';
    return null;
  }

  /** The local calendar day a moment fell on — the day a film is filed under. */
  function localDateISO(ms) {
    var at = new Date(Number.isFinite(Number(ms)) ? Number(ms) : Date.now());
    var offset = at.getTimezoneOffset() * 60 * 1000;
    return new Date(at.getTime() - offset).toISOString().slice(0, 10);
  }

  function todayISO() {
    return localDateISO(Date.now());
  }

  /** One id per recording — lowercase base36, so it fits the storage path rule. */
  function newClipId() {
    var stamp = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 10);
    return (stamp + rand).replace(/[^a-z0-9]/g, '').slice(0, 32);
  }

  function isKnownDuration(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  /** First real clock. 0 and Infinity are unknown — not a 0:00 film. */
  function knownDurationSeconds() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (isKnownDuration(arguments[i])) return Number(arguments[i]);
    }
    return null;
  }

  /**
   * Spoken length after upload: 10 seconds, 50 minutes, 1 hour 20 minutes.
   */
  function formatClipLength(seconds) {
    var total = knownDurationSeconds(seconds);
    if (total == null) return '—';
    var rounded = Math.round(total);
    var hours = Math.floor(rounded / 3600);
    var minutes = Math.floor((rounded % 3600) / 60);
    var rest = rounded % 60;
    var parts = [];
    if (hours) parts.push(hours === 1 ? '1 hour' : hours + ' hours');
    if (minutes) parts.push(minutes === 1 ? '1 minute' : minutes + ' minutes');
    if (!hours && !minutes) parts.push(rest === 1 ? '1 second' : rest + ' seconds');
    else if (!hours && rest) parts.push(rest === 1 ? '1 second' : rest + ' seconds');
    return parts.join(' ');
  }

  function hashFile(file) {
    if (!global.crypto || !global.crypto.subtle) return Promise.resolve(null);
    if (file.size > SAFE_HASH_BYTES) return Promise.resolve(null);
    return file
      .arrayBuffer()
      .then(function (buf) {
        return crypto.subtle.digest('SHA-256', buf);
      })
      .then(function (digest) {
        return Array.prototype.map
          .call(new Uint8Array(digest), function (b) {
            return b.toString(16).padStart(2, '0');
          })
          .join('');
      })
      .catch(function () {
        return null;
      });
  }

  function currentPosition(timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          resolve(position);
        },
        function () {
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60 * 1000 },
      );
    });
  }

  function readDuration(file) {
    var url = URL.createObjectURL(file);
    var video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        video.ontimeupdate = null;
        video.onseeked = null;
        video.onloadedmetadata = null;
        video.onerror = null;
        URL.revokeObjectURL(url);
        resolve(value);
      };
      var measured = function () {
        return isKnownDuration(video.duration) ? video.duration : null;
      };
      var discover = function () {
        if (measured() != null) {
          finish(measured());
          return;
        }
        // MediaRecorder WebM has no duration in the header. Seek past any
        // plausible length so the browser scans to the end — a 50-minute
        // film files as 50 minutes, a 10-second clip as 10 seconds.
        var settle = function () {
          video.ontimeupdate = null;
          video.onseeked = null;
          try {
            video.currentTime = 0;
          } catch (e) {}
          finish(measured());
        };
        video.ontimeupdate = settle;
        video.onseeked = settle;
        try {
          video.currentTime = Number.MAX_SAFE_INTEGER;
        } catch (e) {
          finish(measured());
        }
      };
      video.onloadedmetadata = discover;
      video.onerror = function () {
        finish(null);
      };
      setTimeout(function () {
        finish(measured());
      }, 8000);
      if (video.readyState >= 1) discover();
    });
  }

  function grabPaintedFrame(video, maxEdge) {
    maxEdge = maxEdge || 900;
    if (!video.videoWidth) return null;
    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    if (!context) return null;
    var scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      return null;
    }
    var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    var base64 = dataUrl.split(',')[1];
    return base64 || null;
  }

  function extractFrames(file, count, maxEdge) {
    count = count || 6;
    maxEdge = maxEdge || 900;
    var url = URL.createObjectURL(file);
    var video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    return new Promise(function (resolve) {
      var done = false;
      function finish(duration, frames) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve({ durationSeconds: duration, frames: frames || [] });
      }

      function measured() {
        return isKnownDuration(video.duration) ? video.duration : null;
      }

      function firstFrameOnly(duration) {
        var grab = function () {
          var base64 = grabPaintedFrame(video, maxEdge);
          finish(duration, base64 ? [{ atSeconds: 0, base64: base64 }] : []);
        };
        if (video.readyState >= 2 && video.videoWidth) {
          grab();
          return;
        }
        video.onloadeddata = grab;
        video.onseeked = grab;
        try {
          video.currentTime = 0;
        } catch (e) {
          grab();
        }
        setTimeout(grab, 1500);
      }

      function pullAcross(duration) {
        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');
        if (!context) {
          firstFrameOnly(duration);
          return;
        }
        var frames = [];
        var i = 0;

        function next() {
          if (i >= count) {
            finish(duration, frames);
            return;
          }
          var at = duration * ((i + 0.5) / count);
          i += 1;
          var settled = false;
          var oneDone = function (ok) {
            if (settled) return;
            settled = true;
            if (ok) {
              var base64 = grabPaintedFrame(video, maxEdge);
              if (base64) frames.push({ atSeconds: Math.round(at * 100) / 100, base64: base64 });
            }
            next();
          };
          video.onseeked = function () {
            oneDone(true);
          };
          video.onerror = function () {
            oneDone(false);
          };
          setTimeout(function () {
            oneDone(false);
          }, 4000);
          try {
            video.currentTime = at;
          } catch (e) {
            oneDone(false);
          }
        }
        next();
      }

      video.onloadedmetadata = function () {
        var duration = measured();
        if (duration) {
          pullAcross(duration);
          return;
        }
        // MediaRecorder WebM: no duration in the header. Seek past any
        // plausible length so the browser scans to the end; if that still
        // yields 0:00, keep the first painted frame so the office model
        // has something to read.
        var settle = function () {
          video.ontimeupdate = null;
          video.onseeked = null;
          video.currentTime = 0;
          var d = measured();
          if (d) pullAcross(d);
          else firstFrameOnly(d);
        };
        video.ontimeupdate = settle;
        video.onseeked = settle;
        try {
          video.currentTime = Number.MAX_SAFE_INTEGER;
        } catch (e) {
          firstFrameOnly(measured());
        }
      };
      video.onerror = function () {
        finish(null, []);
      };
      setTimeout(function () {
        if (done) return;
        var d = measured();
        // A known clock means pullAcross is already seeking. Each seek has
        // its own 4s fallback, so six frames routinely exceed 5s. Restarting
        // would overwrite onseeked and finish with a single still.
        if (d) return;
        firstFrameOnly(d);
      }, 5000);
    });
  }

  function readCapture(file, opts) {
    opts = opts || {};
    var known = opts.knownSite;
    // A film that waited hours for signal must not be placed where the truck
    // is now — the caller passes noPosition once the recording is old.
    var positionP =
      known && known.lat != null && known.lon != null
        ? Promise.resolve({
            coords: {
              latitude: known.lat,
              longitude: known.lon,
              accuracy: known.accuracyM != null ? known.accuracyM : null,
            },
          })
        : opts.noPosition
          ? Promise.resolve(null)
          : currentPosition();
    // The hash does not need the clock: start it now, not after the duration probe.
    var hashP = hashFile(file);
    return readDuration(file).then(function (durationHint) {
      var longForm =
        (durationHint != null && durationHint > LONG_FORM_CLIENT_SECONDS) || file.size > 80 * 1000 * 1000;
      return Promise.all([
        positionP,
        hashP,
        longForm
          ? Promise.resolve({ durationSeconds: durationHint, frames: [] })
          : extractFrames(file),
      ]).then(function (parts) {
        var position = parts[0];
        var hash = parts[1];
        var media = parts[2];
        return {
          contentHash: hash,
          durationSeconds: knownDurationSeconds(media.durationSeconds, durationHint),
          capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
          lat: position && position.coords ? position.coords.latitude : null,
          lon: position && position.coords ? position.coords.longitude : null,
          accuracyM: position && position.coords ? position.coords.accuracy : null,
          frames: media.frames,
          hasAudio: true,
        };
      });
    });
  }


  /**
   * getUserMedia constraints for day film — ~720p, ~30fps, rear camera, mic on.
   * Used by recordDayFilm and by app.js (gesture-time acquire before POST).
   */
  function dayFilmGetUserMediaConstraints() {
    return {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: DAY_FILM_MAX_WIDTH, max: DAY_FILM_MAX_WIDTH },
        height: { ideal: DAY_FILM_MAX_HEIGHT, max: DAY_FILM_MAX_HEIGHT },
        // ideal/max only — a hard min can OverconstrainedError on odd devices
        frameRate: { ideal: DAY_FILM_FPS_IDEAL, max: DAY_FILM_FPS_IDEAL },
      },
      audio: true,
    };
  }

  /** MediaRecorder options — mime + ~2 Mbps video budget. */
  function dayFilmRecorderOptions(mimeType) {
    var opts = { videoBitsPerSecond: DAY_FILM_VIDEO_BITS_PER_SECOND };
    if (mimeType) opts.mimeType = mimeType;
    return opts;
  }

  /**
   * Record day film with camera + microphone into a Blob (webm/mp4).
   *
   * `opts.onChunk(blob, { mimeType, startedAt, index })` sees every chunk the
   * recorder hands over, in order, so a streamer can send the film while the
   * camera is still rolling. The final blob is exactly those chunks joined.
   */
  function recordDayFilm(opts) {
    opts = opts || {};
    var onTick = opts.onTick || function () {};
    var onChunk = typeof opts.onChunk === 'function' ? opts.onChunk : null;
    var videoEl = opts.videoEl || null;

    var VIDEO_TYPES = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];

    function pickMime() {
      if (!window.MediaRecorder) return null;
      for (var i = 0; i < VIDEO_TYPES.length; i++) {
        if (MediaRecorder.isTypeSupported(VIDEO_TYPES[i])) return VIDEO_TYPES[i];
      }
      return '';
    }

    var state = {
      stream: null,
      recorder: null,
      chunks: [],
      startedAt: null,
      timer: null,
      mimeType: null,
    };

    return {
      start: function () {
        if (!window.MediaRecorder) {
          return Promise.reject(new Error('MediaRecorder is not available.'));
        }
        var acquire = opts.stream
          ? Promise.resolve(opts.stream)
          : !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia
            ? Promise.reject(new Error('This browser cannot record video + audio.'))
            : navigator.mediaDevices.getUserMedia(dayFilmGetUserMediaConstraints());
        return acquire.then(function (stream) {
          if (!stream.getAudioTracks().length) {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            throw new Error('Microphone is required. Enable mic permission and try again.');
          }
          if (!stream.getVideoTracks().length) {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            throw new Error('Camera is required.');
          }
          state.stream = stream;
          bindLivePreview(videoEl, stream);
          var mime = pickMime();
          state.mimeType = mime || '';
          var recorderOpts = dayFilmRecorderOptions(mime || null);
          var recorder;
          try {
            recorder = new MediaRecorder(stream, recorderOpts);
          } catch (e) {
            /* Older engines may reject videoBitsPerSecond — retry mime-only. */
            recorder = mime
              ? new MediaRecorder(stream, { mimeType: mime })
              : new MediaRecorder(stream);
          }
          state.recorder = recorder;
          state.chunks = [];
          state.startedAt = Date.now();
          recorder.ondataavailable = function (ev) {
            if (!ev.data || !ev.data.size) return;
            state.chunks.push(ev.data);
            if (!onChunk) return;
            try {
              onChunk(ev.data, {
                mimeType: recorder.mimeType || state.mimeType || 'video/webm',
                startedAt: new Date(state.startedAt).toISOString(),
                index: state.chunks.length - 1,
              });
            } catch (e) {
              /* streaming is a head start; it must never touch the recording */
            }
          };
          recorder.start(1000);
          state.timer = setInterval(function () {
            onTick(Math.floor((Date.now() - state.startedAt) / 1000));
          }, 500);
        });
      },
      stop: function () {
        return new Promise(function (resolve, reject) {
          var recorder = state.recorder;
          if (!recorder || recorder.state === 'inactive') {
            reject(new Error('Not recording.'));
            return;
          }
          // Snapshot A/V presence before tracks are stopped in onstop.
          var hadAudio = !!(state.stream && state.stream.getAudioTracks().length);
          var hadVideo = !!(state.stream && state.stream.getVideoTracks().length);
          recorder.onstop = function () {
            if (state.timer) clearInterval(state.timer);
            var type = recorder.mimeType || state.mimeType || 'video/webm';
            var blob = new Blob(state.chunks, { type: type });
            if (state.stream) {
              state.stream.getTracks().forEach(function (t) {
                t.stop();
              });
            }
            if (videoEl) videoEl.srcObject = null;
            if (!blob.size) {
              reject(new Error('Recording was empty.'));
              return;
            }
            if (!hadAudio) {
              reject(new Error('Microphone is required. Enable mic permission and record again.'));
              return;
            }
            if (!hadVideo) {
              reject(new Error('Camera is required. Enable camera permission and record again.'));
              return;
            }
            resolve({
              blob: blob,
              mimeType: type,
              durationSeconds: Math.max(1, Math.floor((Date.now() - state.startedAt) / 1000)),
              startedAt: new Date(state.startedAt).toISOString(),
              hasAudio: true,
              hasVideo: true,
            });
          };
          recorder.stop();
        });
      },
      watchPosition: function (onSite) {
        if (!navigator.geolocation) return function () {};
        var id = navigator.geolocation.watchPosition(
          function (pos) {
            onSite({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
              label: 'On site · ±' + Math.round(pos.coords.accuracy) + ' m',
            });
          },
          function () {
            onSite({ lat: null, lon: null, accuracyM: null, label: 'Location unavailable' });
          },
          { enableHighAccuracy: true, maximumAge: 15 * 1000 },
        );
        return function () {
          navigator.geolocation.clearWatch(id);
        };
      },
    };
  }

  function apiJson(url, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (key) {
        headers[key] = opts.headers[key];
      });
    }
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (opts.accessToken) headers.Authorization = 'Bearer ' + opts.accessToken;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.text().then(function (text) {
        var body = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch (e) {
          body = {};
        }
        if (!r.ok) {
          var err = new Error(apiErrorMessage(r.status, body, text));
          err.status = r.status;
          if (body && typeof body.code === 'string') err.code = body.code;
          throw err;
        }
        return body;
      });
    });
  }

  function apiErrorMessage(status, body, text) {
    var explicit = body && typeof body.error === 'string' ? body.error.trim() : '';
    if (explicit) return explicit;
    if (status === 405 || status === 404) {
      return 'This Field Capture host is not connected to the office. Open the office Field Capture link, or try again in a moment.';
    }
    if (status === 502 || status === 503 || status === 504) {
      return 'Cannot reach the Atmosphere API right now. Wait a moment and try again.';
    }
    if (text && text.charAt(0) === '<') {
      return 'This Field Capture host is not connected to the office. Open the office Field Capture link, or try again in a moment.';
    }
    return 'Request failed.';
  }

  function origin(apiBase) {
    return (apiBase || '').replace(/\/$/, '');
  }

  /** Standalone Field Capture host — not the office /fieldcapture/ path. */
  function isStandaloneFieldCaptureHost(hostname) {
    var host = (hostname || '').replace(/:\d+$/, '');
    return FIELD_CAPTURE_HOST.test(host) || FIELD_CAPTURE_CUSTOM.test(host);
  }

  /**
   * Same-origin on the office console. On the standalone Field Capture
   * host (app.atmosphereteam.com or the Railway field-capture service),
   * talk to the live office /api so the same email + password as the
   * Platform can attach this phone to the office account.
   */
  function resolveApiBase(explicit) {
    var given = (explicit || '').trim().replace(/\/$/, '');
    if (given) return given;
    var hostname = '';
    try {
      hostname = typeof location !== 'undefined' ? location.hostname || '' : '';
    } catch (e) {
      hostname = '';
    }
    if (isStandaloneFieldCaptureHost(hostname)) return LIVE_OFFICE_ORIGIN;
    return '';
  }

  function withFieldEmbed(path) {
    if (/[?&]embed=field(?:&|$)/.test(path)) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'embed=field';
  }

  function isOfficeFieldCapturePath() {
    try {
      return /\/fieldcapture(\/|$)/.test(typeof location !== 'undefined' ? location.pathname || '' : '');
    } catch (e) {
      return false;
    }
  }

  /**
   * Local previews can iframe a local office with ?office=http://127.0.0.1:5174.
   * Production Field Capture ignores this — only loopback origins are accepted.
   */
  function localOfficeOrigin(search) {
    try {
      var raw = '';
      if (typeof search === 'string') {
        raw = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search).get('office') || '';
      } else if (typeof location !== 'undefined' && location.search) {
        raw = new URLSearchParams(location.search).get('office') || '';
      }
      if (!raw) return '';
      var url = new URL(raw, 'http://127.0.0.1/');
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '';
      return url.origin;
    } catch (e) {
      return '';
    }
  }

  /**
   * Office web console origin + path. Same-origin only when Field Capture
   * is served under /fieldcapture/ on the office host. The standalone
   * standalone Field Capture host and a local phone preview are not that
   * SPA — they point at the live office origin and stay in the phone web frame.
   */
  function resolveOfficeHref(pathname) {
    var path = pathname || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    var local = localOfficeOrigin();
    if (local) return local + path;
    var hostname = '';
    try {
      hostname = typeof location !== 'undefined' ? location.hostname || '' : '';
    } catch (e) {
      hostname = '';
    }
    if (isStandaloneFieldCaptureHost(hostname) || (hostname && !isOfficeFieldCapturePath())) {
      return LIVE_OFFICE_ORIGIN + path;
    }
    return path;
  }

  /**
   * Platform tab inside the 480px web frame. embed=field keeps the office
   * console in iframe chrome. Do not use this for top-level office pages
   * (signup, forgot password) — those leave Field Capture.
   */
  function resolveOfficePlatformHref(pathname) {
    var href = resolveOfficeHref(withFieldEmbed(pathname || '/verifier-library'));
    // New query so a phone that cached the Platform iframe document fetches
    // fresh office HTML (which then names the new hashed JS).
    if (/[?&]v=/.test(href)) return href;
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'v=no-overview-back-2';
  }

  /** Name + office invite code. No email or password. */
  function joinCrew(fullName, joinCode, apiBase) {
    return apiJson(origin(apiBase) + '/api/field-app/join', {
      method: 'POST',
      body: { fullName: fullName, joinCode: joinCode },
    });
  }

  /** Same email + password as the Atmosphere dashboard. */
  function loginWithPassword(email, password, apiBase) {
    return apiJson(origin(apiBase) + '/api/auth/login', {
      method: 'POST',
      body: { email: email, password: password },
    });
  }

  var CURRENT_TERMS_VERSION = '2026-09-10';

  function loadAuthMe(apiBase, accessToken) {
    return apiJson(origin(apiBase) + '/api/auth/me', { accessToken: accessToken });
  }

  function acceptTerms(apiBase, accessToken, version) {
    return apiJson(origin(apiBase) + '/api/auth/terms/accept', {
      method: 'POST',
      accessToken: accessToken,
      body: { acceptedTermsVersion: version || CURRENT_TERMS_VERSION },
    });
  }

  function loadFieldMe(apiBase, accessToken) {
    return apiJson(origin(apiBase) + '/api/field-app/me', { accessToken: accessToken });
  }

  /**
   * Trade the refresh token for a new session. A day queued at 8 AM and sent
   * at 5 PM has outlived its one-hour access token; filing must not.
   */
  function refreshSession(apiBase, refreshToken) {
    return apiJson(origin(apiBase) + '/api/auth/refresh', {
      method: 'POST',
      body: refreshToken ? { refreshToken: refreshToken } : {},
    }).then(function (body) {
      return body && body.session && body.session.accessToken ? body.session : null;
    });
  }

  /** Signed-in Field Capture user — join an office or start one. */
  function linkOffice(opts) {
    opts = opts || {};
    var body = {};
    if (opts.joinCode) body.joinCode = opts.joinCode;
    if (opts.orgName) body.orgName = opts.orgName;
    if (opts.fullName) body.fullName = opts.fullName;
    return apiJson(origin(opts.apiBase) + '/api/field-app/office', {
      method: 'POST',
      accessToken: opts.accessToken,
      body: body,
    });
  }

  /** After invite account=1 sign-in: several jobs → Today; one job can deep-open. */
  function preferTodayAfterInviteSignIn(jobs) {
    return Array.isArray(jobs) && jobs.length > 1;
  }

  function loadTodayJobs(apiBase, accessToken) {
    return apiJson(origin(apiBase) + '/api/field-app/today', { accessToken: accessToken }).then(
      function (body) {
        return body.jobs || [];
      },
    );
  }

  /**
   * Signed-in Field Capture: create a job from the phone form, then film it.
   */
  function createTodayJob(opts) {
    opts = opts || {};
    return apiJson(origin(opts.apiBase) + '/api/field-app/jobs', {
      method: 'POST',
      accessToken: opts.accessToken,
      body: {
        title: opts.title,
        situation: opts.situation || undefined,
      },
    }).then(function (body) {
      return body.job;
    });
  }

  function placesStatus(opts) {
    opts = opts || {};
    return apiJson(origin(opts.apiBase) + '/api/field-app/places/status', {
      accessToken: opts.accessToken,
    });
  }

  function placesAutocomplete(opts) {
    opts = opts || {};
    return apiJson(origin(opts.apiBase) + '/api/field-app/places/autocomplete', {
      method: 'POST',
      accessToken: opts.accessToken,
      body: { input: opts.input, sessionToken: opts.sessionToken },
    });
  }

  function placesDetails(opts) {
    opts = opts || {};
    return apiJson(origin(opts.apiBase) + '/api/field-app/places/details', {
      method: 'POST',
      accessToken: opts.accessToken,
      body: { placeId: opts.placeId, sessionToken: opts.sessionToken },
    });
  }

  function placesResolve(opts) {
    opts = opts || {};
    return apiJson(origin(opts.apiBase) + '/api/field-app/places/resolve', {
      method: 'POST',
      accessToken: opts.accessToken,
      body: { input: opts.input, placeId: opts.placeId, sessionToken: opts.sessionToken },
    });
  }

  var PROOF_UPLOAD_ATTEMPTS = 8;

  function nextUploadBackoffMs(attempt) {
    var n = Math.max(0, Math.floor(Number(attempt) || 0));
    return Math.min(5000, 400 * Math.pow(2, n));
  }

  function waitMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function slotPutUrl(slot, storageBase) {
    if (slot && slot.uploadUrl) return slot.uploadUrl;
    return (
      (storageBase || '') +
      '/storage/v1/object/upload/sign/job-proofs/' +
      slot.path +
      '?token=' +
      encodeURIComponent(slot.token)
    );
  }

  /** Run `fn` over `items` with at most `size` in flight; rejects on the first failure. */
  function runPool(items, size, fn) {
    var list = items.slice();
    var active = 0;
    var failed = false;
    return new Promise(function (resolve, reject) {
      function launch(item) {
        active += 1;
        Promise.resolve()
          .then(function () {
            return fn(item);
          })
          .then(
            function () {
              active -= 1;
              next();
            },
            function (err) {
              if (failed) return;
              failed = true;
              reject(err);
            },
          );
      }
      function next() {
        if (failed) return;
        if (!list.length && !active) {
          resolve();
          return;
        }
        while (active < size && list.length) launch(list.shift());
      }
      next();
    });
  }

  /** One signed URL for one slice of a film that is still being recorded. */
  function mintPartUploadUrl(opts) {
    opts = opts || {};
    var apiBase = origin(opts.apiBase);
    var url = opts.jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(opts.jobId) + '/proof/upload-part-url'
      : jobShareUrl(apiBase, opts.token, '/proof/upload-part-url');
    return apiJson(url, {
      method: 'POST',
      accessToken: opts.accessToken,
      body: {
        workDate: opts.workDate || todayISO(),
        phase: opts.phase || 'after',
        extension: opts.extension || 'webm',
        clipId: opts.clipId,
        index: opts.index,
      },
    });
  }

  /**
   * Upload day film.
   *
   * Job-share link: `{ token }` (no office login).
   * Dashboard account: `{ jobId, accessToken }` — same session as the website.
   *
   * A film that waited in the filing queue passes `workDate` and `recordedAt`
   * from the day it was filmed, `facts` it already read (hash, stills, GPS)
   * so a retry does not hash 400 MB again, and `onFacts` to keep the first
   * read even when the PUT fails.
   */
  function uploadDayFilm(opts) {
    var token = opts.token;
    var jobId = opts.jobId;
    var accessToken = opts.accessToken;
    var apiBase = origin(opts.apiBase);
    var blob = opts.blob;
    var mimeType = opts.mimeType || 'video/webm';
    var onStep = opts.onStep || function () {};
    var onProgress = opts.onProgress || function () {};
    var onFacts = opts.onFacts || function () {};
    var storageBase = opts.storageBase || '';
    var knownSite = opts.knownSite || null;
    var knownFacts = opts.facts && typeof opts.facts === 'object' ? opts.facts : null;
    var workDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.workDate || '')) ? opts.workDate : todayISO();
    var recordedMs = Date.parse(opts.recordedAt || '');

    var ext = mimeType.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var file = new File([blob], 'field-day.' + ext, {
      type: mimeType,
      lastModified: Number.isFinite(recordedMs) ? recordedMs : Date.now(),
    });

    function readFacts() {
      if (knownFacts) return Promise.resolve(knownFacts);
      return readCapture(file, { knownSite: knownSite, noPosition: Boolean(opts.noPosition) }).then(
        function (facts) {
          var duration = knownDurationSeconds(facts.durationSeconds, opts.durationSeconds);
          if (duration != null) facts.durationSeconds = duration;
          try {
            onFacts(facts);
          } catch (e) {
            /* the caller's bookkeeping must not fail the upload */
          }
          return facts;
        },
      );
    }

    var uploadPath = jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(jobId) + '/proof/upload-url'
      : jobShareUrl(apiBase, token, '/proof/upload-url');
    var completePath = jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(jobId) + '/proof/upload-complete'
      : jobShareUrl(apiBase, token, '/proof/upload-complete');
    var filePath = jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(jobId) + '/proof'
      : jobShareUrl(apiBase, token, '/proof');
    var authHeaders = accessToken ? { Authorization: 'Bearer ' + accessToken } : {};
    // One object per recording, so the next film on this job today does not
    // overwrite this one. Older office APIs ignore the field.
    var clipId = CLIP_ID.test(String(opts.clipId || '')) ? String(opts.clipId) : '';
    var stream = clipId ? streamStateOf(opts.stream) : null;
    var onStreamAdvance = opts.onStreamAdvance || function () {};

    function mintSlot() {
      return apiJson(uploadPath, {
        method: 'POST',
        accessToken: accessToken,
        headers: authHeaders,
        body: {
          workDate: workDate,
          phase: 'after',
          extension: ext,
          byteSize: file.size,
          clipId: clipId || undefined,
        },
      });
    }

    function mintPart(index) {
      return mintPartUploadUrl({
        apiBase: apiBase,
        jobId: jobId,
        token: token,
        accessToken: accessToken,
        workDate: workDate,
        extension: ext,
        clipId: clipId,
        index: index,
      });
    }

    function stitch(storagePath, partCount) {
      return apiJson(completePath, {
        method: 'POST',
        accessToken: accessToken,
        headers: authHeaders,
        body: {
          workDate: workDate,
          phase: 'after',
          storagePath: storagePath,
          partCount: partCount,
        },
      });
    }

    /**
     * Most of the film already landed while it was being recorded. Send the
     * tail from `bytesDone` as further parts, two at a time, then stitch.
     * What the office refuses to stitch (a 4xx) flags `streamFailed`, and the
     * queue sends the whole film on its next attempt instead.
     */
    function uploadStreamedTail(current) {
      var partBytes = Math.max(4096, Number(current.partBytes) || STREAM_PART_BYTES);
      var offset = Math.max(0, Math.min(file.size, Number(current.bytesDone) || 0));
      var index = Math.max(0, Math.floor(Number(current.partCount) || 0));
      var head = { bytesDone: offset, partCount: index };
      var tail = [];
      while (offset < file.size) {
        var end = Math.min(file.size, offset + partBytes);
        tail.push({ index: index, start: offset, end: end, size: end - offset });
        index += 1;
        offset = end;
      }
      var total = index;
      if (total < 2 || total > STREAM_MAX_PARTS || file.size > STREAM_MAX_BYTES) {
        var whole = new Error('Send the whole film instead.');
        whole.streamFailed = true;
        return Promise.reject(whole);
      }
      var loaded = {};
      var landed = {};
      function report() {
        var sum = 0;
        Object.keys(loaded).forEach(function (key) {
          sum += loaded[key];
        });
        onProgress(Math.max(0, Math.min(1, (head.bytesDone + sum) / file.size)));
      }
      function advance() {
        // Parts may land out of order; the queue only ever hears about the
        // contiguous prefix, so a later attempt resumes from solid ground.
        var moved = false;
        var next = tail.find(function (part) {
          return part.index === head.partCount;
        });
        while (next && landed[next.index]) {
          head.partCount += 1;
          head.bytesDone += next.size;
          moved = true;
          next = tail.find(function (part) {
            return part.index === head.partCount;
          });
        }
        if (moved) {
          try {
            onStreamAdvance({ bytesDone: head.bytesDone, partCount: head.partCount });
          } catch (e) {
            /* bookkeeping must not fail the upload */
          }
        }
      }
      onStep('Uploading…');
      report();
      return runPool(tail, 2, function (part) {
        var blob = file.slice(part.start, part.end);
        return mintPart(part.index)
          .then(function (slot) {
            if (!slot || !slot.uploadUrl) throw new Error('Upload did not go through.');
            return putBytesWithRetry(
              slot.uploadUrl,
              blob,
              mimeType,
              onStep,
              function (ratio) {
                loaded[part.index] = part.size * Math.max(0, Math.min(1, ratio || 0));
                report();
              },
              PROOF_UPLOAD_ATTEMPTS,
              function () {
                return mintPart(part.index).then(function (next) {
                  return next.uploadUrl;
                });
              },
            );
          })
          .then(function () {
            loaded[part.index] = part.size;
            landed[part.index] = true;
            advance();
            report();
          });
      }).then(function () {
        return stitch(current.path, total).then(
          function () {
            return { slot: { path: current.path } };
          },
          function (err) {
            var status = err && typeof err.status === 'number' ? err.status : 0;
            if (status >= 400 && status < 500 && status !== 401) err.streamFailed = true;
            throw err;
          },
        );
      });
    }

    // Mint the signed URL first, then read the clip and PUT bytes together so
    // hash/GPS/frames do not delay the storage transfer on truck signal. A
    // film that streamed while recording skips the mint: its head is already
    // in storage and only the tail is left.
    onStep('Uploading…');
    var slotP = stream ? Promise.resolve(null) : mintSlot();
    return slotP.then(function (slot) {
      var factsP = readFacts();
      var putP = stream
        ? uploadStreamedTail(stream)
        : putFileResumable({
            slot: slot,
            file: file,
            mimeType: mimeType,
            storageBase: storageBase,
            onStep: onStep,
            onProgress: onProgress,
            remint: mintSlot,
            complete: function (current) {
              if (!current.parts || current.parts.length < 2) return Promise.resolve(current);
              return stitch(current.path, current.parts.length).then(function () {
                return current;
              });
            },
          });

      return Promise.all([factsP, putP]).then(function (parts) {
        var facts = parts[0];
        var used = parts[1] && parts[1].slot ? parts[1].slot : slot;
        var duration = knownDurationSeconds(facts.durationSeconds, opts.durationSeconds);
        if (duration != null) facts.durationSeconds = duration;
        onStep('Uploaded');
        onProgress(1);
        return apiJson(filePath, {
          method: 'POST',
          accessToken: accessToken,
          headers: authHeaders,
          body: {
            workDate: workDate,
            phase: 'after',
            storagePath: used.path,
            byteSize: file.size,
            durationSeconds: knownDurationSeconds(facts.durationSeconds) || undefined,
            contentHash: facts.contentHash || undefined,
            capturedAt: facts.capturedAt,
            lat: facts.lat != null ? facts.lat : undefined,
            lon: facts.lon != null ? facts.lon : undefined,
            accuracyM: facts.accuracyM != null ? facts.accuracyM : undefined,
            frames: facts.frames,
          },
        }).then(function (body) {
          return {
            proof: body.proof,
            checks: body.checks || [],
            problems: body.problems || [],
            facts: facts,
          };
        });
      });
    });
  }

  function putFileResumable(opts) {
    var slot = opts.slot;
    var parts = slot.parts && slot.parts.length > 1 ? slot.parts : null;
    if (parts) {
      return putPartsWithResume(opts, 0).then(function (current) {
        return opts.complete(current).then(function () {
          return { slot: current };
        });
      });
    }
    return putBytesWithRetry(
      slotPutUrl(slot, opts.storageBase),
      opts.file,
      opts.mimeType,
      opts.onStep,
      opts.onProgress,
      PROOF_UPLOAD_ATTEMPTS,
      function () {
        return opts.remint().then(function (next) {
          slot = next;
          return slotPutUrl(next, opts.storageBase);
        });
      },
    ).then(function () {
      return { slot: slot };
    });
  }

  function putPartsWithResume(opts, startIndex) {
    var slot = opts.slot;
    var parts = slot.parts || [];
    var file = opts.file;
    var i = startIndex || 0;

    function putRemaining() {
      if (i >= parts.length) return Promise.resolve(slot);
      var part = parts[i];
      var blob = file.slice(part.start, part.end + 1);
      var base = part.start / file.size;
      var span = (part.end + 1 - part.start) / file.size;
      opts.onStep('Uploading…');
      return putBytesWithRetry(
        part.uploadUrl,
        blob,
        opts.mimeType,
        opts.onStep,
        function (ratio) {
          opts.onProgress(Math.max(0, Math.min(1, base + span * (ratio || 0))));
        },
        PROOF_UPLOAD_ATTEMPTS,
      ).then(
        function () {
          i += 1;
          opts.onProgress((part.end + 1) / file.size);
          return putRemaining();
        },
        function (err) {
          return opts.remint().then(function (next) {
            slot = next;
            parts = next.parts && next.parts.length > 1 ? next.parts : [];
            if (!parts.length) {
              return putBytesWithRetry(
                slotPutUrl(next, opts.storageBase),
                file,
                opts.mimeType,
                opts.onStep,
                opts.onProgress,
                PROOF_UPLOAD_ATTEMPTS,
              ).then(function () {
                return next;
              });
            }
            return putPartsWithResume({
              slot: next,
              file: opts.file,
              mimeType: opts.mimeType,
              storageBase: opts.storageBase,
              onStep: opts.onStep,
              onProgress: opts.onProgress,
              remint: opts.remint,
              complete: opts.complete,
            }, i);
          }).then(function (current) {
            if (current && current.path) slot = current;
            return slot;
          }, function () {
            throw err;
          });
        },
      );
    }

    return putRemaining();
  }

  /**
   * PUT bytes to signed storage with progress. Truck signal drops mid-upload,
   * so retry with backoff and a fresh URL before asking the crew to tap Retry.
   */
  function putBytesWithRetry(putUrl, file, mimeType, onStep, onProgress, attemptsLeft, remint) {
    var left = attemptsLeft == null ? PROOF_UPLOAD_ATTEMPTS : attemptsLeft;
    var attempt = 0;
    function once(url) {
      return putBytesOnce(url, file, mimeType, onProgress).then(
        function (put) {
          if (put && put.ok) return put;
          return retry(url);
        },
        function () {
          return retry(url);
        },
      );
    }
    function retry(url) {
      if (left <= 1) {
        throw new Error('Upload did not go through.');
      }
      left -= 1;
      onStep('Retrying…');
      return waitMs(nextUploadBackoffMs(attempt++)).then(function () {
        if (typeof remint !== 'function') return once(url);
        return Promise.resolve(remint()).then(function (nextUrl) {
          return once(nextUrl || url);
        });
      });
    }
    return once(putUrl);
  }

  function putBytesOnce(putUrl, file, mimeType, onProgress, control) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      if (control && typeof control === 'object') {
        control.abort = function () {
          try {
            xhr.abort();
          } catch (e) {
            /* already settled */
          }
        };
      }
      xhr.open('PUT', putUrl);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable || !file.size) return;
        onProgress(Math.max(0, Math.min(1, event.loaded / file.size)));
      };
      xhr.onload = function () {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
        });
      };
      xhr.onerror = function () {
        reject(new Error('network'));
      };
      xhr.onabort = function () {
        reject(new Error('aborted'));
      };
      xhr.send(file);
    });
  }

  function jobShareUrl(apiBase, token, suffix) {
    apiBase = (apiBase || '').replace(/\/$/, '');
    suffix = suffix || '';
    if (!token) return apiBase + '/api/job-share/session' + suffix;
    return apiBase + '/api/job-share/' + encodeURIComponent(token) + suffix;
  }

  function exchangeShareToken(token, apiBase) {
    apiBase = (apiBase || '').replace(/\/$/, '');
    return fetch(apiBase + '/api/job-share/exchange', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    })
      .then(function (r) {
        return r.ok;
      })
      .catch(function () {
        return false;
      });
  }

  function loadShareJob(token, apiBase) {
    apiBase = (apiBase || '').replace(/\/$/, '');
    return fetch(jobShareUrl(apiBase, token), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error((body && body.error) || 'Invalid or expired link.');
        return body;
      });
    });
  }

  function loadShareProofs(token, apiBase) {
    apiBase = (apiBase || '').replace(/\/$/, '');
    return fetch(jobShareUrl(apiBase, token, '/proof'), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error((body && body.error) || 'Could not load proofs.');
        return body;
      });
    });
  }

  function filterJobs(jobs, query) {
    var list = Array.isArray(jobs) ? jobs : [];
    var q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (j) {
      if (!j) return false;
      var hay = [j.name, j.addr, j.address, j.id, j.number]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  var FIELD_PENDING_JOBS_KEY = 'atm.field.pendingJobs';
  var FIELD_CACHED_JOBS_KEY = 'atm.field.cachedJobs';
  var FIELD_CACHED_ME_KEY = 'atm.field.cachedMe';
  var FIELD_CACHE_OWNER_KEY = 'atm.field.cacheOwner';
  var FIELD_CACHE_TOKEN_KEY = 'atm.field.cacheToken';

  function storageOf(store) {
    if (store) return store;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function readJsonStore(key, store) {
    try {
      var raw = storageOf(store) && storageOf(store).getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeJsonStore(key, value, store) {
    try {
      var s = storageOf(store);
      if (!s) return false;
      if (value == null) s.removeItem(key);
      else s.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readStoreString(key, store) {
    try {
      return String((storageOf(store) && storageOf(store).getItem(key)) || '');
    } catch (e) {
      return '';
    }
  }

  function writeStoreString(key, value, store) {
    try {
      var s = storageOf(store);
      if (!s) return false;
      if (!value) s.removeItem(key);
      else s.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cacheOwnerId(me) {
    var user = me && (me.user || me);
    if (!user) return '';
    return String(user.id || user.userId || user.email || '').trim();
  }

  function tokenHint(token) {
    var t = String(token || '');
    return t.length >= 12 ? t.slice(-12) : '';
  }

  function clearFieldLocalCache(store) {
    writeJsonStore(FIELD_PENDING_JOBS_KEY, null, store);
    writeJsonStore(FIELD_CACHED_JOBS_KEY, null, store);
    writeJsonStore(FIELD_CACHED_ME_KEY, null, store);
    writeStoreString(FIELD_CACHE_OWNER_KEY, '', store);
    writeStoreString(FIELD_CACHE_TOKEN_KEY, '', store);
  }

  /** Drop leftover drafts if this phone just signed in as someone else. */
  function adoptFieldCache(owner, token, store) {
    var nextOwner = String(owner || '');
    var nextHint = tokenHint(token);
    var prevOwner = readStoreString(FIELD_CACHE_OWNER_KEY, store);
    var prevHint = readStoreString(FIELD_CACHE_TOKEN_KEY, store);
    if ((prevOwner && nextOwner && prevOwner !== nextOwner) || (prevHint && nextHint && prevHint !== nextHint)) {
      clearFieldLocalCache(store);
    }
    writeStoreString(FIELD_CACHE_OWNER_KEY, nextOwner, store);
    writeStoreString(FIELD_CACHE_TOKEN_KEY, nextHint, store);
  }

  function fieldCacheMatchesSession(token, store) {
    var hint = tokenHint(token);
    var stored = readStoreString(FIELD_CACHE_TOKEN_KEY, store);
    return Boolean(hint && stored && hint === stored);
  }

  function sanitizeCachedJob(j) {
    if (!j || typeof j !== 'object') return null;
    var out = {};
    Object.keys(j).forEach(function (key) {
      if (key === 'sharePath' || key === 'shareUrl' || key === 'token' || key === 'accessToken') {
        return;
      }
      out[key] = j[key];
    });
    return out;
  }

  /** Phone-only ids — not yet a Platform job file. */
  function isLocalJobId(id) {
    var s = String(id || '');
    return s.indexOf('local-') === 0 || s.indexOf('new-') === 0;
  }

  /**
   * Name a job on the phone with zero connectivity. Recording can start
   * against this draft; the office POST happens when signal returns.
   */
  function draftFieldJob(opts) {
    opts = opts || {};
    var title = String(opts.title || opts.name || '').trim();
    var now = Date.now();
    var rand = Math.random().toString(36).slice(2, 8);
    return {
      id: 'local-' + now + '-' + rand,
      title: title,
      name: title || 'Job',
      situation: String(opts.situation || '').trim(),
      address: '',
      at: 'Today',
      placed: true,
      filmed: false,
      pending: true,
      createdAt: new Date(now).toISOString(),
    };
  }

  function readPendingJobs(store) {
    var raw = readJsonStore(FIELD_PENDING_JOBS_KEY, store);
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }

  function writePendingJobs(jobs, store) {
    writeJsonStore(FIELD_PENDING_JOBS_KEY, Array.isArray(jobs) ? jobs : [], store);
    return readPendingJobs(store);
  }

  function upsertPendingJob(job, store) {
    if (!job || !job.id) return readPendingJobs(store);
    var next = readPendingJobs(store).filter(function (j) {
      return j.id !== job.id;
    });
    next.unshift(job);
    return writePendingJobs(next, store);
  }

  function markPendingJobSynced(localId, serverJob, store) {
    var pending = readPendingJobs(store).filter(function (j) {
      return j.id !== localId;
    });
    writePendingJobs(pending, store);
    return serverJob || null;
  }

  function readCachedJobs(store) {
    var raw = readJsonStore(FIELD_CACHED_JOBS_KEY, store);
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }

  function writeCachedJobs(jobs, store) {
    var clean = (Array.isArray(jobs) ? jobs : []).map(sanitizeCachedJob).filter(Boolean);
    writeJsonStore(FIELD_CACHED_JOBS_KEY, clean, store);
    return readCachedJobs(store);
  }

  function readCachedMe(store) {
    var raw = readJsonStore(FIELD_CACHED_ME_KEY, store);
    return raw && typeof raw === 'object' ? raw : null;
  }

  function writeCachedMe(me, store) {
    writeJsonStore(FIELD_CACHED_ME_KEY, me || null, store);
    return readCachedMe(store);
  }

  /** Local drafts stay visible even when the office list is empty or stale. */
  function mergeTodayJobs(serverJobs, pendingJobs) {
    var server = Array.isArray(serverJobs) ? serverJobs.filter(Boolean) : [];
    var pending = Array.isArray(pendingJobs) ? pendingJobs.filter(Boolean) : [];
    var serverIds = {};
    server.forEach(function (j) {
      if (j && j.id) serverIds[String(j.id)] = true;
      if (j && j.serverId) serverIds[String(j.serverId)] = true;
    });
    var extras = pending.filter(function (j) {
      if (!j) return false;
      if (j.serverId && serverIds[String(j.serverId)]) return false;
      if (j.id && serverIds[String(j.id)]) return false;
      return isLocalJobId(j.id) || j.pending;
    });
    return extras.concat(server);
  }

  function isTransientNetworkError(err) {
    if (!err) return false;
    var status = err.status;
    if (status === 502 || status === 503 || status === 504) return true;
    if (typeof status === 'number' && status >= 400 && status < 500) return false;
    var msg = String(err.message || err.name || '').toLowerCase();
    return (
      status == null ||
      status === 0 ||
      msg.indexOf('failed to fetch') >= 0 ||
      msg.indexOf('network') >= 0 ||
      msg.indexOf('offline') >= 0 ||
      msg.indexOf('load failed') >= 0 ||
      msg.indexOf('internet') >= 0
    );
  }

  /** Same marketing contact form Platform Support and /hardware Support open. */
  var CONTACT_PUBLIC_URL = 'https://atmosphereteam.com/contact.html';
  var FIELD_CAPTURE_SUPPORT_NOTE = 'I need help with Atmosphere Field Capture.';
  var SUPPORT_SECRET_PARAMS = ['token', 'share', 'access_token', 'refresh_token', 'code'];

  function compactSupportLine(label, value) {
    var trimmed = value == null ? '' : String(value).trim();
    return trimmed ? label + ': ' + trimmed : null;
  }

  function fieldCaptureSupportPath(loc) {
    loc = loc || (typeof location !== 'undefined' ? location : null);
    if (!loc) return '/';
    var path = String(loc.pathname || '/') || '/';
    var search = String(loc.search || '');
    if (search && search.charAt(0) === '?') {
      try {
        var params = new URLSearchParams(search);
        SUPPORT_SECRET_PARAMS.forEach(function (key) {
          params.delete(key);
        });
        var kept = params.toString();
        search = kept ? '?' + kept : '';
      } catch (err) {
        search = '';
      }
    }
    var hash = String(loc.hash || '');
    return path + search + hash;
  }

  /** Prefill note for the shared contact form, with Field Capture context. */
  function buildFieldCaptureSupportNote(ctx) {
    ctx = ctx || {};
    var orgName = ctx.orgName == null ? '' : String(ctx.orgName).trim();
    var orgId = ctx.orgId == null ? '' : String(ctx.orgId).trim();
    var org = orgName && orgId ? orgName + ' (' + orgId + ')' : orgName || (orgId ? '(' + orgId + ')' : null);
    var details = [
      compactSupportLine('Organization', org),
      compactSupportLine('Page', ctx.path),
      compactSupportLine('Email', ctx.email),
    ].filter(Boolean);
    if (details.length === 0) return FIELD_CAPTURE_SUPPORT_NOTE;
    return FIELD_CAPTURE_SUPPORT_NOTE + '\n\n' + details.join('\n');
  }

  function buildFieldCaptureSupportUrl(ctx) {
    ctx = ctx || {};
    var url = new URL(CONTACT_PUBLIC_URL);
    url.searchParams.set('note', buildFieldCaptureSupportNote(ctx));
    var email = ctx.email == null ? '' : String(ctx.email).trim();
    var name = ctx.name == null ? '' : String(ctx.name).trim();
    var company = ctx.orgName == null ? '' : String(ctx.orgName).trim();
    if (email) url.searchParams.set('email', email);
    if (name) url.searchParams.set('name', name);
    if (company) url.searchParams.set('company', company);
    return url.toString();
  }

  /* ---------- upload while recording ----------
     MediaRecorder hands over a chunk every second. The streamer groups them
     into parts of ~8 MB and PUTs each one to its own signed URL while the
     camera keeps rolling — one part at a time, strictly in order. By
     hold-to-finish most of the film is already in storage; the queue sends
     the tail and asks the office to stitch. This is a head start, never the
     record of truth: any failure just stops streaming, and the queue sends
     everything from `bytesDone` on. */

  var CLIP_ID = /^[a-z0-9]{6,32}$/;
  var STREAM_PART_BYTES = 8 * 1024 * 1024;
  var STREAM_MAX_BYTES = 512 * 1024 * 1024;
  var STREAM_MAX_PARTS = 128;
  var STREAM_FINISH_WAIT_MS = 20 * 1000;

  /** What the queue keeps about a film's streamed head, or null when there is none. */
  function streamStateOf(raw) {
    if (!raw || !raw.path || !(Number(raw.partCount) >= 1)) return null;
    return {
      path: String(raw.path),
      partCount: Math.floor(Number(raw.partCount)),
      bytesDone: Math.max(0, Math.floor(Number(raw.bytesDone) || 0)),
      partBytes: Math.max(4096, Math.floor(Number(raw.partBytes) || STREAM_PART_BYTES)),
    };
  }

  function createDayFilmStreamer(cfg) {
    cfg = cfg || {};
    var mint = cfg.mint;
    var put = cfg.put || putBytesOnce;
    var partBytes = Math.max(4096, Number(cfg.partBytes) || STREAM_PART_BYTES);
    var maxBytes = Number(cfg.maxBytes) || STREAM_MAX_BYTES;
    var maxParts = Number(cfg.maxParts) || STREAM_MAX_PARTS;
    var mimeType = cfg.mimeType || 'video/webm';
    var onChange = cfg.onChange || function () {};
    var wait = cfg.wait || waitMs;
    var timers = cfg.timers || {
      setTimeout: function (fn, ms) {
        return setTimeout(fn, ms);
      },
      clearTimeout: function (id) {
        clearTimeout(id);
      },
    };
    var finishWaitMs = Number(cfg.finishWaitMs) || STREAM_FINISH_WAIT_MS;

    var pending = [];
    var pendingBytes = 0;
    var queue = [];
    var landed = 0;
    var bytesDone = 0;
    var bytesSeen = 0;
    var path = '';
    var sending = null;
    var stopped = false;
    var broken = '';
    var settle = null;

    function snapshot() {
      return {
        path: path,
        partCount: landed,
        bytesDone: bytesDone,
        bytesSeen: bytesSeen,
        partBytes: partBytes,
        inFlight: Boolean(sending),
        broken: broken,
      };
    }

    function changed() {
      try {
        onChange(snapshot());
      } catch (e) {
        /* a paint error must never touch the recording */
      }
    }

    function giveUp(reason) {
      if (broken) return;
      broken = String(reason || 'Streaming stopped.');
      queue = [];
      pending = [];
      pendingBytes = 0;
      changed();
    }

    function finishSettled() {
      if (!settle) return;
      var fn = settle;
      settle = null;
      fn(snapshot());
    }

    function push(chunk) {
      if (stopped || broken || !chunk || !chunk.size) return;
      pending.push(chunk);
      pendingBytes += chunk.size;
      bytesSeen += chunk.size;
      if (bytesSeen > maxBytes) {
        giveUp('Too long to send while filming.');
        return;
      }
      if (pendingBytes >= partBytes) cut();
    }

    function cut() {
      if (!pendingBytes || broken) return;
      var index = landed + queue.length;
      // Leave room for the tail: the queue needs at least one more index.
      if (index >= maxParts - 1) {
        giveUp('Too many parts to stitch.');
        return;
      }
      var blob = new Blob(pending, { type: mimeType });
      pending = [];
      pendingBytes = 0;
      queue.push({ index: index, blob: blob, size: blob.size });
      pump();
    }

    function pump() {
      if (sending || broken || stopped || !queue.length) return;
      var part = queue[0];
      var control = {};
      sending = { part: part, control: control };
      var attempt = 0;
      function once() {
        return Promise.resolve()
          .then(function () {
            return mint(part.index);
          })
          .then(function (slot) {
            if (!slot || !slot.uploadUrl) throw new Error('No upload URL.');
            if (slot.path) path = String(slot.path);
            return put(slot.uploadUrl, part.blob, mimeType, function () {}, control);
          })
          .then(function (res) {
            if (!res || !res.ok) throw new Error('Part did not land.');
          });
      }
      function landedOk() {
        sending = null;
        if (broken) {
          finishSettled();
          return;
        }
        // One part in flight at a time, so the landed prefix stays contiguous.
        queue.shift();
        landed += 1;
        bytesDone += part.size;
        changed();
        if (stopped) {
          finishSettled();
          return;
        }
        pump();
      }
      function failed(err) {
        attempt += 1;
        if (attempt < 3 && !stopped && !broken) {
          return wait(1500 * attempt).then(once).then(landedOk, failed);
        }
        sending = null;
        if (!stopped) giveUp((err && err.message) || 'Streaming stopped.');
        else changed();
        finishSettled();
        return undefined;
      }
      once().then(landedOk, failed);
    }

    /**
     * Recording stopped. Chunks that have not landed are NOT sent from here —
     * they are the tail the queue sends, with retries. `settled` resolves once
     * the part in flight has landed or given up, capped so the door is never
     * held: past the cap the PUT is aborted and the tail simply starts earlier.
     */
    function finish() {
      stopped = true;
      var snap = snapshot();
      var settled = new Promise(function (resolve) {
        if (!sending) {
          resolve(snapshot());
          return;
        }
        var timer = timers.setTimeout(function () {
          if (sending && sending.control && typeof sending.control.abort === 'function') {
            sending.control.abort();
          }
        }, finishWaitMs);
        settle = function (final) {
          timers.clearTimeout(timer);
          resolve(final);
        };
      });
      return { snapshot: snap, settled: settled };
    }

    return { push: push, finish: finish, snapshot: snapshot };
  }

  /* ---------- day films waiting for the office ----------
     Hold-to-finish hands the film here and the crew is done: the door says
     so, Today opens, the next day can start while this one is still going.
     The queue files one film at a time, oldest first — full bandwidth per
     film, so each one lands fast when signal is there — and waits, rather
     than fails, when it is not. IndexedDB keeps the bytes so a killed tab, a
     reload, or a dead battery does not lose the day; a phone that refuses
     IndexedDB keeps the film in memory and the Today strip says to keep
     Field Capture open. */

  var DAY_FILM_DB_NAME = 'atm.field.dayFilms';
  var DAY_FILM_DB_VERSION = 1;
  var DAY_FILM_META_STORE = 'films';
  var DAY_FILM_BYTES_STORE = 'bytes';
  var FILING_RETRY_BASE_MS = 5000;
  var FILING_RETRY_CAP_MS = 60 * 1000;
  var WAITING_FOR_SIGNAL = 'Waiting for signal…';
  /** Past this age, an unplaced film is not stamped with wherever the phone is now. */
  var POSITION_FRESH_MS = 10 * 60 * 1000;

  /** Between whole filing attempts: 5s, 10s, 20s, 40s, then every minute. */
  function nextFilingBackoffMs(attempt) {
    var n = Math.max(0, Math.floor(Number(attempt) || 0));
    return Math.min(FILING_RETRY_CAP_MS, FILING_RETRY_BASE_MS * Math.pow(2, n));
  }

  function siteOf(site) {
    if (!site || site.lat == null || site.lon == null) return null;
    return {
      lat: Number(site.lat),
      lon: Number(site.lon),
      accuracyM: site.accuracyM != null ? Number(site.accuracyM) : null,
    };
  }

  /** One recorded day, as the queue holds it. `blob` is the film itself. */
  function newDayFilmEntry(input) {
    input = input || {};
    var now = Date.now();
    var blob = input.blob || null;
    var draft = input.jobDraft && input.jobDraft.title ? input.jobDraft : null;
    return {
      id: input.id || 'film-' + now + '-' + Math.random().toString(36).slice(2, 8),
      owner: String(input.owner || ''),
      mode: input.mode === 'share' ? 'share' : 'account',
      jobId: input.jobId != null ? String(input.jobId) : '',
      jobName: String(input.jobName || ''),
      jobDraft: draft
        ? { title: String(draft.title), situation: String(draft.situation || '') }
        : null,
      blob: blob,
      mimeType: String(input.mimeType || (blob && blob.type) || 'video/webm'),
      byteSize:
        blob && typeof blob.size === 'number' ? blob.size : Math.max(0, Number(input.byteSize) || 0),
      durationSeconds: knownDurationSeconds(input.durationSeconds),
      recordedAt: input.recordedAt || new Date(now).toISOString(),
      workDate: input.workDate || todayISO(),
      site: siteOf(input.site),
      facts: input.facts || null,
      clipId: CLIP_ID.test(String(input.clipId || '')) ? String(input.clipId) : newClipId(),
      stream: streamStateOf(input.stream),
      status: 'queued',
      attempts: 0,
      lastError: '',
      lastStatus: 0,
      nextAttemptAt: 0,
      volatile: false,
    };
  }

  function metaOf(entry) {
    var out = {};
    Object.keys(entry || {}).forEach(function (key) {
      if (key === 'blob') return;
      out[key] = entry[key];
    });
    return out;
  }

  function byRecordedAt(a, b) {
    var ta = Date.parse((a && a.recordedAt) || '') || 0;
    var tb = Date.parse((b && b.recordedAt) || '') || 0;
    if (ta !== tb) return ta - tb;
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  }

  function isPendingFilm(entry) {
    return Boolean(entry) && entry.status !== 'filed';
  }

  function idbOpen(idb) {
    if (!idb || typeof idb.open !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var req;
      try {
        req = idb.open(DAY_FILM_DB_NAME, DAY_FILM_DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DAY_FILM_META_STORE)) {
          db.createObjectStore(DAY_FILM_META_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DAY_FILM_BYTES_STORE)) {
          db.createObjectStore(DAY_FILM_BYTES_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        resolve(req.result || null);
      };
      req.onerror = function () {
        resolve(null);
      };
      req.onblocked = function () {
        resolve(null);
      };
    });
  }

  function idbRun(db, storeNames, mode, work) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(storeNames, mode);
      } catch (e) {
        reject(e);
        return;
      }
      var request = null;
      try {
        request = work(tx) || null;
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = function () {
        resolve(request && 'result' in request ? request.result : null);
      };
      tx.onerror = function () {
        reject(tx.error || new Error('IndexedDB transaction failed.'));
      };
      tx.onabort = function () {
        reject(tx.error || new Error('IndexedDB transaction aborted.'));
      };
    });
  }

  /**
   * Where day films wait. Metadata and bytes sit in separate object stores so
   * a status change never rewrites a 400 MB film. Falls back to memory — and
   * says so through `volatile` — when the phone will not keep a copy.
   */
  function openDayFilmStore(opts) {
    opts = opts || {};
    var memory = {};
    var memoryBlobs = {};
    var volatileIds = {};
    var durable = false;
    var idb =
      opts.indexedDB !== undefined
        ? opts.indexedDB
        : typeof indexedDB !== 'undefined'
          ? indexedDB
          : null;
    var dbP = idbOpen(idb).then(function (db) {
      durable = Boolean(db);
      return db;
    });

    function remember(entry) {
      memory[entry.id] = metaOf(entry);
      if (entry.blob) memoryBlobs[entry.id] = entry.blob;
    }

    function withBlob(meta) {
      var copy = Object.assign({}, meta);
      if (memoryBlobs[meta.id]) copy.blob = memoryBlobs[meta.id];
      return copy;
    }

    function list() {
      return dbP
        .then(function (db) {
          if (!db) return [];
          return idbRun(db, [DAY_FILM_META_STORE], 'readonly', function (tx) {
            return tx.objectStore(DAY_FILM_META_STORE).getAll();
          }).then(
            function (rows) {
              return Array.isArray(rows) ? rows : [];
            },
            function () {
              return [];
            },
          );
        })
        .then(function (rows) {
          var out = [];
          var seen = {};
          rows.forEach(function (row) {
            if (!row || !row.id) return;
            seen[row.id] = true;
            // What this session already knows wins over the stored copy.
            var meta = memory[row.id] ? Object.assign(row, memory[row.id]) : row;
            meta.volatile = false;
            memory[row.id] = meta;
            out.push(meta);
          });
          Object.keys(memory).forEach(function (id) {
            if (seen[id]) return;
            memory[id].volatile = true;
            volatileIds[id] = true;
            out.push(memory[id]);
          });
          out.sort(byRecordedAt);
          return out.map(withBlob);
        });
    }

    function save(entry) {
      if (!entry || !entry.id) return Promise.reject(new Error('Nothing to save.'));
      remember(entry);
      var meta = Object.assign(metaOf(entry), { volatile: false });
      return dbP
        .then(function (db) {
          if (!db) throw new Error('This phone will not keep a copy.');
          return idbRun(db, [DAY_FILM_META_STORE, DAY_FILM_BYTES_STORE], 'readwrite', function (tx) {
            tx.objectStore(DAY_FILM_BYTES_STORE).put({ id: entry.id, blob: entry.blob });
            return tx.objectStore(DAY_FILM_META_STORE).put(meta);
          });
        })
        .then(
          function () {
            entry.volatile = false;
            if (memory[entry.id]) memory[entry.id].volatile = false;
            delete volatileIds[entry.id];
            return entry;
          },
          function () {
            entry.volatile = true;
            if (memory[entry.id]) memory[entry.id].volatile = true;
            volatileIds[entry.id] = true;
            return entry;
          },
        );
    }

    function update(id, patch) {
      var meta = memory[id];
      if (!meta) return Promise.resolve(null);
      Object.keys(patch || {}).forEach(function (key) {
        if (key === 'blob' || key === 'id') return;
        meta[key] = patch[key];
      });
      if (volatileIds[id]) return Promise.resolve(Object.assign({}, meta));
      var stored = Object.assign({}, meta, { volatile: false });
      return dbP
        .then(function (db) {
          if (!db) return null;
          return idbRun(db, [DAY_FILM_META_STORE], 'readwrite', function (tx) {
            return tx.objectStore(DAY_FILM_META_STORE).put(stored);
          });
        })
        .then(
          function () {
            return Object.assign({}, meta);
          },
          function () {
            return Object.assign({}, meta);
          },
        );
    }

    function remove(id) {
      delete memory[id];
      delete memoryBlobs[id];
      delete volatileIds[id];
      return dbP
        .then(function (db) {
          if (!db) return null;
          return idbRun(db, [DAY_FILM_META_STORE, DAY_FILM_BYTES_STORE], 'readwrite', function (tx) {
            tx.objectStore(DAY_FILM_BYTES_STORE).delete(id);
            return tx.objectStore(DAY_FILM_META_STORE).delete(id);
          });
        })
        .then(
          function () {},
          function () {},
        );
    }

    function getBlob(id) {
      if (memoryBlobs[id]) return Promise.resolve(memoryBlobs[id]);
      return dbP.then(function (db) {
        if (!db) return null;
        return idbRun(db, [DAY_FILM_BYTES_STORE], 'readonly', function (tx) {
          return tx.objectStore(DAY_FILM_BYTES_STORE).get(id);
        }).then(
          function (row) {
            var blob = row && row.blob ? row.blob : null;
            if (blob) memoryBlobs[id] = blob;
            return blob;
          },
          function () {
            return null;
          },
        );
      });
    }

    return {
      ready: dbP.then(function () {
        return durable;
      }),
      isDurable: function () {
        return durable;
      },
      list: list,
      save: save,
      update: update,
      remove: remove,
      getBlob: getBlob,
    };
  }

  /**
   * Files day films one at a time, oldest first, and never gives up on one.
   *
   *   cfg.store       openDayFilmStore()
   *   cfg.upload      function (entry, hooks) → Promise<result>   (uploadDayFilm)
   *   cfg.resolveJob  function (entry) → Promise<jobId>           phone-only job → office id
   *   cfg.canRun      function (entry) → boolean                  session / owner gate
   *   cfg.isOnline    function () → boolean
   *   cfg.onChange    function (films, reason)                    paint Today + the door
   *   cfg.onFiled     function (entry, result)
   *   cfg.onFailed    function (entry, err)
   */
  function createDayFilmQueue(cfg) {
    cfg = cfg || {};
    var store = cfg.store;
    var upload = cfg.upload;
    var resolveJob =
      cfg.resolveJob ||
      function (entry) {
        return Promise.resolve(entry.jobId);
      };
    var canRun =
      cfg.canRun ||
      function () {
        return true;
      };
    var isOnline =
      cfg.isOnline ||
      function () {
        return typeof navigator === 'undefined' || navigator.onLine !== false;
      };
    var onChange = cfg.onChange || function () {};
    var onFiled = cfg.onFiled || function () {};
    var onFailed = cfg.onFailed || function () {};
    var backoffMs = cfg.backoffMs || nextFilingBackoffMs;
    var timers = cfg.timers || {
      setTimeout: function (fn, ms) {
        return setTimeout(fn, ms);
      },
      clearTimeout: function (id) {
        clearTimeout(id);
      },
    };
    var now =
      cfg.now ||
      function () {
        return Date.now();
      };

    var entries = [];
    var runtime = {};
    var running = null;
    var timer = null;
    var loading = null;

    function rt(entry) {
      if (!runtime[entry.id]) runtime[entry.id] = { progress: 0, step: '' };
      return runtime[entry.id];
    }

    function view(entry) {
      var out = metaOf(entry);
      var r = rt(entry);
      out.progress = r.progress || 0;
      out.step = r.step || '';
      return out;
    }

    function films() {
      return entries.map(view);
    }

    function emit(reason) {
      try {
        onChange(films(), reason);
      } catch (e) {
        /* a paint error must never stop filing */
      }
    }

    function find(id) {
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].id === id) return entries[i];
      }
      return null;
    }

    function drop(entry) {
      entries = entries.filter(function (e) {
        return e.id !== entry.id;
      });
      delete runtime[entry.id];
    }

    function load() {
      if (loading) return loading;
      loading = Promise.resolve()
        .then(function () {
          return store.list();
        })
        .then(
          function (list) {
            (list || []).forEach(function (row) {
              if (!row || !row.id || find(row.id)) return;
              // A film left "uploading" by a killed tab starts over — the
              // signed URL is minted fresh and resumable parts pick up.
              if (row.status === 'uploading' || row.status === 'filed') row.status = 'queued';
              row.nextAttemptAt = 0;
              entries.push(row);
            });
            entries.sort(byRecordedAt);
            emit('load');
            return films();
          },
          function () {
            emit('load');
            return films();
          },
        );
      return loading;
    }

    /**
     * `opts.settle`: a promise for a patch to apply before the first attempt —
     * the streamer's final head once its in-flight part lands. The film is
     * saved and shown at once; only sending waits, and never past the cap.
     */
    function enqueue(entry, opts) {
      if (!entry || !entry.id) return Promise.reject(new Error('Nothing to file.'));
      if (!find(entry.id)) entries.push(entry);
      entries.sort(byRecordedAt);
      rt(entry).step = 'Saved on this phone';
      var settle = opts && opts.settle && typeof opts.settle.then === 'function' ? opts.settle : null;
      if (settle) {
        rt(entry).hold = true;
        var release = function (patch) {
          if (!rt(entry).hold) return;
          rt(entry).hold = false;
          if (patch && typeof patch === 'object') {
            Object.keys(patch).forEach(function (key) {
              if (key === 'id' || key === 'blob') return;
              entry[key] = patch[key];
            });
            store.update(entry.id, patch);
          }
          emit('settled');
          kick('settled');
        };
        var guard = timers.setTimeout(function () {
          release(null);
        }, STREAM_FINISH_WAIT_MS + 5000);
        settle.then(
          function (patch) {
            timers.clearTimeout(guard);
            release(patch);
          },
          function () {
            timers.clearTimeout(guard);
            release(null);
          },
        );
      }
      emit('enqueue');
      var saved = Promise.resolve()
        .then(function () {
          return store.save(entry);
        })
        .then(
          function () {
            emit('saved');
            return entry;
          },
          function () {
            entry.volatile = true;
            emit('saved');
            return entry;
          },
        );
      kick('enqueue');
      return saved;
    }

    function clearTimer() {
      if (timer) {
        timers.clearTimeout(timer);
        timer = null;
      }
    }

    function eligible(entry) {
      return isPendingFilm(entry) && entry.status !== 'uploading' && !rt(entry).hold && canRun(entry);
    }

    function pickNext() {
      var t = now();
      for (var i = 0; i < entries.length; i += 1) {
        var e = entries[i];
        if (eligible(e) && (e.nextAttemptAt || 0) <= t) return e;
      }
      return null;
    }

    function schedule() {
      clearTimer();
      if (running) return;
      var soonest = null;
      entries.forEach(function (e) {
        if (!eligible(e)) return;
        var at = e.nextAttemptAt || 0;
        if (soonest == null || at < soonest) soonest = at;
      });
      if (soonest == null) return;
      timer = timers.setTimeout(
        function () {
          timer = null;
          drain('timer');
        },
        Math.max(0, soonest - now()),
      );
    }

    /** Try now. Signal back, app back in front, a fresh session: skip any backoff. */
    function kick(reason) {
      var immediate =
        reason === 'online' ||
        reason === 'visible' ||
        reason === 'retry' ||
        reason === 'session' ||
        reason === 'remap';
      return load().then(function () {
        if (immediate) {
          entries.forEach(function (e) {
            if (eligible(e)) e.nextAttemptAt = 0;
          });
        }
        drain(reason || 'kick');
        return films();
      });
    }

    function drain(reason) {
      if (running) return;
      var entry = pickNext();
      if (!entry) {
        schedule();
        return;
      }
      if (!isOnline()) {
        // No radio at all. Mark every due film and let the online event (or
        // the safety interval) bring us back, rather than burn a retry on a
        // link that is known dead.
        var t = now();
        entries.forEach(function (e) {
          if (!eligible(e) || (e.nextAttemptAt || 0) > t) return;
          e.status = 'waiting';
          e.lastError = WAITING_FOR_SIGNAL;
          e.lastStatus = 0;
          e.nextAttemptAt = t + FILING_RETRY_CAP_MS;
          rt(e).step = WAITING_FOR_SIGNAL;
        });
        emit('offline');
        schedule();
        return;
      }
      run(entry);
    }

    function run(entry) {
      running = entry.id;
      entry.status = 'uploading';
      entry.attempts += 1;
      entry.lastError = '';
      entry.lastStatus = 0;
      var r = rt(entry);
      r.progress = 0;
      r.step = 'Starting…';
      var lastPainted = -1;
      store.update(entry.id, { status: 'uploading', attempts: entry.attempts, lastError: '' });
      emit('start');
      var hooks = {
        onStep: function (step) {
          rt(entry).step = String(step || '');
          emit('step');
        },
        onProgress: function (ratio) {
          var clean = Math.max(0, Math.min(1, Number(ratio) || 0));
          rt(entry).progress = clean;
          if (clean >= 1 || Math.abs(clean - lastPainted) >= 0.01) {
            lastPainted = clean;
            emit('progress');
          }
        },
        onFacts: function (facts) {
          if (!facts) return;
          entry.facts = facts;
          store.update(entry.id, { facts: facts });
        },
        onStreamAdvance: function (advance) {
          if (!entry.stream || !advance) return;
          entry.stream = Object.assign({}, entry.stream, {
            bytesDone: advance.bytesDone,
            partCount: advance.partCount,
          });
          store.update(entry.id, { stream: entry.stream });
        },
      };
      Promise.resolve()
        .then(function () {
          return resolveJob(entry);
        })
        .then(function (jobId) {
          var id = jobId != null ? String(jobId) : '';
          if (id && id !== entry.jobId) {
            entry.jobId = id;
            return store.update(entry.id, { jobId: id });
          }
          return null;
        })
        .then(function () {
          return entry.blob || store.getBlob(entry.id);
        })
        .then(function (blob) {
          if (!blob) {
            var gone = new Error('This film is no longer on this phone.');
            gone.code = 'film_missing';
            throw gone;
          }
          entry.blob = blob;
          return upload(entry, hooks);
        })
        .then(
          function (result) {
            running = null;
            entry.status = 'filed';
            drop(entry);
            store.remove(entry.id);
            emit('filed');
            try {
              onFiled(entry, result);
            } catch (e) {
              /* keep filing the rest */
            }
            drain('next');
          },
          function (err) {
            running = null;
            if (err && err.code === 'film_missing') {
              // Nothing left to send: drop it rather than retry forever.
              drop(entry);
              store.remove(entry.id);
              emit('lost');
              try {
                onFailed(entry, err);
              } catch (e) {
                /* keep filing the rest */
              }
              drain('next');
              return;
            }
            entry.status = 'waiting';
            entry.lastError = (err && err.message) || 'Upload did not go through.';
            entry.lastStatus = err && typeof err.status === 'number' ? err.status : 0;
            if (err && err.streamFailed && entry.stream) {
              // The office would not stitch the streamed head: send the
              // whole film, and do it now — nothing about signal changed.
              entry.stream = null;
              entry.nextAttemptAt = now();
            } else {
              entry.nextAttemptAt = now() + backoffMs(entry.attempts - 1);
            }
            rt(entry).step = entry.lastError;
            store.update(entry.id, {
              status: 'waiting',
              lastError: entry.lastError,
              lastStatus: entry.lastStatus,
              nextAttemptAt: entry.nextAttemptAt,
              attempts: entry.attempts,
              stream: entry.stream,
            });
            emit('failed');
            try {
              onFailed(entry, err);
            } catch (e) {
              /* keep filing the rest */
            }
            drain('next');
          },
        );
    }

    /** A phone-only job got its office id: every film waiting on it follows. */
    function remapJob(fromId, toId) {
      var from = String(fromId || '');
      var to = String(toId || '');
      if (!from || !to || from === to) return Promise.resolve(0);
      return load().then(function () {
        var writes = [];
        entries.forEach(function (e) {
          if (e.jobId !== from) return;
          e.jobId = to;
          if (e.status === 'waiting') e.nextAttemptAt = 0;
          writes.push(store.update(e.id, { jobId: to }));
        });
        return Promise.all(writes).then(function () {
          if (writes.length) {
            emit('remap');
            kick('remap');
          }
          return writes.length;
        });
      });
    }

    function pending(filter) {
      return films().filter(function (f) {
        return isPendingFilm(f) && (!filter || filter(f));
      });
    }

    return {
      load: load,
      enqueue: enqueue,
      kick: kick,
      retryNow: function () {
        return kick('retry');
      },
      remapJob: remapJob,
      films: films,
      pending: pending,
      get: function (id) {
        var e = find(id);
        return e ? view(e) : null;
      },
      isRunning: function () {
        return Boolean(running);
      },
    };
  }

  function dayCount(n) {
    return n === 1 ? '1 day' : n + ' days';
  }

  /** A server answer that will not change by itself — say it, keep trying gently. */
  function isStuckStatus(status) {
    var s = Number(status) || 0;
    return s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429;
  }

  function dayFilmRow(film, opts) {
    var pct = Math.round((film.progress || 0) * 100);
    var state;
    if (film.status === 'uploading') state = 'Filing · ' + pct + '%';
    else if (opts && opts.signedIn === false) state = 'Needs sign-in';
    else if (opts && opts.online === false) state = 'Waiting for signal';
    else if (isLocalJobId(film.jobId)) state = 'Creating the job';
    else if (isStuckStatus(film.lastStatus)) state = 'Needs the office';
    else if (film.status === 'waiting') state = 'Retrying…';
    else state = 'Saved';
    return {
      id: film.id,
      name: film.jobName || 'Job',
      length: formatClipLength(film.durationSeconds),
      state: state,
    };
  }

  /**
   * The Today strip in one line: what is on this phone, what it is doing,
   * and — only when true — that the crew needs to keep the app open.
   */
  function summarizeDayFilms(films, opts) {
    opts = opts || {};
    var list = (Array.isArray(films) ? films : []).filter(isPendingFilm);
    if (opts.owner != null) {
      list = list.filter(function (f) {
        return f.owner === opts.owner;
      });
    }
    var n = list.length;
    var out = { count: n, title: '', detail: '', progress: null, tone: 'idle', rows: [], signInLine: '' };
    if (!n) return out;
    var uploading = null;
    var volatile = false;
    var stuck = null;
    list.forEach(function (f) {
      if (f.status === 'uploading' && !uploading) uploading = f;
      if (f.volatile) volatile = true;
      if (!stuck && isStuckStatus(f.lastStatus) && f.lastError) stuck = f;
    });
    var days = dayCount(n);
    out.rows = list.map(function (f) {
      return dayFilmRow(f, opts);
    });
    out.signInLine =
      n === 1
        ? '1 day is saved on this phone. Sign in to finish filing it.'
        : n + ' days are saved on this phone. Sign in to finish filing them.';
    if (opts.signedIn === false) {
      out.tone = 'warn';
      out.title = 'Sign in to finish filing ' + days;
      out.detail = 'Saved on this phone.';
    } else if (uploading) {
      var pct = Math.round((uploading.progress || 0) * 100);
      out.tone = 'busy';
      out.progress = uploading.progress || 0;
      out.title = 'Filing ' + days + ' with the office';
      out.detail = (uploading.step || 'Uploading…') + ' · ' + pct + '%';
    } else if (opts.online === false) {
      out.tone = 'wait';
      out.title = days + ' saved on this phone';
      out.detail = 'Waiting for signal. It files on its own when you are back online.';
    } else if (stuck) {
      out.tone = 'warn';
      out.title = days + ' saved on this phone';
      out.detail = stuck.lastError;
    } else {
      out.tone = 'wait';
      out.title = days + ' saved on this phone';
      out.detail = 'Filing with the office in the background.';
    }
    if (volatile) {
      out.detail += ' Keep Field Capture open — this phone could not keep a copy.';
      /* Volatile copies need the crew to keep the app open — treat as warn
         so the home strip still surfaces even when Uploading… is hidden. */
      out.tone = 'warn';
    }
    return out;
  }

  /**
   * Home only shows the filing strip when the crew must act (sign-in, stuck
   * server answer, volatile copy). Quiet Uploading… / waiting-for-signal
   * progress stays off the home screen — the office Overview owns that.
   */
  function filingHomeVisible(summary) {
    return Boolean(summary && summary.count && summary.tone === 'warn');
  }

  global.FieldCaptureCore = {
    HOLD_TO_FINISH_MS: HOLD_TO_FINISH_MS,
    DAY_FILM_MAX_WIDTH: DAY_FILM_MAX_WIDTH,
    DAY_FILM_MAX_HEIGHT: DAY_FILM_MAX_HEIGHT,
    DAY_FILM_FPS_IDEAL: DAY_FILM_FPS_IDEAL,
    DAY_FILM_FPS_MIN: DAY_FILM_FPS_MIN,
    DAY_FILM_VIDEO_BITS_PER_SECOND: DAY_FILM_VIDEO_BITS_PER_SECOND,
    dayFilmGetUserMediaConstraints: dayFilmGetUserMediaConstraints,
    dayFilmRecorderOptions: dayFilmRecorderOptions,
    filterJobs: filterJobs,
    isLocalJobId: isLocalJobId,
    draftFieldJob: draftFieldJob,
    readPendingJobs: readPendingJobs,
    writePendingJobs: writePendingJobs,
    upsertPendingJob: upsertPendingJob,
    markPendingJobSynced: markPendingJobSynced,
    readCachedJobs: readCachedJobs,
    writeCachedJobs: writeCachedJobs,
    readCachedMe: readCachedMe,
    writeCachedMe: writeCachedMe,
    cacheOwnerId: cacheOwnerId,
    clearFieldLocalCache: clearFieldLocalCache,
    adoptFieldCache: adoptFieldCache,
    fieldCacheMatchesSession: fieldCacheMatchesSession,
    mergeTodayJobs: mergeTodayJobs,
    isTransientNetworkError: isTransientNetworkError,
    CONTACT_PUBLIC_URL: CONTACT_PUBLIC_URL,
    FIELD_CAPTURE_SUPPORT_NOTE: FIELD_CAPTURE_SUPPORT_NOTE,
    fieldCaptureSupportPath: fieldCaptureSupportPath,
    buildFieldCaptureSupportNote: buildFieldCaptureSupportNote,
    buildFieldCaptureSupportUrl: buildFieldCaptureSupportUrl,
    resolveFinishHold: resolveFinishHold,
    bindLivePreview: bindLivePreview,
    todayISO: todayISO,
    knownDurationSeconds: knownDurationSeconds,
    formatClipLength: formatClipLength,
    readCapture: readCapture,
    extractFrames: extractFrames,
    recordDayFilm: recordDayFilm,
    uploadDayFilm: uploadDayFilm,
    nextUploadBackoffMs: nextUploadBackoffMs,
    PROOF_UPLOAD_ATTEMPTS: PROOF_UPLOAD_ATTEMPTS,
    refreshSession: refreshSession,
    localDateISO: localDateISO,
    newClipId: newClipId,
    CLIP_ID: CLIP_ID,
    mintPartUploadUrl: mintPartUploadUrl,
    createDayFilmStreamer: createDayFilmStreamer,
    streamStateOf: streamStateOf,
    STREAM_PART_BYTES: STREAM_PART_BYTES,
    STREAM_MAX_BYTES: STREAM_MAX_BYTES,
    STREAM_MAX_PARTS: STREAM_MAX_PARTS,
    newDayFilmEntry: newDayFilmEntry,
    openDayFilmStore: openDayFilmStore,
    createDayFilmQueue: createDayFilmQueue,
    summarizeDayFilms: summarizeDayFilms,
    filingHomeVisible: filingHomeVisible,
    isStuckStatus: isStuckStatus,
    nextFilingBackoffMs: nextFilingBackoffMs,
    FILING_RETRY_CAP_MS: FILING_RETRY_CAP_MS,
    WAITING_FOR_SIGNAL: WAITING_FOR_SIGNAL,
    POSITION_FRESH_MS: POSITION_FRESH_MS,
    joinCrew: joinCrew,
    loginWithPassword: loginWithPassword,
    loadAuthMe: loadAuthMe,
    acceptTerms: acceptTerms,
    CURRENT_TERMS_VERSION: CURRENT_TERMS_VERSION,
    linkOffice: linkOffice,
    resolveApiBase: resolveApiBase,
    resolveOfficeHref: resolveOfficeHref,
    resolveOfficePlatformHref: resolveOfficePlatformHref,
    localOfficeOrigin: localOfficeOrigin,
    withFieldEmbed: withFieldEmbed,
    isStandaloneFieldCaptureHost: isStandaloneFieldCaptureHost,
    LIVE_OFFICE_ORIGIN: LIVE_OFFICE_ORIGIN,
    loadFieldMe: loadFieldMe,
    loadTodayJobs: loadTodayJobs,
    preferTodayAfterInviteSignIn: preferTodayAfterInviteSignIn,
    createTodayJob: createTodayJob,
    placesStatus: placesStatus,
    placesAutocomplete: placesAutocomplete,
    placesDetails: placesDetails,
    placesResolve: placesResolve,
    loadShareJob: loadShareJob,
    loadShareProofs: loadShareProofs,
    jobShareUrl: jobShareUrl,
    exchangeShareToken: exchangeShareToken,
    currentPosition: currentPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
