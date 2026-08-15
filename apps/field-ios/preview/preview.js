(function () {
  'use strict';

  var STORAGE_KEY = 'atmosphere.iosPreview.v3';
  var OFFICES = {
    COASTAL: 'Coastal Drying LLC',
    COASTALDRY: 'Coastal Drying LLC',
    ATMOSPHERE: 'Atmosphere Restoration',
    DEMOOFFICE: 'Harbor Restoration',
  };
  var DEMO_JOBS = [
    {
      id: 'job-oak',
      name: '1847 Oak Ridge — kitchen water',
      address: '1847 Oak Ridge Dr, Charleston',
      number: '#1041',
      at: '7:30a',
      filmed: false,
      assigned: true,
      role: 'lead',
    },
    {
      id: 'job-harbor',
      name: '22 Harbor Walk — drywall',
      address: '22 Harbor Walk, Mount Pleasant',
      number: '#1044',
      at: '1:00p',
      filmed: false,
      assigned: true,
      role: 'crew',
    },
  ];
  var DEMO_HISTORY = [
    {
      id: 'job-pine',
      name: '91 Pine Street — category 2',
      address: '91 Pine St, North Charleston',
      number: '#1038',
      at: 'Aug 12, 2026',
      filmedOn: '2026-08-12',
      filmed: true,
      status: 'completed',
      assigned: true,
      role: 'lead',
    },
    {
      id: 'job-king',
      name: '440 King — contents packout',
      address: '440 King St, Charleston',
      number: '#1029',
      at: 'Aug 8, 2026',
      filmedOn: '2026-08-08',
      filmed: true,
      status: 'completed',
      assigned: true,
      role: 'crew',
    },
    {
      id: 'job-folly',
      name: '12 Folly Beach — storm loss',
      address: '12 Arctic Ave, Folly Beach',
      number: '#1014',
      at: 'Jul 22, 2026',
      filmedOn: '2026-07-22',
      filmed: true,
      status: 'in_progress',
      assigned: true,
      role: 'lead',
    },
  ];

  var SCREENS = ['signin', 'signup', 'office', 'today', 'jobs', 'add', 'recording', 'door'];
  var TABBED = { today: true, jobs: true, add: true };

  var state = {
    screen: 'signin',
    isLinked: false,
    needsOfficeLink: false,
    showOfficeLink: false,
    email: '',
    fullName: '',
    orgName: '',
    signupStep: 1,
    signupMode: 'join',
    officeMode: 'join',
    jobs: DEMO_JOBS.map(copyJob),
    history: DEMO_HISTORY.map(copyJob),
    jobSearch: '',
    activeJobId: DEMO_JOBS[0].id,
    elapsed: 0,
    holdTimer: null,
    tickTimer: null,
    siteLabel: 'Getting your bearings…',
    lastError: '',
  };

  function copyJob(job) {
    return {
      id: job.id,
      name: job.name,
      address: job.address,
      number: job.number || '',
      at: job.at,
      filmedOn: job.filmedOn || '',
      status: job.status || '',
      filmed: Boolean(job.filmed),
      assigned: job.assigned !== false,
      role: job.role || 'crew',
    };
  }

  function matchesJob(job, query) {
    var tokens = String(query || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return true;
    var hay = [job.name, job.address, job.number, job.status, job.at, job.filmedOn, job.role, roleLabel(job.role)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  }

  function roleLabel(role) {
    if (role === 'lead') return 'Lead';
    if (role === 'crew') return 'Crew';
    if (role === 'owner') return 'Yours';
    if (role === 'supervisor') return 'Supervisor';
    return 'Assigned';
  }

  function $(id) {
    return document.getElementById(id);
  }

  function load() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      Object.assign(state, saved, {
        holdTimer: null,
        tickTimer: null,
        elapsed: 0,
        screen: saved.screen === 'recording' ? 'today' : saved.screen || 'signin',
      });
      if (!state.history || !state.history.length) state.history = DEMO_HISTORY.map(copyJob);
      if (state.jobs && state.jobs.length) return;
    } catch (e) {
      /* ignore */
    }
    state.jobs = DEMO_JOBS.map(copyJob);
    state.history = DEMO_HISTORY.map(copyJob);
  }

  function persist() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          screen: state.screen,
          isLinked: state.isLinked,
          needsOfficeLink: state.needsOfficeLink,
          showOfficeLink: state.showOfficeLink,
          email: state.email,
          fullName: state.fullName,
          orgName: state.orgName,
          jobs: state.jobs,
          history: state.history,
          jobSearch: state.jobSearch,
          activeJobId: state.activeJobId,
        })
      );
    } catch (e) {
      /* private mode */
    }
  }

  function show(name) {
    state.screen = name;
    SCREENS.forEach(function (id) {
      var el = $('s-' + id);
      if (el) el.setAttribute('data-on', id === name ? '1' : '0');
    });
    document.querySelectorAll('.stage-nav button').forEach(function (btn) {
      btn.setAttribute('aria-current', btn.getAttribute('data-jump') === name ? 'true' : 'false');
    });
    var tabbar = $('tabbar');
    if (tabbar) tabbar.hidden = !TABBED[name];
    document.querySelectorAll('.tabbar button').forEach(function (btn) {
      btn.setAttribute('aria-current', btn.getAttribute('data-tab') === name ? 'true' : 'false');
    });
    persist();
    render();
  }

  function formatClock(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function todayLabel() {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  }

  function previewOffice(code) {
    var key = String(code || '').trim().toUpperCase();
    return OFFICES[key] || null;
  }

  function validJoin(code) {
    var trimmed = String(code || '').trim();
    return trimmed.length >= 6 && trimmed.length <= 12 && /^[A-Za-z0-9]+$/.test(trimmed);
  }

  function emailValid(value) {
    return value.indexOf('@') !== -1 && value.indexOf('.') !== -1;
  }

  function jobCard(job, onPick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'job' + (state.activeJobId === job.id ? ' on' : '');
    btn.innerHTML =
      '<div><b></b><span></span><span class="number"></span><span class="role"></span></div>' +
      '<div class="meta' + (job.filmed ? ' filmed' : '') + '"></div>' +
      (state.activeJobId === job.id ? '<div class="dot">●</div>' : '');
    btn.querySelector('b').textContent = job.name;
    btn.querySelector('span').textContent = job.address;
    var numberEl = btn.querySelector('.number');
    if (job.number) numberEl.textContent = job.number;
    else numberEl.remove();
    btn.querySelector('.role').textContent = roleLabel(job.role);
    btn.querySelector('.meta').textContent = job.filmed ? job.filmedOn || job.at || 'Filmed' : job.at;
    btn.addEventListener('click', function () {
      onPick(job);
    });
    return btn;
  }

  function renderJobs() {
    var root = $('job-list');
    if (!root) return;
    root.innerHTML = '';
    if (!state.jobs.length) {
      var empty = document.createElement('p');
      empty.className = 'lede';
      empty.textContent = 'Nothing assigned to you today. Add a job from this phone, or ask the office to put you on one. My jobs is the record of days you have already filmed.';
      root.appendChild(empty);
      return;
    }
    state.jobs.forEach(function (job) {
      root.appendChild(
        jobCard(job, function (picked) {
          state.activeJobId = picked.id;
          persist();
          renderJobs();
          renderAssigned();
        })
      );
    });
  }

  function renderAssigned() {
    var root = $('assigned-list');
    if (!root) return;
    root.innerHTML = '';
    var history = state.history || [];
    var filtered = history.filter(function (job) {
      return matchesJob(job, state.jobSearch);
    });
    var count = $('jobs-count');
    if (count) {
      count.hidden = !history.length || !filtered.length;
      count.textContent = filtered.length ? filtered.length + ' recorded' : '';
    }
    if ($('jobs-search') && $('jobs-search').value !== (state.jobSearch || '')) {
      $('jobs-search').value = state.jobSearch || '';
    }
    if (!history.length) {
      var empty = document.createElement('p');
      empty.className = 'lede';
      empty.textContent =
        'No filmed jobs yet. Finish a day on Today and it lands here as a record. Assigned work that has not been filmed stays on Today.';
      root.appendChild(empty);
      return;
    }
    if (!filtered.length) {
      var none = document.createElement('p');
      none.className = 'lede';
      none.textContent =
        'Nothing in the record matches “' +
        state.jobSearch +
        '”. Try the job name, street, city, job number, or a filmed date.';
      root.appendChild(none);
      return;
    }
    filtered.forEach(function (job) {
      root.appendChild(
        jobCard(job, function (picked) {
          state.activeJobId = picked.id;
          if (!state.jobs.some(function (row) { return row.id === picked.id; })) {
            state.jobs.unshift(copyJob(picked));
          }
          show('today');
        })
      );
    });
  }

  function render() {
    var org = state.orgName || 'Field Capture';
    if ($('today-org')) $('today-org').textContent = org;
    if ($('jobs-org')) $('jobs-org').textContent = org;
    if ($('add-org')) $('add-org').textContent = org;
    if ($('today-date')) $('today-date').textContent = todayLabel();
    if ($('today-lede')) {
      $('today-lede').textContent =
        'One button, once a day. Tap when you get to your first job and hold when you are done. The film is video + audio — filed to ' +
        org +
        ' so the office can open it in the evidence library.';
    }
    if ($('account-email')) $('account-email').textContent = state.email || '';
    if ($('account-office')) $('account-office').textContent = state.orgName ? 'Office: ' + state.orgName : '';
    if ($('today-err')) {
      $('today-err').hidden = !state.lastError;
      $('today-err').textContent = state.lastError;
    }

    var signupTitle = state.signupStep === 1 ? 'Create your account' : 'Link this phone to an office';
    var signupLede =
      state.signupStep === 1
        ? 'This is the same login you will use on the Atmosphere website. Password must be at least 8 characters.'
        : 'Join your crew with the office code, or start a new office from this phone.';
    if ($('signup-title')) $('signup-title').textContent = signupTitle;
    if ($('signup-lede')) $('signup-lede').textContent = signupLede;
    if ($('signup-step')) $('signup-step').textContent = 'Step ' + state.signupStep + ' of 2';
    if ($('signup-step1')) $('signup-step1').hidden = state.signupStep !== 1;
    if ($('signup-step2')) $('signup-step2').hidden = state.signupStep !== 2;
    if ($('signup-back')) $('signup-back').hidden = state.signupStep !== 2;
    if ($('signup-btn')) {
      $('signup-btn').textContent = state.signupStep === 1 ? 'Continue' : 'Create account & connect phone';
    }
    if ($('signup-join')) $('signup-join').hidden = state.signupMode !== 'join';
    if ($('signup-create')) $('signup-create').hidden = state.signupMode !== 'create';
    document.querySelectorAll('[data-signup-mode]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-signup-mode') === state.signupMode);
    });

    if ($('office-join')) $('office-join').hidden = state.officeMode !== 'join';
    if ($('office-create')) $('office-create').hidden = state.officeMode !== 'create';
    document.querySelectorAll('[data-office-mode]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-office-mode') === state.officeMode);
    });
    if ($('office-btn')) {
      $('office-btn').textContent =
        state.officeMode === 'join' ? 'Link to office account' : 'Start office & connect phone';
    }
    if ($('office-lede')) {
      if (state.email && state.needsOfficeLink) {
        $('office-lede').textContent =
          'You’re signed in as ' + state.email + '. Enter the office join code so this phone files day films to that company.';
      } else if (state.orgName && !state.needsOfficeLink) {
        $('office-lede').textContent =
          'This phone is linked to ' + state.orgName + '. Enter a different office code to move this login, or cancel.';
      } else {
        $('office-lede').textContent =
          'Enter the office join code from Atmosphere Settings so this login belongs to that company.';
      }
    }
    if ($('office-cancel')) {
      $('office-cancel').textContent = state.needsOfficeLink ? 'Use a different account' : 'Cancel';
    }

    if ($('rec-clock')) $('rec-clock').textContent = formatClock(state.elapsed);
    if ($('rec-clock-sm')) $('rec-clock-sm').textContent = formatClock(state.elapsed);
    if ($('site-label')) $('site-label').textContent = state.siteLabel;

    renderJobs();
    renderAssigned();
    syncButtons();
  }

  function syncButtons() {
    var email = ($('signin-email') || {}).value || '';
    var password = ($('signin-password') || {}).value || '';
    if ($('signin-btn')) $('signin-btn').disabled = !email || !password;

    var name = (($('signup-name') || {}).value || '').trim();
    var suEmail = (($('signup-email') || {}).value || '').trim();
    var suPass = ($('signup-password') || {}).value || '';
    var step1 = name.length >= 2 && emailValid(suEmail) && suPass.length >= 8;
    var step2 =
      state.signupMode === 'join'
        ? validJoin(($('signup-code') || {}).value)
        : (($('signup-org') || {}).value || '').trim().length >= 2;
    if ($('signup-btn')) $('signup-btn').disabled = state.signupStep === 1 ? !step1 : !step2;

    var officeOk =
      state.officeMode === 'join'
        ? validJoin(($('office-code') || {}).value)
        : (($('office-org') || {}).value || '').trim().length >= 2;
    if ($('office-btn')) $('office-btn').disabled = !officeOk;

    var addName = (($('add-name') || {}).value || '').trim();
    var addAddress = (($('add-address') || {}).value || '').trim();
    if ($('add-submit')) $('add-submit').disabled = addName.length < 2 || addAddress.length < 3;
  }

  function ensureDemoAccount(overrides) {
    state.isLinked = true;
    state.needsOfficeLink = false;
    state.showOfficeLink = false;
    state.email = overrides.email || state.email || 'andre@coastaldrying.com';
    state.fullName = overrides.fullName || state.fullName || 'Andre Boone';
    state.orgName = overrides.orgName || state.orgName || 'Coastal Drying LLC';
    if (!state.jobs.length) state.jobs = DEMO_JOBS.map(copyJob);
    if (!state.history || !state.history.length) state.history = DEMO_HISTORY.map(copyJob);
    if (!state.activeJobId) state.activeJobId = state.jobs[0].id;
  }

  function jump(name) {
    stopRecording(false);
    if (name === 'signup') {
      state.signupStep = 1;
      show('signup');
      return;
    }
    if (name === 'signin') {
      show('signin');
      return;
    }
    if (name === 'office') {
      ensureDemoAccount({});
      state.showOfficeLink = true;
      show('office');
      return;
    }
    if (name === 'jobs' || name === 'add') {
      ensureDemoAccount({});
      show(name);
      return;
    }
    ensureDemoAccount({});
    if (name === 'recording') {
      startDay();
      return;
    }
    if (name === 'door') {
      finishDay();
      return;
    }
    show('today');
  }

  function signIn() {
    var email = ($('signin-email').value || '').trim();
    var password = $('signin-password').value || '';
    if (!email || !password) return;
    $('signin-err').hidden = true;
    ensureDemoAccount({ email: email });
    show('today');
  }

  function createAccount() {
    if (state.signupStep === 1) {
      state.signupStep = 2;
      render();
      return;
    }
    var email = ($('signup-email').value || '').trim();
    var name = ($('signup-name').value || '').trim();
    var org =
      state.signupMode === 'create'
        ? ($('signup-org').value || '').trim()
        : previewOffice($('signup-code').value) || 'Harbor Restoration';
    ensureDemoAccount({ email: email, fullName: name, orgName: org });
    show('today');
  }

  function linkOffice() {
    var org =
      state.officeMode === 'create'
        ? ($('office-org').value || '').trim()
        : previewOffice($('office-code').value) || 'Harbor Restoration';
    state.orgName = org;
    state.needsOfficeLink = false;
    state.showOfficeLink = false;
    show('today');
  }

  function createJob() {
    var name = ($('add-name').value || '').trim();
    var address = ($('add-address').value || '').trim();
    var city = ($('add-city').value || '').trim();
    if (name.length < 2 || address.length < 3) return;
    var job = {
      id: 'job-' + Date.now(),
      name: name,
      address: city ? address + ', ' + city : address,
      number: '',
      at: 'Today',
      filmed: false,
      assigned: true,
      role: 'lead',
    };
    state.jobs.unshift(job);
    state.activeJobId = job.id;
    $('add-name').value = '';
    $('add-address').value = '';
    $('add-city').value = '';
    $('add-notes').value = '';
    show('today');
  }

  function startDay() {
    var job = state.jobs.find(function (j) { return j.id === state.activeJobId; }) || state.jobs[0];
    if (!job) {
      state.lastError = 'No job for today. Create or schedule a job in the Atmosphere dashboard first.';
      show('today');
      return;
    }
    state.lastError = '';
    state.elapsed = 0;
    state.siteLabel = job.address;
    show('recording');
    startCamera();
    clearInterval(state.tickTimer);
    state.tickTimer = setInterval(function () {
      state.elapsed += 1;
      if ($('rec-clock')) $('rec-clock').textContent = formatClock(state.elapsed);
      if ($('rec-clock-sm')) $('rec-clock-sm').textContent = formatClock(state.elapsed);
    }, 1000);
  }

  function startCamera() {
    var video = $('rec-video');
    var fallback = $('rec-fallback');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallback.hidden = false;
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: true })
      .then(function (stream) {
        video.srcObject = stream;
        fallback.hidden = true;
      })
      .catch(function () {
        fallback.hidden = false;
      });
  }

  function stopRecording(keepElapsed) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
    if (state.holdTimer) {
      clearTimeout(state.holdTimer);
      state.holdTimer = null;
    }
    var video = $('rec-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(function (track) { track.stop(); });
      video.srcObject = null;
    }
    if (!keepElapsed) state.elapsed = 0;
    var hold = $('hold-finish');
    if (hold) {
      hold.classList.remove('holding');
      hold.textContent = 'Hold to finish the day';
    }
  }

  function finishDay() {
    var duration = Math.max(state.elapsed, 12);
    stopRecording(true);
    var job = state.jobs.find(function (j) { return j.id === state.activeJobId; }) || state.jobs[0];
    if (job) {
      var stamp = new Date().toISOString().slice(0, 10);
      job.filmed = true;
      job.filmedOn = stamp;
      job.at = stamp;
      job.status = job.status || 'completed';
      state.history = (state.history || []).filter(function (row) { return row.id !== job.id; });
      state.history.unshift(copyJob(job));
    }
    var checks = [
      { label: 'Filmed on site', detail: state.siteLabel, ok: true },
      { label: 'Video + audio sealed', detail: 'mic track present', ok: true },
      { label: 'Filed to ' + (job ? job.name : 'today'), detail: 'office evidence library', ok: true },
      { label: 'Twin session', detail: 'twin_preview_1', ok: true },
    ];
    var rooms = [
      { name: 'Kitchen', detail: '168 SF' },
      { name: 'Hall', detail: '42 SF' },
      { name: 'Living', detail: '210 SF' },
    ];
    var list = $('door-checks');
    list.innerHTML = '';
    checks.forEach(function (row) {
      var el = document.createElement('div');
      el.className = 'lrow';
      el.innerHTML = '<span></span><span class="detail"></span><span class="mark"></span>';
      el.querySelector('span').textContent = row.label;
      el.querySelector('.detail').textContent = row.detail;
      el.querySelector('.mark').textContent = row.ok ? '✓' : '!';
      el.querySelector('.mark').className = 'mark ' + (row.ok ? 'ok' : 'bad');
      list.appendChild(el);
    });
    var roomRoot = $('twin-rooms');
    roomRoot.innerHTML = '';
    rooms.forEach(function (room) {
      var el = document.createElement('div');
      el.innerHTML = '<b></b><span></span>';
      el.querySelector('b').textContent = room.name;
      el.querySelector('span').textContent = room.detail;
      roomRoot.appendChild(el);
    });
    $('door-manifest').textContent = 'hasAudio=true · ' + duration + 's · media preview-day-film';
    show('door');
  }

  function bind() {
    ['signin-email', 'signin-password', 'signup-name', 'signup-email', 'signup-password', 'signup-code', 'signup-org', 'office-code', 'office-org', 'add-name', 'add-address', 'add-city', 'add-notes']
      .forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener('input', function () {
          if (id === 'office-code') {
            var name = previewOffice(el.value);
            $('office-preview').hidden = !name;
            $('office-preview').textContent = name ? 'This code belongs to ' + name + '.' : '';
            $('office-hint').hidden = Boolean(name);
          }
          syncButtons();
        });
      });

    $('signin-btn').addEventListener('click', signIn);
    $('goto-signup').addEventListener('click', function () {
      state.signupStep = 1;
      show('signup');
    });
    $('goto-signin').addEventListener('click', function () { show('signin'); });
    $('signup-btn').addEventListener('click', createAccount);
    $('signup-back').addEventListener('click', function () {
      state.signupStep = 1;
      render();
    });
    document.querySelectorAll('[data-signup-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.signupMode = btn.getAttribute('data-signup-mode');
        render();
      });
    });
    document.querySelectorAll('[data-office-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.officeMode = btn.getAttribute('data-office-mode');
        render();
      });
    });
    $('office-btn').addEventListener('click', linkOffice);
    $('office-cancel').addEventListener('click', function () {
      if (state.needsOfficeLink) {
        state.isLinked = false;
        state.needsOfficeLink = false;
        show('signin');
        return;
      }
      state.showOfficeLink = false;
      show('today');
    });
    function toggleAccount() {
      $('account-menu').hidden = !$('account-menu').hidden;
    }
    $('account-btn').addEventListener('click', toggleAccount);
    if ($('jobs-account-btn')) $('jobs-account-btn').addEventListener('click', toggleAccount);
    if ($('add-account-btn')) $('add-account-btn').addEventListener('click', toggleAccount);
    $('add-submit').addEventListener('click', createJob);
    if ($('jobs-search')) {
      $('jobs-search').addEventListener('input', function () {
        state.jobSearch = $('jobs-search').value || '';
        persist();
        renderAssigned();
      });
    }
    document.querySelectorAll('.tabbar button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        jump(btn.getAttribute('data-tab'));
      });
    });
    $('account-link').addEventListener('click', function () {
      $('account-menu').hidden = true;
      state.showOfficeLink = true;
      show('office');
    });
    $('account-disconnect').addEventListener('click', function () {
      $('account-menu').hidden = true;
      state.isLinked = false;
      state.needsOfficeLink = false;
      state.showOfficeLink = false;
      state.email = '';
      state.orgName = '';
      state.jobs = DEMO_JOBS.map(copyJob);
      state.history = DEMO_HISTORY.map(copyJob);
      state.jobSearch = '';
      show('signin');
    });
    $('start-day').addEventListener('click', startDay);
    $('back-today').addEventListener('click', function () {
      show('today');
    });

    var hold = $('hold-finish');
    function beginHold(event) {
      event.preventDefault();
      if (state.holdTimer) return;
      hold.classList.add('holding');
      hold.textContent = 'Keep holding…';
      state.holdTimer = setTimeout(function () {
        state.holdTimer = null;
        finishDay();
      }, 1500);
    }
    function endHold() {
      if (!state.holdTimer) return;
      clearTimeout(state.holdTimer);
      state.holdTimer = null;
      hold.classList.remove('holding');
      hold.textContent = 'Hold to finish the day';
    }
    hold.addEventListener('pointerdown', beginHold);
    hold.addEventListener('pointerup', endHold);
    hold.addEventListener('pointerleave', endHold);
    hold.addEventListener('pointercancel', endHold);

    document.querySelectorAll('.stage-nav button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        jump(btn.getAttribute('data-jump'));
      });
    });

    document.addEventListener('click', function (event) {
      var menu = $('account-menu');
      if (!menu || menu.hidden) return;
      if (
        menu.contains(event.target) ||
        event.target === $('account-btn') ||
        event.target === $('jobs-account-btn') ||
        event.target === $('add-account-btn')
      ) {
        return;
      }
      menu.hidden = true;
    });
  }

  function tickClock() {
    var now = new Date();
    var h = now.getHours();
    var m = String(now.getMinutes()).padStart(2, '0');
    var label = (h % 12 || 12) + ':' + m;
    if ($('status-time')) $('status-time').textContent = label;
  }

  load();
  bind();
  tickClock();
  setInterval(tickClock, 15000);

  var params = new URLSearchParams(location.search);
  var start = params.get('screen') || params.get('jump');
  if (start && SCREENS.indexOf(start) !== -1) {
    jump(start);
  } else if (state.isLinked && !state.needsOfficeLink && !state.showOfficeLink) {
    show('today');
  } else {
    show(state.screen || 'signin');
  }
})();
