/**
 * Field Capture — production UI controller.
 *
 * Modes:
 *   ?token=<job-share>  → live MediaRecorder + proof upload (no office login)
 *   signed in           → name + office invite code, jobs from that office
 *   ?demo=1             → scripted demo only (explicit)
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
  var ACCESS_KEY = 'atm.field.accessToken';
  var REFRESH_KEY = 'atm.field.refreshToken';

  var Core = window.FieldCaptureCore;
  if (!Core) {
    console.error('capture-core.js failed to load');
    return;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function when(sel, fn) {
    var node = $(sel);
    if (node) fn(node);
  }

  var SCREENS = ['s-home', 's-rec', 's-door', 's-blocked'];
  function show(id) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.setAttribute('data-on', s === id ? '1' : '0');
    });
    window.scrollTo(0, 0);
  }

  /**
   * Bars rise from the orange ground, the mark lifts, then the veil
   * eases off so Today is waiting underneath. Paper on light, night on
   * dark — same tokens as the rest of the phone. Plays only after a
   * successful connect — not on later launches.
   */
  function playElevate() {
    return new Promise(function (resolve) {
      var el = $('#s-elevate');
      if (!el) {
        resolve();
        return;
      }
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-label', 'Connected');
      el.setAttribute('data-on', '1');
      el.classList.remove('play', 'out');
      void el.offsetWidth;
      el.classList.add('play');
      /* CSS already flattens the choreography when the OS asks for reduced
         motion. Four-second lockup, then the mark melts into the same
         paper or night Today is already using. */
      var hold = 4000;
      var fade = 2700;
      window.setTimeout(function () {
        document.documentElement.removeAttribute('data-elevate-preview');
        el.classList.add('out');
        window.setTimeout(function () {
          el.setAttribute('data-on', '0');
          el.setAttribute('aria-hidden', 'true');
          el.classList.remove('play', 'out');
          resolve();
        }, fade);
      }, hold);
    });
  }

  var state = {
    recorder: null,
    stopWatch: null,
    uploadResult: null,
    job: null,
    site: null,
    seconds: 0,
    finishing: false,
    accessToken: null,
    refreshToken: null,
    jobs: [],
    activeJobId: null,
    account: false,
  };

  function readStoredSession() {
    try {
      state.accessToken = sessionStorage.getItem(ACCESS_KEY);
      state.refreshToken = sessionStorage.getItem(REFRESH_KEY);
    } catch (e) {
      state.accessToken = null;
      state.refreshToken = null;
    }
  }

  function writeStoredSession(accessToken, refreshToken) {
    state.accessToken = accessToken || null;
    state.refreshToken = refreshToken || null;
    try {
      if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
      else sessionStorage.removeItem(ACCESS_KEY);
      if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
      else sessionStorage.removeItem(REFRESH_KEY);
    } catch (e) {
      /* private mode — stay signed in for this page only */
    }
  }

  /* ---------- home hydration ---------- */

  function renderExpect(jobs) {
    var root = $('#expect');
    if (!root) return;
    if (!jobs.length) {
      root.innerHTML =
        '<div class="erow"><span class="t"><b>Nothing assigned yet</b><span>Ask the office to put you on a job, then refresh.</span></span></div>';
      return;
    }
    root.innerHTML = jobs
      .map(function (j) {
        var selected = state.account && j.id && j.id === state.activeJobId;
        var href = j.sharePath ? escapeHtml(j.sharePath) : '';
        var open = href ? 'a' : 'div';
        var hrefAttr = href ? ' href="' + href + '"' : '';
        return (
          '<' + open + ' class="erow"' +
          hrefAttr +
          (j.id ? ' data-job-id="' + escapeHtml(j.id) + '"' : '') +
          (selected ? ' data-selected="1"' : '') +
          '>' +
          '<span class="t"><b>' +
          escapeHtml(j.name) +
          '</b><span>' +
          escapeHtml(j.addr) +
          (j.filmed ? ' <span class="filmedpin">· filmed today</span>' : '') +
          (j.placed ? '' : ' <span class="warnpin">· cannot be placed from GPS</span>') +
          '</span>' +
          (href ? '<span class="sharelink">' + href + '</span>' : '') +
          '</span>' +
          '<span class="at">' +
          escapeHtml(j.filmed ? 'Filmed' : j.at || '') +
          '</span></' + open + '>'
        );
      })
      .join('');
    if (state.account) {
      root.querySelectorAll('[data-job-id]').forEach(function (row) {
        if (row.tagName === 'A') return;
        row.style.cursor = 'pointer';
        row.addEventListener('click', function () {
          state.activeJobId = row.getAttribute('data-job-id');
          renderExpect(state.jobs);
        });
      });
    }
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

  function bootLive() {
    show('s-home');
    setStatus('Loading job…');
    $('#week-wrap').hidden = true;
    Core.loadShareJob(TOKEN, API_BASE)
      .then(function (payload) {
        state.job = payload;
        var title = (payload.job && payload.job.title) || 'Job';
        var num = (payload.job && payload.job.jobNumber) || '';
        var company = (payload.you && payload.you.company) || 'Crew';
        var who = document.querySelector('.who');
        if (who) {
          who.hidden = false;
          who.innerHTML = '<b>' + escapeHtml(company) + '</b>Field Capture';
        }
        renderExpect([
          {
            name: (num ? num + ' · ' : '') + title,
            addr: payload.job && payload.job.claimNumber ? 'Claim ' + payload.job.claimNumber : 'Shared job',
            at: 'Today',
            placed: true,
            sharePath: '/shared/' + TOKEN,
          },
        ]);
        setStatus('Ready — pick a job.');
        when('#daybtn', function (btn) { btn.disabled = false; });
      })
      .catch(function (err) {
        setStatus(err.message || 'Could not open this link.', true);
        when('#daybtn', function (btn) { btn.disabled = true; });
        show('s-blocked');
        $('#blocked-msg').textContent = err.message || 'This link is invalid or expired.';
      });
  }

  function bootBlocked() {
    show('s-blocked');
    var who = document.querySelector('.who');
    if (who) {
      who.hidden = true;
      who.innerHTML = '';
    }
    $('#blocked-msg').textContent =
      'Type your name and the office invite code from Atmosphere Settings.';
  }

  function showLoginError(message) {
    var el = $('#login-err');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function enterAccountHome(me, jobs) {
    state.account = true;
    state.jobs = (jobs || []).map(function (j) {
      return {
        id: j.id,
        name: (j.number ? j.number + ' · ' : '') + (j.name || 'Job'),
        addr: j.address || '',
        at: j.at || 'Today',
        placed: Boolean(j.placed),
        filmed: Boolean(j.filmed),
        sharePath: j.sharePath || '',
      };
    });
    if (!state.activeJobId || !state.jobs.some(function (j) { return j.id === state.activeJobId; })) {
      state.activeJobId = state.jobs[0] ? state.jobs[0].id : null;
    }
    var who = document.querySelector('.who');
    if (who) {
      var name = (me.user && (me.user.fullName || me.user.email)) || 'You';
      var org = (me.org && me.org.name) || 'Office';
      who.hidden = false;
      who.innerHTML = '<b>' + escapeHtml(name) + '</b>' + escapeHtml(org);
    }
    renderExpect(state.jobs);
    $('#week-wrap').hidden = true;
    when('#daybtn', function (btn) { btn.disabled = !state.activeJobId; });
    setStatus(
      state.activeJobId
        ? 'Ready — pick a job.'
        : 'Nothing on the schedule for today. Ask the office to start a job.',
    );
    show('s-home');
  }

  function bootAccountSession() {
    return Core.loadFieldMe(API_BASE, state.accessToken).then(function (me) {
      return Core.loadTodayJobs(API_BASE, state.accessToken).then(function (jobs) {
        enterAccountHome(me, jobs);
      });
    });
  }

  function bootAccount() {
    document.body.setAttribute('data-mode', 'account');
    readStoredSession();
    when('#daybtn', function (btn) { btn.addEventListener('click', startLiveDay); });
    var form = $('#login-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var fullName = ($('#login-name') && $('#login-name').value || '').trim();
        var joinCode = ($('#login-code') && $('#login-code').value || '').trim().toUpperCase();
        var btn = $('#login-btn');
        showLoginError('');
        btn.disabled = true;
        Core.joinCrew(fullName, joinCode, API_BASE)
          .then(function (res) {
            var session = res.session || {};
            if (!session.accessToken) {
              throw new Error('Connected, but no session came back. Try again in a moment.');
            }
            writeStoredSession(session.accessToken, session.refreshToken);
            return Promise.all([bootAccountSession(), playElevate()]);
          })
          .catch(function (err) {
            writeStoredSession(null, null);
            showLoginError(err.message || 'Could not connect. Check your name and the office invite code.');
          })
          .then(function () {
            btn.disabled = false;
          });
      });
    }
    if (state.accessToken) {
      bootAccountSession().catch(function () {
        writeStoredSession(null, null);
        bootBlocked();
      });
      return;
    }
    bootBlocked();
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
    if (state.account && !state.activeJobId) {
      setStatus('No open job to file this day against.', true);
      return;
    }
    state.finishing = false;
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
    if (!state.recorder || state.finishing) return;
    state.finishing = true;
    if (state.stopWatch) state.stopWatch();
    state.stopWatch = null;
    var stopLbl = $('#stopbtn') && $('#stopbtn').querySelector('.lbl');
    if (stopLbl) stopLbl.textContent = 'Finishing…';
    state.recorder
      .stop()
      .then(function (clip) {
        openDoorUploading();
        return Core.uploadDayFilm({
          token: TOKEN || undefined,
          jobId: state.account ? state.activeJobId : undefined,
          accessToken: state.account ? state.accessToken : undefined,
          apiBase: API_BASE,
          storageBase: STORAGE_BASE,
          blob: clip.blob,
          mimeType: clip.mimeType,
          onStep: function (step) {
            $('#upload-step').textContent = step;
          },
        });
      })
      .then(function (result) {
        state.uploadResult = result;
        renderDoorLive(result);
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

  /* ---------- hold to finish ----------
     Five seconds, not a tap. Accidental pocket presses must not end the day.
     Signed-in crew (account) and share-token crew both film through the same
     recorder — finish when that recorder exists, not only when ?token= is set. */

  var HOLD_MS = Core.HOLD_TO_FINISH_MS || 5000;
  var holdTimer = null;

  function finishFromHold() {
    var action = Core.resolveFinishHold({
      recorder: state.recorder,
      demoFinish: window.__demoFinish,
    });
    if (action === 'live') finishLiveDay();
    else if (action === 'demo' && window.__demoFinish) window.__demoFinish();
  }

  function bindHold() {
    var stopBtn = $('#stopbtn');
    if (!stopBtn) return;
    function holdLabel() {
      return stopBtn.querySelector('.lbl');
    }
    function beginHold(e) {
      if (e && e.cancelable) e.preventDefault();
      if (holdTimer || state.finishing) return;
      if (e && e.pointerId != null && stopBtn.setPointerCapture) {
        try {
          stopBtn.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is best-effort — iOS Safari still gets preventDefault */
        }
      }
      stopBtn.setAttribute('data-holding', '1');
      if (holdLabel()) holdLabel().textContent = 'Keep holding…';
      holdTimer = setTimeout(function () {
        holdTimer = null;
        finishFromHold();
      }, HOLD_MS);
    }
    function cancelHold(e) {
      /* pointerleave fires on tiny finger movement and on iOS callout chrome.
         Capture + pointerup/cancel are the only ways the hold should abort. */
      if (e && e.type === 'pointerleave') return;
      if (!holdTimer) return;
      clearTimeout(holdTimer);
      holdTimer = null;
      stopBtn.removeAttribute('data-holding');
      if (holdLabel()) holdLabel().textContent = 'Hold 5 seconds to finish';
    }
    stopBtn.addEventListener('pointerdown', beginHold, { passive: false });
    stopBtn.addEventListener('pointerup', cancelHold);
    stopBtn.addEventListener('pointercancel', cancelHold);
    stopBtn.addEventListener('pointerleave', cancelHold);
    stopBtn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
    stopBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        beginHold(e);
      }
    });
    stopBtn.addEventListener('keyup', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cancelHold(e);
      }
    });
  }

  /* ---------- demo (explicit only) ---------- */

  function bootDemo() {
    // Minimal demo path — scripted, never pretend to be live.
    document.body.setAttribute('data-mode', 'demo');
    setStatus('Demo mode (?demo=1) — not uploading.');
    $('#week-wrap').hidden = false;
    var JOBS = [
      {
        id: 'j1041',
        name: 'Meridian Ave — water loss, Class 3',
        addr: '1841 Meridian Ave, Austin',
        at: '7:00 AM',
        placed: true,
        sharePath: '/shared/demo-token?email=jack%40jettx.ai',
      },
    ];
    renderExpect(JOBS);
    var WEEK = [
      { what: 'Mon · Meridian after', chip: ['pass', 'Accepted'] },
      { what: 'Tue · Cedar Ridge', chip: ['warn', 'Needs eyes'] },
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
    when('#daybtn', function (btn) {
      btn.onclick = function () {
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
    });
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
    state.finishing = false;
    state.recorder = null;
    show('s-home');
    setStatus(LIVE || state.account ? 'Ready for another day.' : '');
  });

  if (LIVE) {
    document.body.setAttribute('data-mode', 'live');
    when('#daybtn', function (btn) { btn.addEventListener('click', startLiveDay); });
    bootLive();
  } else if (DEMO) {
    bootDemo();
  } else if (params.get('elevate') === '1') {
    /* Preview the connect → Today motion without a live session. */
    show('s-home');
    playElevate();
  } else {
    bootAccount();
  }
})();
