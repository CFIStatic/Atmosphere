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
  var LIVE_OFFICE_ORIGIN = 'https://atmosphere-web-production.up.railway.app';
  var FIELD_CAPTURE_HOST = /^field-capture(?:-[a-z0-9]+)*\.up\.railway\.app$/i;

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

  function todayISO() {
    var now = new Date();
    var offset = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
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
      var done = function () {
        var d = Number.isFinite(video.duration) ? video.duration : null;
        URL.revokeObjectURL(url);
        resolve(d);
      };
      video.onloadedmetadata = done;
      video.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      setTimeout(done, 8000);
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
        return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
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

  function readCapture(file) {
    var positionP = currentPosition();
    return readDuration(file).then(function (durationHint) {
      var longForm =
        (durationHint != null && durationHint > LONG_FORM_CLIENT_SECONDS) || file.size > 80 * 1000 * 1000;
      return Promise.all([
        positionP,
        hashFile(file),
        longForm
          ? Promise.resolve({ durationSeconds: durationHint, frames: [] })
          : extractFrames(file),
      ]).then(function (parts) {
        var position = parts[0];
        var hash = parts[1];
        var media = parts[2];
        return {
          contentHash: hash,
          durationSeconds: media.durationSeconds != null ? media.durationSeconds : durationHint,
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
   * Record day film with camera + microphone into a Blob (webm/mp4).
   */
  function recordDayFilm(opts) {
    opts = opts || {};
    var onTick = opts.onTick || function () {};
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
            : navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: true,
              });
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
          var recorder = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
          state.recorder = recorder;
          state.chunks = [];
          state.startedAt = Date.now();
          recorder.ondataavailable = function (ev) {
            if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
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

  /** Railway Field Capture service — not the office /fieldcapture/ path. */
  function isStandaloneFieldCaptureHost(hostname) {
    return FIELD_CAPTURE_HOST.test(hostname || '');
  }

  /**
   * Same-origin on the office console. On the standalone Field Capture
   * Railway host, talk to the live office /api so the same email +
   * password as the Platform can attach this phone to the office account.
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
   * Railway app and a local phone preview are not that SPA — they point
   * at the live office origin and stay in the phone web frame.
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
    return resolveOfficeHref(withFieldEmbed(pathname || '/verifier-library'));
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

  function loadFieldMe(apiBase, accessToken) {
    return apiJson(origin(apiBase) + '/api/field-app/me', { accessToken: accessToken });
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
        address: opts.address,
        city: opts.city || undefined,
        postalCode: opts.postalCode || undefined,
        placeId: opts.placeId || undefined,
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

  /**
   * Upload day film.
   *
   * Job-share link: `{ token }` (no office login).
   * Dashboard account: `{ jobId, accessToken }` — same session as the website.
   */
  function uploadDayFilm(opts) {
    var token = opts.token;
    var jobId = opts.jobId;
    var accessToken = opts.accessToken;
    var apiBase = origin(opts.apiBase);
    var blob = opts.blob;
    var mimeType = opts.mimeType || 'video/webm';
    var onStep = opts.onStep || function () {};
    var storageBase = opts.storageBase || '';

    var ext = mimeType.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var file = new File([blob], 'field-day.' + ext, {
      type: mimeType,
      lastModified: Date.now(),
    });

    var uploadPath = jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(jobId) + '/proof/upload-url'
      : apiBase + '/api/job-share/' + encodeURIComponent(token) + '/proof/upload-url';
    var filePath = jobId
      ? apiBase + '/api/field-app/jobs/' + encodeURIComponent(jobId) + '/proof'
      : apiBase + '/api/job-share/' + encodeURIComponent(token) + '/proof';
    var authHeaders = accessToken ? { Authorization: 'Bearer ' + accessToken } : {};

    onStep('Reading the recording…');
    return readCapture(file).then(function (facts) {
      onStep('Getting somewhere to put it…');
      return apiJson(uploadPath, {
        method: 'POST',
        accessToken: accessToken,
        headers: authHeaders,
        body: {
          workDate: todayISO(),
          phase: 'after',
          extension: ext,
        },
      }).then(function (slot) {
        onStep('Uploading video + audio…');
        var putUrl =
          slot.uploadUrl ||
          (storageBase || '') +
            '/storage/v1/object/upload/sign/job-proofs/' +
            slot.path +
            '?token=' +
            encodeURIComponent(slot.token);
        return putBytesWithRetry(putUrl, file, mimeType, onStep, 3).then(function () {
          onStep('Filing it with the office…');
          return apiJson(filePath, {
            method: 'POST',
            accessToken: accessToken,
            headers: authHeaders,
            body: {
              workDate: todayISO(),
              phase: 'after',
              storagePath: slot.path,
              byteSize: file.size,
              durationSeconds: facts.durationSeconds != null ? facts.durationSeconds : undefined,
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
    });
  }

  /**
   * PUT the day film to signed storage. Truck signal drops mid-upload, so
   * retry a few times before asking the crew to try again from the door.
   */
  function putBytesWithRetry(putUrl, file, mimeType, onStep, attemptsLeft) {
    return fetch(putUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': mimeType },
    }).then(
      function (put) {
        if (put.ok) return put;
        if (attemptsLeft <= 1) {
          throw new Error('The upload did not go through. Try again on better signal.');
        }
        onStep('Upload interrupted — retrying…');
        return putBytesWithRetry(putUrl, file, mimeType, onStep, attemptsLeft - 1);
      },
      function () {
        if (attemptsLeft <= 1) {
          throw new Error('The upload did not go through. Try again on better signal.');
        }
        onStep('Upload interrupted — retrying…');
        return putBytesWithRetry(putUrl, file, mimeType, onStep, attemptsLeft - 1);
      },
    );
  }

  function loadShareJob(token, apiBase) {
    apiBase = (apiBase || '').replace(/\/$/, '');
    return fetch(apiBase + '/api/job-share/' + encodeURIComponent(token), {
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
    return fetch(apiBase + '/api/job-share/' + encodeURIComponent(token) + '/proof', {
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

  global.FieldCaptureCore = {
    HOLD_TO_FINISH_MS: HOLD_TO_FINISH_MS,
    filterJobs: filterJobs,
    resolveFinishHold: resolveFinishHold,
    bindLivePreview: bindLivePreview,
    todayISO: todayISO,
    readCapture: readCapture,
    extractFrames: extractFrames,
    recordDayFilm: recordDayFilm,
    uploadDayFilm: uploadDayFilm,
    joinCrew: joinCrew,
    loginWithPassword: loginWithPassword,
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
    createTodayJob: createTodayJob,
    placesStatus: placesStatus,
    placesAutocomplete: placesAutocomplete,
    placesDetails: placesDetails,
    placesResolve: placesResolve,
    loadShareJob: loadShareJob,
    loadShareProofs: loadShareProofs,
    currentPosition: currentPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
