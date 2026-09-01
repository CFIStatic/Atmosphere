/**
 * Field Capture — production UI controller.
 *
 * Modes:
 *   ?token=<job-share>  → live MediaRecorder + proof upload (no office login)
 *   signed in           → same email + password as the office Platform, jobs from that office
 *   ?demo=1             → scripted demo only (explicit)
 */
(function () {
  'use strict';

  var Core = window.FieldCaptureCore;
  if (!Core) {
    console.error('capture-core.js failed to load');
    return;
  }

  var params = new URLSearchParams(location.search);
  var TOKEN = params.get('token') || params.get('share') || '';
  var FORCE_DEMO = params.get('demo') === '1';
  var API_BASE = Core.resolveApiBase
    ? Core.resolveApiBase(params.get('api') || '')
    : (params.get('api') || '');
  var STORAGE_BASE = params.get('storage') || '';
  var LIVE = Boolean(TOKEN) && !FORCE_DEMO;
  var DEMO = FORCE_DEMO || (!TOKEN && params.get('allowDemo') === '1');
  var ACCESS_KEY = 'atm.field.accessToken';
  var REFRESH_KEY = 'atm.field.refreshToken';

  function $(sel) {
    return document.querySelector(sel);
  }

  function when(sel, fn) {
    var node = $(sel);
    if (node) fn(node);
  }

  function initialsFrom(name, email) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
    if (email) return String(email).replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || '•';
    return '—';
  }

  function closeFieldAccountMenu() {
    var btn = document.getElementById('who-btn');
    var menu = document.getElementById('who-menu');
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function showFieldAccount(on, opts) {
    var wrap = document.getElementById('who-wrap');
    var settings = document.getElementById('fc-menu-settings');
    var signout = document.getElementById('fc-menu-signout');
    if (wrap) wrap.hidden = !on;
    if (!on) closeFieldAccountMenu();
    var accountActions = Boolean(opts && opts.account);
    if (settings) settings.hidden = !accountActions;
    if (signout) signout.hidden = !accountActions;
  }

  function isDisplayableAvatarUrl(url) {
    return typeof url === 'string' && /^(https?:|data:image\/)/.test(url.trim());
  }

  function paintAvatar(el, initials, avatarUrl) {
    if (!el) return;
    el.replaceChildren();
    var photo = isDisplayableAvatarUrl(avatarUrl) ? String(avatarUrl).trim() : '';
    if (!photo) {
      el.textContent = initials;
      return;
    }
    var img = document.createElement('img');
    img.src = photo;
    img.alt = '';
    img.addEventListener('error', function () {
      el.replaceChildren();
      el.textContent = initials;
    });
    el.appendChild(img);
  }

  function paintFieldAccount(opts) {
    opts = opts || {};
    var name = opts.name || 'Your account';
    var org = opts.org || '';
    var email = opts.email || '';
    var whoName = document.getElementById('who-name');
    var whoSub = document.getElementById('who-sub');
    var avatar = document.getElementById('who-avatar');
    var menuName = document.getElementById('menu-name');
    var menuEmail = document.getElementById('menu-email');
    var menuMeta = document.getElementById('menu-meta');
    if (whoName) whoName.textContent = name;
    if (whoSub) whoSub.textContent = org;
    paintAvatar(avatar, initialsFrom(name, email), opts.avatarUrl);
    if (menuName) menuName.textContent = name;
    if (menuEmail) {
      menuEmail.textContent = email;
      menuEmail.hidden = !email;
    }
    if (menuMeta) {
      menuMeta.textContent = org;
      menuMeta.hidden = !org;
    }
    showFieldAccount(true, { account: Boolean(opts.account) });
  }

  var SCREENS = ['s-home', 's-new-job', 's-rec', 's-door', 's-blocked', 's-office', 's-platform'];
  function show(id) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.setAttribute('data-on', s === id ? '1' : '0');
    });
    document.body.setAttribute('data-screen', id);
    var app = document.getElementById('app');
    if (app) {
      app.setAttribute(
        'data-switch',
        id === 's-home' || id === 's-new-job' || id === 's-office' || id === 's-platform' ? 'on' : 'off',
      );
    }
    var todayTab = document.querySelector('#product-switch a[href="#today"]');
    var platformTab = document.getElementById('platform-link');
    if (todayTab) {
      if (id === 's-home' || id === 's-new-job') todayTab.setAttribute('aria-current', 'page');
      else todayTab.removeAttribute('aria-current');
    }
    if (platformTab) {
      if (id === 's-platform') platformTab.setAttribute('aria-current', 'page');
      else platformTab.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  function stopDemoPreview() {
    if (state.demoStream) {
      state.demoStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.demoStream = null;
    }
    var preview = $('#preview');
    if (preview) preview.srcObject = null;
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
    lastClip: null,
    job: null,
    site: null,
    seconds: 0,
    finishing: false,
    accessToken: null,
    refreshToken: null,
    jobs: [],
    listedJobs: [],
    jobQuery: '',
    activeJobId: null,
    account: false,
    demoStream: null,
  };

  var DONELINE_OK =
    'You just record. The office opens the Verifier to watch and hear the day film with an AI dictation against the scope. Anything the model could not see shows up there as a named gap, never as a guess on your phone.';
  var DONELINE_FAIL =
    'The recording is still on this phone. Fix signal and tap Retry upload — or go back to Home Screen and ask the office for help.';
  var DONELINE_FAIL_NO_CLIP =
    'The recording was not saved on this phone. Go back to Home Screen and start the day again — or ask the office for help.';

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

  function jobMetaLine(j) {
    var bits = [];
    if (j.addr) bits.push(escapeHtml(j.addr));
    if (j.filmed) bits.push('<span class="filmedpin">Filmed today</span>');
    else if (j.placed === false) bits.push('<span class="warnpin">Location not placed</span>');
    return bits.join(' · ') || 'Open job';
  }

  function toListedJob(j) {
    return {
      id: j.id,
      name: (j.number ? j.number + ' · ' : '') + (j.name || 'Job'),
      addr: j.address || j.addr || '',
      at: j.at || 'Today',
      placed: j.placed !== false,
      filmed: Boolean(j.filmed),
      sharePath: j.sharePath || '',
    };
  }

  function showJobAdd(on) {
    when('#job-add', function (btn) {
      btn.hidden = !on;
    });
  }

  function bindJobSearch() {
    var input = $('#job-search');
    if (!input || input.getAttribute('data-bound') === '1') return;
    input.setAttribute('data-bound', '1');
    input.addEventListener('input', function () {
      state.jobQuery = input.value;
      renderExpect();
    });
  }

  function showNewJobError(message) {
    var el = $('#new-job-err');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function openNewJobForm() {
    if (LIVE) return;
    if ($('#job-add') && $('#job-add').hidden) return;
    showNewJobError('');
    var name = $('#new-job-name');
    var note = $('#new-job-note');
    if (name) name.value = '';
    if (note) note.value = '';
    when('#new-job-btn', function (btn) { btn.disabled = false; });
    show('s-new-job');
    if (name) name.focus();
  }

  function selectCreatedJob(job) {
    var listed = toListedJob(job);
    state.jobs = [listed].concat(
      (state.jobs || []).filter(function (j) {
        return j.id !== listed.id;
      }),
    );
    state.activeJobId = listed.id;
    renderExpect(state.jobs);
    when('#daybtn', function (btn) { btn.disabled = !state.activeJobId; });
    setStatus('Ready — start the day.');
  }

  function startRecordingForNewJob(stream) {
    if (DEMO && typeof window.__startDemoDay === 'function') {
      window.__startDemoDay();
      return;
    }
    startLiveDay(stream);
  }

  function bindNewJob() {
    var add = $('#job-add');
    if (add && add.getAttribute('data-bound') !== '1') {
      add.setAttribute('data-bound', '1');
      add.addEventListener('click', openNewJobForm);
    }
    when('#new-job-cancel', function (btn) {
      if (btn.getAttribute('data-bound') === '1') return;
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', function () {
        show('s-home');
      });
    });
    var form = $('#new-job-form');
    if (!form || form.getAttribute('data-bound') === '1') return;
    form.setAttribute('data-bound', '1');
    when('#new-job-name', function (input) {
      input.addEventListener('input', function () {
        showNewJobError('');
      });
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var title = (($('#new-job-name') && $('#new-job-name').value) || '').trim();
      var situation = (($('#new-job-note') && $('#new-job-note').value) || '').trim();
      var btn = $('#new-job-btn');
      showNewJobError('');
      if (!title) {
        showNewJobError('Enter a name.');
        return;
      }
      if (btn && btn.disabled) return;
      if (btn) btn.disabled = true;

      function finishLocal(job, stream) {
        selectCreatedJob(job);
        startRecordingForNewJob(stream);
      }

      if (DEMO || (!state.account && !state.accessToken)) {
        finishLocal({
          id: 'new-' + Date.now(),
          name: title,
          address: '',
          at: 'Today',
          placed: true,
        });
        return;
      }

      /* Ask for camera/mic in this tap. A POST-then-getUserMedia gap is
         why iPhone Safari refuses the prompt and a second tap files
         another job. Keep the stream and only create the job after. */
      var media =
        navigator.mediaDevices && navigator.mediaDevices.getUserMedia
          ? navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: 'environment' } },
              audio: true,
            })
          : Promise.reject(new Error('This browser cannot record video + audio.'));

      media
        .then(function (stream) {
          return Core.createTodayJob({
            apiBase: API_BASE,
            accessToken: state.accessToken,
            title: title,
            situation: situation,
          }).then(
            function (job) {
              return { job: job, stream: stream };
            },
            function (err) {
              stream.getTracks().forEach(function (t) {
                t.stop();
              });
              throw err;
            },
          );
        })
        .then(function (result) {
          finishLocal(result.job, result.stream);
        })
        .catch(function (err) {
          if (btn) btn.disabled = false;
          showNewJobError(err.message || 'Could not create that job.');
        });
    });
  }

  function renderExpect(jobs) {
    var root = $('#expect');
    if (!root) return;
    if (jobs) state.listedJobs = jobs;
    var all = state.listedJobs || [];
    var visible = Core.filterJobs(all, state.jobQuery);
    var hint = $('#job-hint');
    if (!all.length) {
      if (hint) hint.hidden = true;
      var addOpen = $('#job-add') && !$('#job-add').hidden;
      root.innerHTML =
        '<div class="erow erow-empty" role="status">' +
        '<span class="t"><b>Nothing assigned yet</b><span>' +
        (addOpen
          ? 'Tap + to start a new job, or ask the office to put you on one.'
          : 'Ask the office to put you on a job, then refresh.') +
        '</span></span>' +
        '</div>';
      return;
    }
    if (!visible.length) {
      if (hint) hint.hidden = true;
      root.innerHTML =
        '<div class="erow erow-empty" role="status">' +
        '<span class="t"><b>No matching jobs</b><span>Try a different name or address.</span></span>' +
        '</div>';
      return;
    }
    if (hint) hint.hidden = false;
    root.innerHTML = visible
      .map(function (j) {
        var selected = Boolean(j.id && j.id === state.activeJobId);
        var selectable = Boolean(j.id);
        var tag = selectable ? 'button' : 'div';
        var extra = selectable
          ? ' type="button" role="option" aria-selected="' + (selected ? 'true' : 'false') + '"'
          : '';
        return (
          '<' + tag + ' class="erow"' +
          extra +
          (j.id ? ' data-job-id="' + escapeHtml(j.id) + '"' : '') +
          (selected ? ' data-selected="1"' : '') +
          '>' +
          (selectable ? '<span class="pick" aria-hidden="true"></span>' : '') +
          '<span class="t"><b>' +
          escapeHtml(j.name) +
          '</b><span>' +
          jobMetaLine(j) +
          '</span></span>' +
          '<span class="at">' +
          escapeHtml(j.filmed ? 'Filmed' : j.at || '') +
          '</span></' + tag + '>'
        );
      })
      .join('');
    root.querySelectorAll('[data-job-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        state.activeJobId = row.getAttribute('data-job-id');
        renderExpect();
        when('#daybtn', function (btn) { btn.disabled = !state.activeJobId; });
      });
    });
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
    el.hidden = !msg;
    el.style.color = isErr ? 'var(--fail)' : 'var(--muted)';
  }

  function bootLive() {
    show('s-home');
    setStatus('Loading job…');
    Core.loadShareJob(TOKEN, API_BASE)
      .then(function (payload) {
        state.job = payload;
        var title = (payload.job && payload.job.title) || 'Job';
        var num = (payload.job && payload.job.jobNumber) || '';
        var company = (payload.you && payload.you.company) || 'Crew';
        paintFieldAccount({
          name: company,
          org: 'Field Capture',
          account: false,
        });
        renderExpect([
          {
            name: (num ? num + ' · ' : '') + title,
            addr: payload.job && payload.job.claimNumber ? 'Claim ' + payload.job.claimNumber : 'Shared job',
            at: 'Today',
            placed: true,
            sharePath: '/shared/' + TOKEN,
          },
        ]);
        showJobAdd(false);
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
    showFieldAccount(false);
    showJobAdd(false);
    $('#blocked-msg').textContent =
      'Sign in once — Field Capture and the in-app Platform use the same account.';
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

  function showOfficeError(message) {
    var el = $('#office-err');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function isNoOrganization(err) {
    if (!err) return false;
    if (err.code === 'no_organization') return true;
    var msg = String(err.message || '').toLowerCase();
    return (
      err.status === 403 &&
      (msg.indexOf('organization') !== -1 ||
        msg.indexOf('office') !== -1 ||
        msg.indexOf('onboard') !== -1)
    );
  }

  function showOfficeLink() {
    show('s-office');
    showOfficeError('');
  }

  function finishAccountConnect() {
    return bootAccountSession().then(function () {
      return playElevate();
    });
  }

  function enterAccountHome(me, jobs) {
    state.account = true;
    state.jobs = (jobs || []).map(toListedJob);
    if (!state.activeJobId || !state.jobs.some(function (j) { return j.id === state.activeJobId; })) {
      state.activeJobId = state.jobs[0] ? state.jobs[0].id : null;
    }
    paintFieldAccount({
      name: (me.user && (me.user.fullName || me.user.email)) || 'You',
      email: (me.user && me.user.email) || '',
      org: (me.org && me.org.name) || 'Office',
      avatarUrl: (me.user && me.user.avatarUrl) || null,
      account: true,
    });
    showJobAdd(true);
    renderExpect(state.jobs);
    when('#daybtn', function (btn) { btn.disabled = !state.activeJobId; });
    setStatus(
      state.activeJobId
        ? 'Ready — pick a job.'
        : 'No jobs yet. Tap + to start one.',
    );
    show('s-home');
    warmPlatformFrame();
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
    when('#password-toggle', function (toggle) {
      toggle.addEventListener('click', function () {
        var input = $('#login-password');
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
    var form = $('#login-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var email = ($('#login-email') && $('#login-email').value || '').trim();
        var password = ($('#login-password') && $('#login-password').value || '');
        var btn = $('#login-btn');
        showLoginError('');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showLoginError('Enter a valid email address.');
          return;
        }
        if (password.length < 8) {
          showLoginError('Password must be at least 8 characters.');
          return;
        }
        btn.disabled = true;
        Core.loginWithPassword(email, password, API_BASE)
          .then(function (res) {
            var session = res.session || {};
            if (!session.accessToken) {
              throw new Error('Signed in, but no session came back. Confirm your email if Atmosphere asked you to.');
            }
            writeStoredSession(session.accessToken, session.refreshToken);
            return finishAccountConnect();
          })
          .catch(function (err) {
            if (isNoOrganization(err)) {
              showOfficeLink();
              return;
            }
            writeStoredSession(null, null);
            showLoginError(err.message || 'Could not sign in. Use the same email and password as the office Platform.');
          })
          .then(function () {
            btn.disabled = false;
          });
      });
    }
    var officeForm = $('#office-form');
    if (officeForm) {
      officeForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var mode = officeForm.getAttribute('data-mode') || 'join';
        var code = (($('#office-code') && $('#office-code').value) || '').trim().toUpperCase();
        var name = (($('#office-name') && $('#office-name').value) || '').trim();
        var officeBtn = $('#office-btn');
        showOfficeError('');
        if (mode === 'join') {
          if (code.length < 6 || code.length > 12) {
            showOfficeError('Enter a valid 6–12 character office join code.');
            return;
          }
        } else if (name.length < 2) {
          showOfficeError('Enter an office name.');
          return;
        }
        if (!state.accessToken) {
          showOfficeError('Sign in first, then link this login to an office.');
          return;
        }
        officeBtn.disabled = true;
        Core.linkOffice({
          apiBase: API_BASE,
          accessToken: state.accessToken,
          joinCode: mode === 'join' ? code : undefined,
          orgName: mode === 'create' ? name : undefined,
        })
          .then(function () {
            return finishAccountConnect();
          })
          .catch(function (err) {
            showOfficeError(err.message || 'Could not link this login to an office.');
          })
          .then(function () {
            officeBtn.disabled = false;
          });
      });
    }
    when('#office-mode-toggle', function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var mode = officeForm && officeForm.getAttribute('data-mode') === 'create' ? 'join' : 'create';
        if (officeForm) officeForm.setAttribute('data-mode', mode);
        var joinFields = $('#office-join-fields');
        var createFields = $('#office-create-fields');
        var btnLbl = $('#office-btn') && $('#office-btn').querySelector('.lbl');
        if (joinFields) joinFields.hidden = mode !== 'join';
        if (createFields) createFields.hidden = mode !== 'create';
        if (btnLbl) {
          btnLbl.textContent = mode === 'join' ? 'Link to office account' : 'Start office & connect';
        }
        link.textContent = mode === 'join' ? 'Start a new office' : 'Join an office with a code';
        showOfficeError('');
      });
    });
    when('#office-switch-account', function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        writeStoredSession(null, null);
        showOfficeError('');
        bootBlocked();
        showLoginError('');
      });
    });
    if (state.accessToken) {
      bootAccountSession().catch(function (err) {
        if (isNoOrganization(err)) {
          showOfficeLink();
          return;
        }
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

  function startLiveDay(stream) {
    if (stream && typeof stream.getTracks !== 'function') stream = undefined;
    if (state.account && !state.activeJobId) {
      setStatus('No open job to file this day against.', true);
      return;
    }
    if (state.finishing) {
      setStatus('The last day is still uploading.', true);
      return;
    }
    state.finishing = false;
    var videoEl = $('#preview');
    state.recorder = Core.recordDayFilm({
      videoEl: videoEl,
      stream: stream,
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
        state.stopWatch = state.recorder.watchPosition(function (site) {
          state.site = site;
          $('#site-text').textContent = site.label;
          $('#sitestrip').className = 'sitestrip' + (site.lat == null ? ' unsure' : '');
        });
      })
      .catch(function (err) {
        if (stream) {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
        }
        setStatus(err.message || 'Could not start camera/mic.', true);
        alert(err.message || 'Could not start camera/mic.');
        show('s-home');
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
        state.lastClip = clip;
        return uploadLastClip();
      })
      .catch(function (err) {
        openDoorUploading();
        $('#upload-step').textContent = err.message || 'Upload failed.';
        $('#upload-step').style.color = 'var(--fail)';
        renderDoorFailed(err);
      });
  }

  function uploadLastClip() {
    var clip = state.lastClip;
    if (!clip || !clip.blob) {
      return Promise.reject(new Error('Nothing to upload. Record the day again.'));
    }
    openDoorUploading();
    return Core.uploadDayFilm({
      token: TOKEN || undefined,
      jobId: state.account ? state.activeJobId : undefined,
      accessToken: state.account ? state.accessToken : undefined,
      apiBase: API_BASE,
      storageBase: STORAGE_BASE,
      blob: clip.blob,
      mimeType: clip.mimeType,
      knownSite: state.site || null,
      onStep: function (step) {
        var stepEl = $('#upload-step');
        if (stepEl) {
          stepEl.textContent = step;
          stepEl.style.color = '';
        }
      },
      onProgress: function (ratio) {
        var bar = $('#upload-bar');
        var pct = $('#upload-pct');
        var pctVal = Math.round((ratio || 0) * 100);
        if (bar) bar.style.width = pctVal + '%';
        if (pct) pct.textContent = pctVal + '%';
      },
    }).then(
      function (result) {
        state.uploadResult = result;
        if (state.lastClip === clip) state.lastClip = null;
        renderDoorLive(result);
        return result;
      },
      function (err) {
        var stepEl = $('#upload-step');
        if (stepEl) {
          stepEl.textContent = err.message || 'Upload failed.';
          stepEl.style.color = 'var(--fail)';
        }
        renderDoorFailed(err);
      },
    );
  }

  function openDoorUploading() {
    show('s-door');
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Uploading</span><em id="upload-step">Starting…</em><span class="ok" id="upload-pct">0%</span></div>' +
      '<div class="upload-meter" aria-hidden="true"><div class="upload-meter-fill" id="upload-bar"></div></div>';
    $('#daytl').innerHTML = '';
    $('#doneline').classList.remove('on');
    var copy = $('#doneline-copy');
    if (copy) copy.textContent = DONELINE_OK;
    /* Home stays available while reading/uploading — crews must never be
       stuck on the door if the phone stalls mid-step. Retry waits for fail. */
    hideDoorActions();
    showHomeAction();
  }

  function hideDoorActions() {
    var done = $('#donebtn');
    var retry = $('#retrybtn');
    if (done) done.classList.remove('on');
    if (retry) retry.classList.remove('on');
  }

  function showHomeAction() {
    var done = $('#donebtn');
    if (done) done.classList.add('on');
  }

  function showRetryAction() {
    var retry = $('#retrybtn');
    if (retry) retry.classList.add('on');
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
    var copy = $('#doneline-copy');
    if (copy) copy.textContent = DONELINE_OK;
    $('#doneline').classList.add('on');
    hideDoorActions();
    showHomeAction();
    state.finishing = false;
  }

  function renderDoorFailed(err) {
    show('s-door');
    $('#ledger').innerHTML =
      '<div class="lrow on"><span>Upload failed</span><em>' +
      escapeHtml(err.message || 'Try again') +
      '</em><span class="ok">!</span></div>' +
      '<div class="lrow on"><span>Recording</span><em>' +
      (state.lastClip ? 'kept on this phone — tap Retry upload' : 'not saved — record again') +
      '</em><span class="ok">→</span></div>';
    $('#daytl').innerHTML = '';
    var copy = $('#doneline-copy');
    if (copy) copy.textContent = state.lastClip ? DONELINE_FAIL : DONELINE_FAIL_NO_CLIP;
    $('#doneline').classList.add('on');
    hideDoorActions();
    if (state.lastClip) showRetryAction();
    showHomeAction();
    state.finishing = false;
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
    setStatus('');
    var JOBS = [
      {
        id: 'j1041',
        name: 'Meridian Ave — water loss, Class 3',
        addr: '1841 Meridian Ave, Austin',
        at: '7:00 AM',
        placed: true,
      },
      {
        id: 'j1042',
        name: 'Cedar Ridge — roof, wind',
        addr: '902 Cedar Ridge Dr, Austin',
        at: '9:30 AM',
        placed: true,
      },
      {
        id: 'j1043',
        name: 'Oak Hill — mold, Class 2',
        addr: '4412 Convict Hill Rd, Austin',
        at: '11:15 AM',
        placed: true,
      },
      {
        id: 'j1044',
        name: 'East 6th — kitchen, water',
        addr: '1801 E 6th St, Austin',
        at: '1:45 PM',
        placed: false,
      },
    ];
    state.jobs = JOBS;
    state.activeJobId = JOBS[0].id;
    paintFieldAccount({
      name: 'Field tech',
      email: 'you@office.test',
      org: 'Your office',
      account: true,
    });
    showJobAdd(true);
    renderExpect(JOBS);

    var seconds = 0;
    var timer = null;
    function startDemoDay() {
      show('s-rec');
      $('#scene').innerHTML = '';
      var preview = $('#preview');
      if (preview) preview.hidden = false;
      seconds = 0;
      $('#clock').textContent = fmt(0);
      timer = setInterval(function () {
        seconds += 1;
        $('#clock').textContent = fmt(seconds);
      }, 1000);
      $('#site-text').textContent = 'Demo site';
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
          .then(function (stream) {
            state.demoStream = stream;
            Core.bindLivePreview(preview, stream);
          })
          .catch(function () {});
      }
    }
    window.__startDemoDay = startDemoDay;
    when('#daybtn', function (btn) {
      btn.onclick = startDemoDay;
    });
    window.__demoFinish = function () {
      if (timer) clearInterval(timer);
      stopDemoPreview();
      show('s-door');
      $('#ledger').innerHTML =
        '<div class="lrow on"><span>Demo only</span><em>nothing uploaded</em><span class="ok">✓</span></div>';
      $('#daytl').innerHTML =
        '<div class="tlrow"><b>Demo day</b><span>Open with ?token= to file a real day film.</span></div>';
      $('#doneline').classList.add('on');
      hideDoorActions();
      showHomeAction();
    };
    show('s-home');
  }

  var warmPlatformFrame = function () {};

  /* ---------- wire ---------- */

  var now = new Date();
  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var dateEl = $('#today-date');
  if (dateEl) {
    dateEl.textContent = DAYS[now.getDay()] + ' · ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
  }

  bindHold();
  (function bindProductSwitch() {
    var link = document.getElementById('platform-link');
    var frame = document.getElementById('platform-frame');
    if (link && Core.resolveOfficePlatformHref) {
      link.href = Core.resolveOfficePlatformHref('/verifier-library');
    }
    var forgot = document.getElementById('forgot-link');
    if (forgot && Core.resolveOfficeHref) {
      forgot.href = Core.resolveOfficeHref('/forgot-password');
    }
    var signup = document.getElementById('signup-link');
    if (signup && Core.resolveOfficeHref) {
      signup.href = Core.resolveOfficeHref('/signup');
    }

    function officeFrameOrigin(href) {
      try {
        return new URL(href, location.href).origin;
      } catch (e) {
        return '';
      }
    }

    function applyOfficeTheme(preference) {
      if (preference !== 'light' && preference !== 'dark') return;
      document.documentElement.setAttribute('data-theme', preference);
      document.documentElement.setAttribute('data-theme-preference', preference);
      try {
        localStorage.setItem('atmosphere.theme', preference);
        localStorage.setItem('atm-theme', preference);
      } catch (e) {
        /* private mode */
      }
      labelFieldThemeToggle(preference);
    }

    function labelFieldThemeToggle(preference) {
      var toggle = document.getElementById('fc-theme-toggle');
      if (!toggle) return;
      var next = preference === 'dark' ? 'light' : 'dark';
      toggle.setAttribute('aria-label', 'Switch to ' + next + ' mode');
      toggle.setAttribute('title', (preference === 'dark' ? 'Dark' : 'Light') + ' mode. Click for ' + next + '.');
      var text = toggle.querySelector('.theme-toggle-label');
      if (text) text.textContent = 'Appearance: ' + (preference === 'dark' ? 'Dark' : 'Light');
    }

    var fieldThemeBtn = document.getElementById('fc-theme-toggle');
    if (fieldThemeBtn) {
      labelFieldThemeToggle(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
      fieldThemeBtn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyOfficeTheme(current === 'dark' ? 'light' : 'dark');
        postFieldTheme();
      });
    }

    function postFieldTheme() {
      if (!frame || !frame.contentWindow) return;
      var href = frame.getAttribute('src') || '';
      if (!href || href === 'about:blank') return;
      var target = officeFrameOrigin(href);
      if (!target) return;
      var preference = document.documentElement.getAttribute('data-theme');
      if (preference !== 'light' && preference !== 'dark') return;
      frame.contentWindow.postMessage({ atmosphere: 'theme', preference: preference }, target);
    }

    function postFieldSession() {
      if (!frame || !frame.contentWindow) return;
      var href = frame.getAttribute('src') || '';
      if (!href || href === 'about:blank') return;
      var target = officeFrameOrigin(href);
      if (!target) return;
      if (!state.refreshToken && !state.accessToken) {
        frame.contentWindow.postMessage({ atmosphere: 'field-session-missing' }, target);
        return;
      }
      frame.contentWindow.postMessage(
        {
          atmosphere: 'field-session',
          refreshToken: state.refreshToken,
          accessToken: state.accessToken,
        },
        target,
      );
    }

    function setPlatformFrame(pathname) {
      var path = pathname || '/verifier-library';
      var href = (link && link.getAttribute('href')) || '';
      if (Core.resolveOfficePlatformHref) {
        href = Core.resolveOfficePlatformHref(path);
        if (link && path === '/verifier-library') link.href = href;
      }
      if (frame && href && frame.getAttribute('src') !== href) {
        frame.setAttribute('src', href);
      }
    }

    warmPlatformFrame = function () {
      setPlatformFrame('/verifier-library');
    };

    function openPlatformInFrame(pathname) {
      setPlatformFrame(pathname || '/verifier-library');
      show('s-platform');
      postFieldSession();
    }

    function signOutFieldAccount() {
      closeFieldAccountMenu();
      writeStoredSession(null, null);
      state.account = false;
      state.jobs = [];
      state.activeJobId = null;
      showJobAdd(false);
      if (frame) frame.setAttribute('src', 'about:blank');
      showLoginError('');
      bootBlocked();
    }

    var whoBtn = document.getElementById('who-btn');
    var whoMenu = document.getElementById('who-menu');
    if (whoBtn && whoMenu) {
      whoBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (!whoMenu.hidden) {
          closeFieldAccountMenu();
          return;
        }
        whoMenu.hidden = false;
        whoBtn.setAttribute('aria-expanded', 'true');
      });
      document.addEventListener('click', function (event) {
        if (whoMenu.hidden) return;
        if (whoMenu.contains(event.target) || whoBtn.contains(event.target)) return;
        closeFieldAccountMenu();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeFieldAccountMenu();
      });
    }
    var menuSettings = document.getElementById('fc-menu-settings');
    if (menuSettings) {
      menuSettings.addEventListener('click', function () {
        closeFieldAccountMenu();
        openPlatformInFrame('/settings');
      });
    }
    var menuSignout = document.getElementById('fc-menu-signout');
    if (menuSignout) {
      menuSignout.addEventListener('click', signOutFieldAccount);
    }

    if (frame) {
      frame.addEventListener('load', function () {
        postFieldSession();
        postFieldTheme();
      });
    }
    window.addEventListener('message', function (event) {
      if (!frame || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data) return;
      if (data.atmosphere === 'request-field-session') {
        postFieldSession();
        return;
      }
      if (data.atmosphere === 'theme') {
        applyOfficeTheme(data.preference);
        return;
      }
      if (data.atmosphere === 'sign-out') {
        signOutFieldAccount();
      }
    });
    if (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var blocked = document.getElementById('s-blocked');
        if (blocked && blocked.getAttribute('data-on') === '1') return;
        openPlatformInFrame();
      });
    }
    var today = document.querySelector('#product-switch a[href="#today"]');
    if (today) {
      today.addEventListener('click', function (event) {
        event.preventDefault();
        var blocked = document.getElementById('s-blocked');
        if (blocked && blocked.getAttribute('data-on') === '1') return;
        var office = document.getElementById('s-office');
        if (office && office.getAttribute('data-on') === '1') return;
        show('s-home');
      });
    }
  })();
  $('#donebtn').addEventListener('click', function () {
    /* Leave even if reading/uploading is still running — do not trap the crew.
       Keep lastClip and finishing while the PUT is in flight so a later
       failure can still offer Retry, and a second day cannot race this upload. */
    if (!state.finishing) {
      state.lastClip = null;
    }
    state.recorder = null;
    hideDoorActions();
    show('s-home');
    setStatus(LIVE || state.account ? 'Ready for another day.' : '');
  });
  when('#retrybtn', function (btn) {
    btn.addEventListener('click', function () {
      if (!state.lastClip || state.finishing) return;
      state.finishing = true;
      uploadLastClip().catch(function () {
        /* renderDoorFailed already painted the door */
      });
    });
  });

  bindJobSearch();
  bindNewJob();

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
