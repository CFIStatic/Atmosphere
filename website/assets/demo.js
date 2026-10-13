/* atmosphereteam.com/demo — pick a 30-minute slot, book it. Times are shown
   in the visitor's own zone; the API stores UTC and holds the slot. */
(function () {
  'use strict';
  var grid = document.getElementById('demo-grid');
  if (!grid) return;
  var daysEl = document.getElementById('demo-days');
  var timesEl = document.getElementById('demo-times');
  var zoneEl = document.getElementById('demo-zone');
  var form = document.getElementById('demo-form');
  var chosenEl = document.getElementById('demo-chosen');
  var submit = document.getElementById('demo-submit');
  var status = document.getElementById('demo-status');
  var done = document.getElementById('demo-done');
  var api = (form.dataset.api || '');

  var tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  var zoneName = (function () {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date()).filter(function (x) { return x.type === 'timeZoneName'; })[0];
      return p ? p.value : tz;
    } catch (e) { return tz; }
  })();
  zoneEl.textContent = 'Times in your time zone: ' + tz.replace(/_/g, ' ') + ' (' + zoneName + ')';

  var dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  var dayWk = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  var dayNum = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
  var timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  var longFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  var byDay = {};
  var order = [];
  var activeDay = null;
  var chosen = null;

  function paintDays() {
    daysEl.innerHTML = '';
    order.forEach(function (key) {
      var first = new Date(byDay[key][0]);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'demo-day' + (key === activeDay ? ' on' : '');
      b.setAttribute('aria-pressed', key === activeDay ? 'true' : 'false');
      b.innerHTML = '<span class="wk"></span><span class="dt"></span>';
      b.firstChild.textContent = dayWk.format(first);
      b.lastChild.textContent = dayNum.format(first);
      b.addEventListener('click', function () { activeDay = key; paintDays(); paintTimes(); });
      daysEl.appendChild(b);
    });
  }

  function paintTimes() {
    timesEl.innerHTML = '';
    if (!activeDay) {
      timesEl.innerHTML = '<p class="demo-empty">No open times in the next three weeks. <a href="contact.html">Send us a note</a> instead.</p>';
      return;
    }
    byDay[activeDay].forEach(function (iso) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'demo-time' + (iso === chosen ? ' on' : '');
      b.setAttribute('aria-pressed', iso === chosen ? 'true' : 'false');
      b.textContent = timeFmt.format(new Date(iso));
      b.addEventListener('click', function () { choose(iso); });
      timesEl.appendChild(b);
    });
  }

  function choose(iso) {
    chosen = iso;
    chosenEl.textContent = longFmt.format(new Date(iso)) + ' · 30 min';
    chosenEl.classList.add('set');
    status.className = 'form-status';
    status.textContent = '';
    paintTimes();
    var name = document.getElementById('dm-name');
    if (name && !name.value && window.matchMedia('(min-width: 861px)').matches) name.focus();
  }

  function load(keepChoice) {
    return fetch(api + '/api/demo/slots', { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('slots'); return res.json(); })
      .then(function (body) {
        byDay = {}; order = [];
        (body.slots || []).forEach(function (iso) {
          var key = dayKey.format(new Date(iso));
          if (!byDay[key]) { byDay[key] = []; order.push(key); }
          byDay[key].push(iso);
        });
        if (!keepChoice || (chosen && order.every(function (k) { return byDay[k].indexOf(chosen) < 0; }))) {
          chosen = keepChoice ? null : chosen;
        }
        if (!activeDay || !byDay[activeDay]) activeDay = order[0] || null;
        if (!chosen) { chosenEl.textContent = 'No time picked yet.'; chosenEl.classList.remove('set'); }
        paintDays();
        paintTimes();
      })
      .catch(function () {
        timesEl.innerHTML = '<p class="demo-empty">Could not load open times. Refresh to try again, or <a href="contact.html">send us a note</a>.</p>';
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!chosen) {
      status.className = 'form-status err';
      status.textContent = 'Pick a time first.';
      return;
    }
    if (!form.reportValidity()) return;
    submit.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Booking…';
    var payload = {
      slotStart: chosen,
      name: document.getElementById('dm-name').value,
      email: document.getElementById('dm-email').value,
      company: document.getElementById('dm-company').value,
      phone: document.getElementById('dm-phone').value,
      notes: document.getElementById('dm-notes').value,
      website: document.getElementById('dm-website').value,
      timeZone: tz
    };
    fetch(api + '/api/demo/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.ok) {
          document.getElementById('demo-done-when').textContent = longFmt.format(new Date(chosen)) + ' · 30 minutes';
          document.getElementById('demo-done-email').textContent = payload.email;
          if (r.body && r.body.emailed === false) {
            document.getElementById('demo-done-note').textContent =
              'Your time is held, but the invite email did not go out. Jack will email ' + payload.email + ' the join link shortly.';
          }
          grid.classList.add('booked');
          document.getElementById('demo-picker').hidden = true;
          form.hidden = true;
          done.hidden = false;
          done.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        status.className = 'form-status err';
        status.textContent = (r.body && r.body.error) || 'Something went wrong on our end. Try again in a minute.';
        if (r.status === 409) { chosen = null; load(true); }
      })
      .catch(function () {
        status.className = 'form-status err';
        status.textContent = 'Could not reach the server. Check your connection and try again.';
      })
      .then(function () { submit.disabled = false; });
  });

  load(false);
})();
