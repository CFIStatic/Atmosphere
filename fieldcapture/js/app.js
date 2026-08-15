/**
 * Field Capture — production UI controller.
 *
 * Each person signs in with their own dashboard login. Job invites are
 * accepted inside the app after sign-in. Day films save on this phone and
 * file when a path is available. Location rides along while recording.
 * Building measurements stay on the iPhone app — they do not run here
 * in the background.
 *
 *   signed in           → jobs from this office account
 *   ?token=             → held until this login accepts that job
 *   ?demo=1             → scripted demo only (explicit)
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var TOKEN = params.get('token') || params.get('share') || '';
  var FORCE_DEMO = params.get('demo') === '1';
  var API_BASE = params.get('api') || '';
  var STORAGE_BASE = params.get('storage') || '';
  var DEMO = FORCE_DEMO || params.get('allowDemo') === '1';
  var ACCESS_KEY = 'atm.field.accessToken';
  var REFRESH_KEY = 'atm.field.refreshToken';
  var INVITE_KEY = 'atm.field.pendingInvite';

  var Core = window.FieldCaptureCore;
  if (!Core) {
    console.error('capture-core.js failed to load');
    return;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  var SCREENS = ['s-home', 's-rec', 's-door', 's-blocked', 's-invite'];
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
    accessToken: null,
    refreshToken: null,
    jobs: [],
    activeJobId: null,
    account: false,
    me: null,
    shareJob: null,
    reviewingToken: null,
    inviteTokens: {},
    queued: 0,
    filing: false,
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

  function stashInvite(token) {
    if (!token) return;
    try {
      sessionStorage.setItem(INVITE_KEY, token);
    } catch (e) {
      /* private mode */
    }
  }

  function pendingInvite() {
    try {
      return sessionStorage.getItem(INVITE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function clearPendingInvite() {
    try {
      sessionStorage.removeItem(INVITE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  if (TOKEN) stashInvite(TOKEN);

  /* ---------- home hydration ---------- */

  function renderExpect(jobs) {
    var root = $('#expect');
    if (!root) return;
    if (!jobs.length) {
      root.innerHTML =
        '<div class="erow"><span class="t"><b>Nothing on the schedule for today</b><span>Add a job from the office, or accept an invite after you sign in.</span></span></div>';
      return;
    }
    root.innerHTML = jobs
      .map(function (j) {
        var selected = state.account && j.id && j.id === state.activeJobId;
        return (
          '<div class="erow"' +
          (j.id ? ' data-job-id="' + escapeHtml(j.id) + '"' : '') +
          (selected ? ' data-selected="1"' : '') +
          '>' +
          '<span class="t"><b>' +
          escapeHtml(j.name) +
          '</b><span>' +
          escapeHtml(j.addr) +
          (j.filmed ? ' <span class="filmedpin">· filmed today</span>' : '') +
          (j.placed ? '' : ' <span class="warnpin">· cannot be placed from GPS</span>') +
          '</span></span>' +
          '<span class="at">' +
          escapeHtml(j.filmed ? 'Filmed' : j.at || '') +
          '</span></div>'
        );
      })
      .join('');
    if (state.account) {
      root.querySelectorAll('[data-job-id]').forEach(function (row) {
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

  function setQueueBanner() {
    var text = '';
    if (state.queued > 0) {
      text = state.filing
        ? state.queued === 1
          ? 'Sending the day film to the dashboard…'
          : 'Sending ' + state.queued + ' day films to the dashboard…'
        : state.queued === 1
          ? 'Saved on this phone — files when you’re online.'
          : state.queued + ' day films saved on this phone — file when you’re online.';
    }
    ['home-queue', 'door-queue'].forEach(function (id) {
      var el = $(id.charAt(0) === '#' ? id : '#' + id);
      if (!el) return;
      el.hidden = !text;
      el.textContent = text;
    });
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
    state.me = me;
    state.jobs = (jobs || []).map(function (j) {
      return {
        id: j.id,
        name: (j.number ? j.number + ' · ' : '') + (j.name || 'Job'),
        addr: j.address || '',
        at: j.at || 'Today',
        placed: Boolean(j.placed),
        filmed: Boolean(j.filmed),
      };
    });
    if (!state.activeJobId || !state.jobs.some(function (j) { return j.id === state.activeJobId; })) {
      state.activeJobId = state.jobs[0] ? state.jobs[0].id : null;
    }
    var who = document.querySelector('.who');
    if (who) {
      var name = (me.user && (me.user.fullName || me.user.email)) || 'You';
      var org = (me.org && me.org.name) || 'Office';
      who.innerHTML = '<b>' + escapeHtml(name) + '</b>' + escapeHtml(org);
    }
    renderExpect(state.jobs);
    $('#week-wrap').hidden = true;
    $('#daybtn').disabled = !state.activeJobId;
    setStatus(
      state.activeJobId
        ? 'Ready — tap Start. Records video + microphone. Location rides along while you film.'
        : 'Nothing on the schedule for today. Accept a job invite or ask the office to start a job.',
    );
    show('s-home');
    refreshQueue();
    consumePendingInvite();
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
    $('#daybtn').addEventListener('click', startLiveDay);
    var form = $('#login-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var email = ($('#login-email').value || '').trim();
        var password = $('#login-password').value || '';
        var btn = $('#login-btn');
        showLoginError('');
        btn.disabled = true;
        Core.loginWithPassword(email, password, API_BASE)
          .then(function (res) {
            var session = res.session || {};
            if (!session.accessToken) {
              throw new Error('Signed in, but no session came back. Confirm your email if Atmosphere asked you to.');
            }
            writeStoredSession(session.accessToken, session.refreshToken);
            return bootAccountSession();
          })
          .catch(function (err) {
            writeStoredSession(null, null);
            showLoginError(err.message || 'Could not sign in. Use your dashboard email and password.');
          })
          .then(function () {
            btn.disabled = false;
          });
      });
    }
    if (state.accessToken) {
      bootAccountSession().catch(function () {
        writeStoredSession(null, null);
        show('s-blocked');
      });
      return;
    }
    show('s-blocked');
  }

  /* ---------- invites (after this login) ---------- */

  function showInviteError(message) {
    var el = $('#invite-err');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function resetInviteForm() {
    state.shareJob = null;
    state.reviewingToken = null;
    showInviteError('');
    if ($('#invite-title')) $('#invite-title').textContent = 'Paste a job invite';
    if ($('#invite-lede')) {
      $('#invite-lede').textContent =
        'The office sent a link for a job. Paste it here to add that job to this login. You can accept more than one.';
    }
    if ($('#invite-detail')) {
      $('#invite-detail').hidden = true;
      $('#invite-detail').innerHTML = '';
    }
    if ($('#invite-paste-wrap')) $('#invite-paste-wrap').hidden = false;
    if ($('#invite-name-wrap')) $('#invite-name-wrap').hidden = true;
    if ($('#invite-open')) $('#invite-open').hidden = false;
    if ($('#invite-accept')) $('#invite-accept').hidden = true;
  }

  function beginInvite() {
    if (!state.account) {
      show('s-blocked');
      return;
    }
    resetInviteForm();
    var held = pendingInvite();
    if (held && $('#invite-paste')) $('#invite-paste').value = held;
    var name = state.me && state.me.user && state.me.user.fullName;
    if (name && $('#invite-name')) $('#invite-name').value = name;
    show('s-invite');
  }

  function openInvite(raw) {
    var token = String(raw || '').trim();
    if (!token) {
      showInviteError('Paste the invite link.');
      return;
    }
    stashInvite(token);
    showInviteError('');
    Core.loadShareJob(token, API_BASE)
      .then(function (view) {
        state.shareJob = view;
        state.reviewingToken = token;
        var title = (view.job && view.job.title) || 'Job';
        $('#invite-title').textContent = title;
        $('#invite-lede').textContent =
          'This job will be added to this login. You can accept more than one invite.';
        var bits = [];
        if (view.you && view.you.company) {
          bits.push('<p>' + escapeHtml(view.you.company) + '</p>');
        }
        if (view.brief && view.brief.note) {
          bits.push('<div class="scope-card"><h3>Brief</h3><p>' + escapeHtml(view.brief.note) + '</p></div>');
        }
        (view.scope || []).slice(0, 8).forEach(function (item) {
          bits.push(
            '<div class="scope-card"><h3>' +
              escapeHtml((item.state || 'included').replace(/_/g, ' ')) +
              '</h3><p>' +
              escapeHtml(item.title || '') +
              (item.detail ? '<br>' + escapeHtml(item.detail) : '') +
              '</p></div>',
          );
        });
        $('#invite-detail').innerHTML = bits.join('');
        $('#invite-detail').hidden = bits.length === 0;
        $('#invite-paste-wrap').hidden = true;
        $('#invite-name-wrap').hidden = false;
        $('#invite-open').hidden = true;
        $('#invite-accept').hidden = false;
      })
      .catch(function (err) {
        showInviteError(err.message || 'Could not open that invite.');
      });
  }

  function acceptInvite() {
    var token = state.reviewingToken || pendingInvite();
    if (!token) {
      showInviteError('Paste an invite link to accept a job.');
      return;
    }
    var name = (($('#invite-name') || {}).value || '').trim();
    if (name.length < 2 && state.me && state.me.user && state.me.user.fullName) {
      name = state.me.user.fullName;
    }
    var btn = $('#invite-accept');
    if (btn) btn.disabled = true;
    showInviteError('');
    Core.acceptFieldInvite(API_BASE, state.accessToken, token, name || undefined)
      .then(function (job) {
        addAcceptedJob(job, null);
        clearPendingInvite();
        show('s-home');
      })
      .catch(function () {
        var revision = state.shareJob && state.shareJob.currentRevision;
        if (!revision || name.length < 2) {
          throw new Error('Sign in with the office this invite belongs to, then accept it again.');
        }
        return Core.acceptShareBrief(API_BASE, token, name, revision).then(function () {
          var view = state.shareJob || {};
          addAcceptedJob(
            {
              id: token,
              number: view.job && view.job.jobNumber != null ? '#' + view.job.jobNumber : '',
              name: (view.job && view.job.title) || 'Job',
              address: (view.you && view.you.company) || 'Invite',
            },
            token,
          );
          clearPendingInvite();
          show('s-home');
        });
      })
      .catch(function (err) {
        showInviteError(err.message || 'Could not accept that job.');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function addAcceptedJob(job, shareToken) {
    var row = {
      id: job.id,
      name: (job.number ? job.number + ' · ' : '') + (job.name || 'Job'),
      addr: job.address || '',
      at: job.at || 'Today',
      placed: true,
      filmed: false,
    };
    if (!state.jobs.some(function (j) { return j.id === row.id; })) {
      state.jobs.unshift(row);
    }
    state.activeJobId = row.id;
    if (shareToken) state.inviteTokens[row.id] = shareToken;
    renderExpect(state.jobs);
    $('#daybtn').disabled = false;
    setStatus('Job added to this login. Ready — tap Start.');
  }

  function consumePendingInvite() {
    var token = pendingInvite();
    if (!token || !state.account) return;
    beginInvite();
    openInvite(token);
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
        $('#live-text').textContent = 'Recording video + audio. Location stays with the film while you work.';
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
    state.recorder
      .stop()
      .then(function (clip) {
        var pending = {
          id: 'film-' + Date.now(),
          jobId: state.activeJobId || null,
          token: state.inviteTokens[state.activeJobId] || '',
          blob: clip.blob,
          mimeType: clip.mimeType,
          durationSeconds: clip.durationSeconds,
          lat: state.site && state.site.lat,
          lon: state.site && state.site.lon,
          accuracyM: state.site && state.site.accuracyM,
          workDate: Core.todayISO(),
        };
        return Core.savePendingFilm(pending).then(function () {
          return pending;
        });
      })
      .then(function (pending) {
        renderDoorSaved(pending);
        refreshQueue();
        processQueue();
      })
      .catch(function (err) {
        renderDoorFailed(err);
      });
  }

  function refreshQueue() {
    return Core.loadPendingFilms().then(function (items) {
      state.queued = items.length;
      setQueueBanner();
      return items;
    });
  }

  function processQueue() {
    if (state.filing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      refreshQueue();
      return;
    }
    state.filing = true;
    setQueueBanner();
    Core.loadPendingFilms()
      .then(function (items) {
        var next = Promise.resolve();
        items.forEach(function (item) {
          next = next.then(function () {
            return Core.uploadDayFilm({
              token: item.token || undefined,
              jobId: item.jobId || undefined,
              accessToken: state.accessToken || undefined,
              apiBase: API_BASE,
              storageBase: STORAGE_BASE,
              blob: item.blob,
              mimeType: item.mimeType,
              onStep: function () {},
            }).then(function (result) {
              state.uploadResult = result;
              return Core.removePendingFilm(item.id).then(function () {
                renderDoorLive(result);
              });
            });
          });
        });
        return next;
      })
      .catch(function () {
        /* stay queued — banner tells them it is on the phone */
      })
      .then(function () {
        state.filing = false;
        return refreshQueue();
      });
  }

  function renderDoorSaved(pending) {
    show('s-door');
    var jobName = (state.jobs.filter(function (j) { return j.id === (pending && pending.jobId); })[0] || {}).name || 'today';
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Filmed live — video + audio</span><em>mic track required</em><span class="ok">✓</span></div>' +
      '<div class="lrow on"><span>Saved on this phone</span><em>uploads when you’re online</em><span class="ok">✓</span></div>' +
      '<div class="lrow on"><span>Location</span><em>' +
      escapeHtml((state.site && state.site.label) || 'unknown — office will review') +
      '</em><span class="ok">' +
      (state.site && state.site.lat != null ? '✓' : '!') +
      '</span></div>' +
      '<div class="lrow on"><span>Building measurements</span><em>iPhone app when this job has none</em><span class="ok">→</span></div>';
    $('#daytl').innerHTML =
      '<div class="tlrow"><b>' +
      escapeHtml(jobName) +
      '</b><span>Day film is on this phone. It files to the dashboard when you have a signal. Measuring the building is a short walk on the iPhone app — not an always-on scan.</span></div>';
    $('#doneline').classList.add('on');
    $('#donebtn').classList.add('on');
    setQueueBanner();
  }

  function renderDoorLive(result) {
    var problems = result.problems || [];
    var checks = result.checks || [];
    var rows = [];
    rows.push(
      '<div class="lrow on"><span>Filmed live — video + audio</span><em>mic track required</em><span class="ok">✓</span></div>',
    );
    rows.push(
      '<div class="lrow on"><span>Filed to the dashboard</span><em>' +
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
    var jobName = state.job && state.job.job ? state.job.job.title : 'Job';
    $('#daytl').innerHTML =
      '<div class="tlrow"><b>' +
      escapeHtml(jobName) +
      '</b><span>Day film filed as today’s after proof. Office Verifier will show video, audio, and AI dictation when analysis finishes.</span>' +
      '<span class="mono">proof ' +
      escapeHtml((result.proof && result.proof.id) || 'filed') +
      '</span></div>';
    $('#doneline').classList.add('on');
    $('#donebtn').classList.add('on');
    setQueueBanner();
  }

  function renderDoorFailed(err) {
    show('s-door');
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Save issue</span><em>' +
      escapeHtml(err.message || 'Try again') +
      '</em><span class="ok">!</span></div>' +
      '<div class="lrow on"><span>Recording</span><em>kept on this phone until you retry</em><span class="ok">→</span></div>';
    $('#daytl').innerHTML = '';
    $('#doneline').classList.add('on');
    $('#doneline').querySelector('small').textContent =
      'Do not delete the app data. The film stays here until it can file.';
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
        if (state.account) finishLiveDay();
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
        if (state.account) finishLiveDay();
        else if (window.__demoFinish) window.__demoFinish();
      }
    });
  }

  /* ---------- demo (explicit only) ---------- */

  function bootDemo() {
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
        '<div class="tlrow"><b>Demo day</b><span>Sign in with your own login to file a real day film.</span></div>';
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
    setStatus(state.account ? 'Ready for another day.' : '');
    refreshQueue();
  });
  if ($('#home-invite')) {
    $('#home-invite').addEventListener('click', beginInvite);
  }
  if ($('#invite-open')) {
    $('#invite-open').addEventListener('click', function () {
      openInvite((($('#invite-paste') || {}).value || ''));
    });
  }
  if ($('#invite-accept')) {
    $('#invite-accept').addEventListener('click', acceptInvite);
  }
  if ($('#invite-cancel')) {
    $('#invite-cancel').addEventListener('click', function () {
      show(state.account ? 's-home' : 's-blocked');
    });
  }
  window.addEventListener('online', function () {
    processQueue();
  });

  if (DEMO) {
    bootDemo();
  } else {
    bootAccount();
  }
})();
