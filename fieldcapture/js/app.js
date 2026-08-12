/**
 * Field Capture — production UI controller.
 *
 * Modes:
 *   ?token=<job-share>  → live MediaRecorder + proof upload (default when token present)
 *   ?demo=1             → scripted demo only (explicit)
 *   no token, no demo   → blocked empty state (not a fake day)
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var TOKEN = params.get('token') || params.get('share') || '';
  var FORCE_DEMO = params.get('demo') === '1';
  var API_BASE = params.get('api') || '';
  var STORAGE_BASE = params.get('storage') || '';
  var LIVE = Boolean(TOKEN) && !FORCE_DEMO;
  var DEMO = FORCE_DEMO || (!TOKEN && params.get('allowDemo') === '1');

  var Core = window.FieldCaptureCore;
  if (!Core) {
    console.error('capture-core.js failed to load');
    return;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  var SCREENS = ['s-home', 's-rec', 's-door', 's-blocked'];
  function show(id) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.setAttribute('data-on', s === id ? '1' : '0');
    });
    window.scrollTo(0, 0);
  }

  var state = {
    recorder: null,
    stopWatch: null,
    uploadResult: null,
    job: null,
    site: null,
    seconds: 0,
  };

  /* ---------- home hydration ---------- */

  function renderExpect(jobs) {
    var root = $('#expect');
    if (!root) return;
    if (!jobs.length) {
      root.innerHTML =
        '<div class="erow"><span class="t"><b>No jobs on this link</b><span>Ask the office for a current share link.</span></span></div>';
      return;
    }
    root.innerHTML = jobs
      .map(function (j) {
        return (
          '<div class="erow">' +
          '<span class="t"><b>' +
          escapeHtml(j.name) +
          '</b><span>' +
          escapeHtml(j.addr) +
          (j.placed ? '' : ' <span class="warnpin">· cannot be placed from GPS</span>') +
          '</span></span>' +
          '<span class="at">' +
          escapeHtml(j.at || '') +
          '</span></div>'
        );
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(msg, isErr) {
    var el = $('#live-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isErr ? 'var(--fail)' : 'var(--muted)';
  }

  var JOB_CACHE_KEY = 'atmosphere.fc.job.' + TOKEN;
  var DAYS_CACHE_KEY = 'atmosphere.fc.days.' + TOKEN;

  /**
   * "This week" is the party's real filed days from the job file — work date,
   * acceptance, and open problems as the office actually recorded them —
   * never sample rows.
   */
  function renderWeek(days) {
    var wrap = $('#week-wrap');
    if (!wrap) return;
    if (!days || !days.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    $('#week').innerHTML = days
      .slice(0, 7)
      .map(function (d) {
        var when = new Date(d.workDate + 'T12:00:00');
        var label = isNaN(when.getTime())
          ? d.workDate
          : when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        var chip = d.accepted
          ? ['pass', 'Accepted']
          : d.problems && d.problems.length
            ? ['warm', 'Needs eyes']
            : ['wait', 'Filed'];
        return (
          '<div class="weekrow"><span class="what">' +
          escapeHtml(label + (d.summary ? ' · ' + d.summary : '')) +
          '</span><span class="chip ' +
          chip[0] +
          '"><span class="dot"></span>' +
          chip[1] +
          '</span></div>'
        );
      })
      .join('');
  }

  function loadWeek() {
    Core.loadShareProofs(TOKEN, API_BASE)
      .then(function (payload) {
        try {
          localStorage.setItem(DAYS_CACHE_KEY, JSON.stringify(payload.days || []));
        } catch (e) {
          /* ignore */
        }
        renderWeek(payload.days || []);
      })
      .catch(function () {
        // Offline — show the last known real days, or nothing. Never samples.
        var cached = null;
        try {
          cached = JSON.parse(localStorage.getItem(DAYS_CACHE_KEY) || 'null');
        } catch (e) {
          cached = null;
        }
        if (cached) renderWeek(cached);
      });
  }

  function applyJobPayload(payload, offline) {
    state.job = payload;
    var title = (payload.job && payload.job.title) || 'Job';
    var num = (payload.job && payload.job.jobNumber) || '';
    // Identity comes from the linked account on the job share — the
    // contact the office invited — never a made-up placeholder.
    var company = (payload.you && payload.you.company) || 'Crew';
    var person = (payload.you && payload.you.name) || '';
    var who = document.querySelector('.who');
    if (who) {
      who.innerHTML = person
        ? '<b>' + escapeHtml(person) + '</b>' + escapeHtml(company)
        : '<b>' + escapeHtml(company) + '</b>Field Capture';
    }
    renderExpect([
      {
        name: (num ? num + ' · ' : '') + title,
        addr: payload.job && payload.job.claimNumber ? 'Claim ' + payload.job.claimNumber : 'Shared job',
        at: 'Today',
        placed: true,
      },
    ]);
    setStatus(
      offline
        ? 'No signal — using the last loaded job. Filming still works; the day uploads itself when signal returns.'
        : 'Ready — tap Start. Records video + microphone.',
    );
    $('#daybtn').disabled = false;
    loadWeek();
  }

  function bootLive() {
    show('s-home');
    setStatus('Loading job…');
    $('#week-wrap').hidden = true;
    Core.loadShareJob(TOKEN, API_BASE)
      .then(function (payload) {
        // Remember the job on this device so the app still opens — and can
        // still film — at a site with no signal at all.
        try {
          localStorage.setItem(JOB_CACHE_KEY, JSON.stringify(payload));
        } catch (e) {
          /* private mode — offline boot just won't be available */
        }
        applyJobPayload(payload, false);
      })
      .catch(function (err) {
        var cached = null;
        try {
          cached = JSON.parse(localStorage.getItem(JOB_CACHE_KEY) || 'null');
        } catch (e) {
          cached = null;
        }
        if (cached) {
          applyJobPayload(cached, true);
          return;
        }
        setStatus(err.message || 'Could not open this link.', true);
        $('#daybtn').disabled = true;
        show('s-blocked');
        $('#blocked-msg').textContent = err.message || 'This link is invalid or expired.';
      });
  }

  /* ---------- offline queue surface ---------- */

  function updatePendingBadge() {
    var el = $('#pending');
    if (!el || !Core.pendingCount) return;
    Core.pendingCount().then(function (n) {
      if (n > 0) {
        el.hidden = false;
        el.textContent =
          n === 1
            ? '1 day film is saved on this phone — it uploads itself when the phone has internet.'
            : n + ' day films are saved on this phone — they upload themselves when the phone has internet.';
      } else {
        el.hidden = true;
      }
    });
  }

  function autoFlush() {
    if (!LIVE) return;
    Core.flushQueue({}).then(function (flush) {
      if (flush.uploaded && flush.uploaded.length) {
        setStatus(
          'Uploaded ' +
            flush.uploaded.length +
            ' saved day film' +
            (flush.uploaded.length === 1 ? '' : 's') +
            ' to the job. ✓',
        );
      }
      updatePendingBadge();
    });
  }

  function bootBlocked() {
    show('s-blocked');
    $('#blocked-msg').textContent =
      'Open Field Capture with a job share link (?token=…). Demo mode requires ?demo=1.';
  }

  /* ---------- recording ---------- */

  function fmt(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  }

  function startLiveDay() {
    var videoEl = $('#preview');
    state.recorder = Core.recordDayFilm({
      videoEl: videoEl,
      onTick: function (sec) {
        state.seconds = sec;
        $('#clock').textContent = fmt(sec);
      },
    });
    setStatus('');
    state.recorder
      .start()
      .then(function () {
        show('s-rec');
        $('#rec-since').textContent = 'since ' + new Date().toLocaleTimeString();
        $('#live-text').textContent = 'Recording video + audio. Keep the phone on you.';
        state.stopWatch = state.recorder.watchPosition(function (site) {
          state.site = site;
          $('#site-text').textContent = site.label;
          $('#sitestrip').className = 'sitestrip' + (site.lat == null ? ' unsure' : '');
        });
      })
      .catch(function (err) {
        setStatus(err.message || 'Could not start camera/mic.', true);
        alert(err.message || 'Could not start camera/mic.');
      });
  }

  function finishLiveDay() {
    if (!state.recorder) return;
    if (state.stopWatch) state.stopWatch();
    $('#stopbtn').querySelector('.lbl').textContent = 'Finishing…';
    var onStep = function (step) {
      $('#upload-step').textContent = step;
    };
    state.recorder
      .stop()
      .then(function (clip) {
        openDoorUploading();
        onStep('Saving on this phone…');
        // The recording is safe on the device BEFORE any network is tried —
        // rural sites often have none, and the footage must survive that.
        return Core.saveDayFilm({
          token: TOKEN,
          apiBase: API_BASE,
          storageBase: STORAGE_BASE,
          blob: clip.blob,
          mimeType: clip.mimeType,
        });
      })
      .then(function (saved) {
        updatePendingBadge();
        if (saved.id == null) {
          // On-device storage unavailable (e.g. private browsing) — the
          // immediate upload is the only path, as before.
          return Core.uploadSavedEntry(saved.entry, onStep).then(function (result) {
            state.uploadResult = result;
            renderDoorLive(result);
          });
        }
        return Core.flushQueue({ onStep: onStep }).then(function (flush) {
          var mine = null;
          for (var i = 0; i < flush.uploaded.length; i++) {
            if (flush.uploaded[i].id === saved.id) mine = flush.uploaded[i].result;
          }
          updatePendingBadge();
          if (mine) {
            state.uploadResult = mine;
            renderDoorLive(mine);
          } else {
            renderDoorQueued(saved);
          }
        });
      })
      .catch(function (err) {
        $('#upload-step').textContent = err.message || 'Upload failed.';
        $('#upload-step').style.color = 'var(--fail)';
        renderDoorFailed(err);
      });
  }

  function openDoorUploading() {
    show('s-door');
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Uploading</span><em id="upload-step">Starting…</em><span class="ok">…</span></div>';
    $('#daytl').innerHTML = '';
    $('#doneline').classList.remove('on');
    $('#donebtn').classList.remove('on');
  }

  function renderDoorLive(result) {
    var problems = result.problems || [];
    var checks = result.checks || [];
    var rows = [];
    rows.push(
      '<div class="lrow on"><span>Filmed live — video + audio</span><em>mic track required</em><span class="ok">✓</span></div>',
    );
    rows.push(
      '<div class="lrow on"><span>Uploaded</span><em>' +
        (result.facts && result.facts.durationSeconds
          ? Math.round(result.facts.durationSeconds) + 's'
          : 'filed') +
        '</em><span class="ok">✓</span></div>',
    );
    if (result.facts && result.facts.lat != null) {
      rows.push(
        '<div class="lrow on"><span>Location</span><em>±' +
          Math.round(result.facts.accuracyM || 0) +
          ' m</em><span class="ok">✓</span></div>',
      );
    } else {
      rows.push(
        '<div class="lrow on"><span>Location</span><em>unknown — office will review</em><span class="ok">!</span></div>',
      );
    }
    checks.slice(0, 4).forEach(function (c) {
      rows.push(
        '<div class="lrow on"><span>' +
          escapeHtml(c.what || c.code || 'Check') +
          '</span><em>' +
          escapeHtml(c.detail || c.verdict || '') +
          '</em><span class="ok">' +
          (c.verdict === 'fail' || c.verdict === 'failed' ? '!' : '✓') +
          '</span></div>',
      );
    });
    if (problems.length) {
      rows.push(
        '<div class="lrow on"><span>Needs a person</span><em>' +
          escapeHtml(problems[0]) +
          '</em><span class="ok">!</span></div>',
      );
    }
    $('#ledger').innerHTML = rows.join('');
    var jobName =
      state.job && state.job.job ? state.job.job.title : 'Job';
    $('#daytl').innerHTML =
      '<div class="tlrow"><b>' +
      escapeHtml(jobName) +
      '</b><span>Day film filed as today’s after proof. Office Verifier will show video, audio, and AI dictation when analysis finishes.</span>' +
      '<span class="mono">proof ' +
      escapeHtml((result.proof && result.proof.id) || 'filed') +
      '</span></div>';
    $('#doneline').classList.add('on');
    $('#donebtn').classList.add('on');
  }

  function renderDoorQueued(saved) {
    var facts = saved.facts || {};
    var rows = [];
    rows.push(
      '<div class="lrow on"><span>Filmed live — video + audio</span><em>mic track required</em><span class="ok">✓</span></div>',
    );
    rows.push(
      '<div class="lrow on"><span>Saved on this phone</span><em>' +
        (facts.durationSeconds ? Math.round(facts.durationSeconds) + 's · ' : '') +
        'filed as ' +
        escapeHtml(saved.entry.workDate) +
        '</em><span class="ok">✓</span></div>',
    );
    rows.push(
      '<div class="lrow on"><span>No signal right now</span><em>uploads itself when internet returns</em><span class="ok">→</span></div>',
    );
    $('#ledger').innerHTML = rows.join('');
    var jobName = state.job && state.job.job ? state.job.job.title : 'Job';
    $('#daytl').innerHTML =
      '<div class="tlrow"><b>' +
      escapeHtml(jobName) +
      '</b><span>Your day is done and the film is safe on this phone. The next time the phone has internet — tonight at home, or back in town — it files itself to the job. Just do not clear this browser’s data.</span></div>';
    $('#doneline').classList.add('on');
    $('#donebtn').classList.add('on');
  }

  function renderDoorFailed(err) {
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Upload failed</span><em>' +
      escapeHtml(err.message || 'Try again') +
      '</em><span class="ok">!</span></div>' +
      '<div class="lrow on"><span>Recording</span><em>kept on this phone until you retry</em><span class="ok">→</span></div>';
    $('#daytl').innerHTML = '';
    $('#doneline').classList.add('on');
    $('#doneline').querySelector('small').textContent =
      'Do not delete the app data. Fix signal and start the day again — or ask the office for help.';
    $('#donebtn').classList.add('on');
  }

  /* ---------- hold to finish ---------- */

  var holdTimer = null;
  function bindHold() {
    var stopBtn = $('#stopbtn');
    if (!stopBtn) return;
    function beginHold(e) {
      if (e && e.cancelable) e.preventDefault();
      if (holdTimer) return;
      stopBtn.setAttribute('data-holding', '1');
      stopBtn.querySelector('.lbl').textContent = 'Keep holding…';
      holdTimer = setTimeout(function () {
        holdTimer = null;
        if (LIVE) finishLiveDay();
        else if (window.__demoFinish) window.__demoFinish();
      }, 1500);
    }
    function cancelHold() {
      if (!holdTimer) return;
      clearTimeout(holdTimer);
      holdTimer = null;
      stopBtn.removeAttribute('data-holding');
      stopBtn.querySelector('.lbl').textContent = 'Hold to finish the day';
    }
    stopBtn.addEventListener('pointerdown', beginHold);
    stopBtn.addEventListener('pointerup', cancelHold);
    stopBtn.addEventListener('pointerleave', cancelHold);
    stopBtn.addEventListener('pointercancel', cancelHold);
    stopBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (LIVE) finishLiveDay();
        else if (window.__demoFinish) window.__demoFinish();
      }
    });
  }

  /* ---------- demo (explicit only) ---------- */

  function bootDemo() {
    // Minimal demo path — scripted, never pretend to be live.
    document.body.setAttribute('data-mode', 'demo');
    var demoWho = document.querySelector('.who');
    if (demoWho) demoWho.innerHTML = '<b>Demo crew</b>Sample data';
    setStatus('Demo mode (?demo=1) — not uploading.');
    $('#week-wrap').hidden = false;
    var JOBS = [
      {
        id: 'j1041',
        name: 'Meridian Ave — water loss, Class 3',
        addr: '1841 Meridian Ave, Austin',
        at: '7:00 AM',
        placed: true,
      },
    ];
    renderExpect(JOBS);
    var WEEK = [
      { what: 'Mon · Meridian after', chip: ['pass', 'Accepted'] },
      { what: 'Tue · Cedar Ridge', chip: ['warm', 'Needs eyes'] },
    ];
    $('#week').innerHTML = WEEK.map(function (w) {
      return (
        '<div class="weekrow"><span class="what">' +
        w.what +
        '</span><span class="chip ' +
        w.chip[0] +
        '"><span class="dot"></span>' +
        w.chip[1] +
        '</span></div>'
      );
    }).join('');

    var seconds = 0;
    var timer = null;
    $('#daybtn').onclick = function () {
      show('s-rec');
      $('#scene').innerHTML = '';
      $('#preview').hidden = true;
      $('#rec-since').textContent = 'demo';
      seconds = 0;
      timer = setInterval(function () {
        seconds += 1;
        $('#clock').textContent = fmt(seconds);
      }, 1000);
      $('#live-text').textContent = 'Demo recording — no bytes leave this phone.';
      $('#site-text').textContent = 'Demo site';
    };
    window.__demoFinish = function () {
      if (timer) clearInterval(timer);
      show('s-door');
      $('#ledger').innerHTML =
        '<div class="lrow on"><span>Demo only</span><em>nothing uploaded</em><span class="ok">✓</span></div>';
      $('#daytl').innerHTML =
        '<div class="tlrow"><b>Demo day</b><span>Open with ?token= to file a real day film.</span></div>';
      $('#doneline').classList.add('on');
      $('#donebtn').classList.add('on');
    };
    show('s-home');
  }

  /* ---------- wire ---------- */

  var now = new Date();
  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var dateEl = $('#today-date');
  if (dateEl) {
    dateEl.textContent = DAYS[now.getDay()] + ' · ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
  }

  bindHold();
  $('#donebtn').addEventListener('click', function () {
    show('s-home');
    setStatus(LIVE ? 'Ready for another day on this link.' : '');
  });

  // The service worker keeps the app shell on this device, so the page
  // itself opens at a site with no signal at all.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* http without SW support — the app still works online */
    });
  }

  if (LIVE) {
    document.body.setAttribute('data-mode', 'live');
    $('#daybtn').addEventListener('click', startLiveDay);
    bootLive();
    // Days saved while offline upload themselves: on open, the moment the
    // browser reports internet again, and on a slow retry tick in between.
    updatePendingBadge();
    autoFlush();
    window.addEventListener('online', autoFlush);
    setInterval(autoFlush, 2 * 60 * 1000);
  } else if (DEMO) {
    bootDemo();
  } else {
    bootBlocked();
  }
})();
