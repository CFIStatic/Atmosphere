import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = readFileSync(join(here, 'capture-core.js'), 'utf8');
const appSrc = readFileSync(join(here, 'app.js'), 'utf8');
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const sandbox = { navigator: {}, console, setTimeout, clearTimeout, URL, URLSearchParams };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSrc, sandbox);
const Core = sandbox.FieldCaptureCore;

assert.equal(typeof Core.bindLivePreview, 'function', 'iPhone preview needs bindLivePreview');
assert.equal(Core.HOLD_TO_FINISH_MS, 5000, 'hold-to-finish must be 5 seconds');

const fakeVideo = {
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  play() { this.played = true; return Promise.resolve(); },
};
Core.bindLivePreview(fakeVideo, {});
assert.equal(fakeVideo.playsInline, true);
assert.equal(fakeVideo.muted, true);
assert.ok(fakeVideo.srcObject);
assert.ok(fakeVideo.played, 'preview must call play() so iOS does not stay black');
assert.ok('playsinline' in fakeVideo.attributes);
assert.ok('webkit-playsinline' in fakeVideo.attributes);
assert.equal(Core.resolveFinishHold({ recorder: { stop() {} } }), 'live');
assert.equal(Core.resolveFinishHold({ recorder: null, demoFinish: () => {} }), 'demo');
assert.equal(
  Core.resolveFinishHold({}),
  null,
  'without a recorder or demo callback, hold must not invent a finish',
);
assert.equal(
  Core.resolveFinishHold({ demoFinish: () => {} }),
  'demo',
  'demo finish is the fallback only when no recorder is running',
);

assert.match(appSrc, /Core\.resolveFinishHold/, 'account and token days both finish through the recorder');
assert.doesNotMatch(
  appSrc,
  /if \(LIVE\) finishLiveDay/,
  'signed-in crew used to hold forever because finish required ?token=',
);
assert.match(html, /transition: width 5s linear/, 'fill bar must last the full 5s hold');
assert.match(html, /Hold 5 seconds to finish/);
assert.match(html, /id="preview"/);
assert.match(html, /webkit-playsinline/);
assert.match(html, /#preview \{/);
assert.match(html, /body\[data-screen="s-rec"\]/);
assert.match(html, /<span class="reclabel">REC<\/span>/);
assert.match(html, /id="clock"/);
assert.doesNotMatch(html, /ON THE RECORD/);
assert.doesNotMatch(html, /class="grain"/);
assert.doesNotMatch(html, /Filming for/);
assert.doesNotMatch(html, /RECORDING THE DAY/);
assert.doesNotMatch(appSrc, /preview\.hidden = true/);
assert.match(appSrc, /data-screen/);
assert.match(appSrc, /Core\.bindLivePreview/);

assert.equal(typeof Core.resolveApiBase, 'function');
assert.equal(Core.isStandaloneFieldCaptureHost('field-capture-production.up.railway.app'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('field-capture.up.railway.app'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('app.atmosphereteam.com'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('www.app.atmosphereteam.com'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('atmosphere-web-production.up.railway.app'), false);
assert.equal(Core.isStandaloneFieldCaptureHost('platform.atmosphereteam.com'), false);
assert.equal(Core.isStandaloneFieldCaptureHost('fieldcapture-production.up.railway.app'), false);
assert.equal(Core.resolveApiBase('https://example.test/api/'), 'https://example.test/api');
assert.equal(Core.resolveApiBase(''), '');
assert.match(appSrc, /Core\.resolveApiBase/, 'standalone Field Capture must pick the office API');

const coreAssignIndex = appSrc.indexOf('var Core = window.FieldCaptureCore');
const resolveIndex = appSrc.indexOf('Core.resolveApiBase');
assert.ok(coreAssignIndex >= 0, 'app.js must assign FieldCaptureCore');
assert.ok(
  resolveIndex > coreAssignIndex,
  'resolveApiBase must run after Core is assigned so the connect screen can boot',
);
assert.match(html, /id="daybtn"/, 'Today must keep the Start the day record button');
assert.match(html, /Start the day/);
assert.match(html, /id="s-home"[^>]*data-on="0"/, 'home stays hidden until a phone is linked');
assert.match(html, /id="s-blocked"[^>]*data-on="1"/, 'connect form is the default first screen');
assert.match(html, /id="product-switch"/, 'home keeps the Field Capture / Platform bar');
assert.match(html, /id="app"[^>]*data-switch="off"/, 'login hides the Field Capture / Platform bar');
assert.match(html, /Field Capture<small>/);
assert.match(html, /Platform<small>/);
assert.match(
  appSrc,
  /id === 's-home' \|\| id === 's-new-job' \|\| id === 's-office' \|\| id === 's-platform'/,
  'the Field Capture / Platform bar returns after sign-in and on the office pane',
);
assert.equal(typeof Core.resolveOfficePlatformHref, 'function');
assert.match(appSrc, /resolveOfficePlatformHref\('\/verifier-library'\)/, 'Platform tab opens the office web console');
assert.match(appSrc, /openPlatformInFrame/, 'Platform stays inside the Field Capture web frame');
assert.match(html, /id="s-platform"/, 'Platform is an in-app screen, not a new page');
assert.match(html, /id="platform-frame"/);
assert.match(html, /max-width: 480px/, 'the web frame stays phone-width');
assert.match(
  html,
  /id="platform-link"[^>]*href="https:\/\/platform\.atmosphereteam\.com\/verifier-library\?embed=field&amp;v=no-overview-back-2"/,
  'standalone Field Capture must not use /field — that path is this same app',
);
assert.equal(
  Core.resolveOfficePlatformHref('/verifier-library'),
  '/verifier-library?embed=field&v=no-overview-back-2',
);
assert.equal(Core.withFieldEmbed('/verifier-library'), '/verifier-library?embed=field');
assert.equal(
  Core.localOfficeOrigin('?office=http://127.0.0.1:5174'),
  'http://127.0.0.1:5174',
);
assert.equal(Core.localOfficeOrigin('?office=https://evil.example'), '');
assert.equal(typeof Core.localOfficeOrigin, 'function');
assert.equal(Core.isStandaloneFieldCaptureHost('field-capture-production.up.railway.app'), true);
assert.match(coreSrc, /isOfficeFieldCapturePath/, 'local Field Capture must iframe the office, not /verifier-library on itself');
assert.match(html, /Welcome back/);
assert.match(html, /id="blocked-msg"/);
assert.doesNotMatch(html, /Sign in once/);
assert.doesNotMatch(html, /Field Capture and the in-app Platform use the same account/);
assert.doesNotMatch(appSrc, /Sign in once/);
assert.doesNotMatch(appSrc, /Field Capture and the in-app Platform use the same account/);
assert.match(appSrc, /function showBlockedMsg/);
assert.match(appSrc, /This link is invalid or expired/);
assert.match(html, /id="login-email"/);
assert.match(html, /id="login-password"/);
assert.match(html, /id="forgot-link"/);
assert.match(html, /id="signup-link"/);
assert.match(html, /<button class="daybtn" type="submit" id="login-btn">/);
assert.match(html, />Sign in</);
assert.doesNotMatch(html, /Office invite code/);
assert.doesNotMatch(html, /id="login-name"/);
assert.doesNotMatch(html, /id="login-code"/);
assert.match(html, /js\/capture-core\.js\?v=offline-calm/);
assert.match(html, /js\/app\.js\?v=offline-calm/);
assert.match(html, /Back to Home Screen/, 'door must offer a clear path home after recording');
assert.match(html, /id="donebtn"/);
assert.match(html, /id="retrybtn"/, 'failed uploads keep Retry on the door');
assert.match(html, /\.donebtn\.on, \.retrybtn\.on \{ display: block; \}/);
assert.match(html, /class="door-actions"/, 'home actions stay pinned under the door scroll');
assert.match(html, /\.door-actions \{[\s\S]*?flex: 0 0 auto/, 'home button stays visible while checks scroll');
assert.match(html, /\.donebtn\.on/);
assert.match(appSrc, /function uploadLastClip/);
assert.match(appSrc, /showHomeAction/);
assert.match(appSrc, /scheduleFailRetry/);
assert.match(
  appSrc,
  /function openDoorUploading\([\s\S]*?showHomeAction\(\)/,
  'Back to Home Screen must appear as soon as recording ends, including while uploading',
);
assert.match(appSrc, /state\.lastClip/, 'keep the day film on device until upload succeeds');
{
  const doneFrom = appSrc.indexOf("$('#donebtn')");
  const doneTo = appSrc.indexOf("when('#retrybtn'");
  assert.ok(doneFrom >= 0 && doneTo > doneFrom, 'Home lives on the door done button');
  const doneHandler = appSrc.slice(doneFrom, doneTo);
  assert.doesNotMatch(
    doneHandler,
    /state\.lastClip = null/,
    'Home must not drop lastClip while upload is in flight or paused',
  );
  assert.match(
    doneHandler,
    /Still on this phone/,
    'Home during an unfiled clip keeps a calm on-phone status',
  );
}
assert.match(
  appSrc,
  /if \(state\.lastClip === clip\) state\.lastClip = null;/,
  'a settled PUT must not wipe a newer recording',
);
assert.match(
  appSrc,
  /if \(state\.finishing\) \{\s*setStatus\('The last day is still uploading\.'/,
  'a second day must not start while the previous PUT is still running',
);
assert.match(
  appSrc,
  /if \(state\.lastClip\) \{\s*setStatus\('The last day is still on this phone\.'/,
  'Home must not start a second day while the last clip is still local',
);
assert.match(coreSrc, /putBytesWithRetry/, 'video + audio PUT must retry on truck signal');
assert.match(coreSrc, /putFileResumable/, 'large day films resume from the first missing part');
assert.match(coreSrc, /proof\/upload-complete/);
assert.match(coreSrc, /byteSize: file\.size/);
assert.equal(Core.PROOF_UPLOAD_ATTEMPTS, 8);
assert.equal(Core.nextUploadBackoffMs(0), 400);
assert.equal(Core.nextUploadBackoffMs(8), 5000);
assert.match(coreSrc, /hadAudio/, 'stop must confirm the mic track before filing');
assert.match(coreSrc, /Microphone is required/);
assert.match(coreSrc, /onStep\('Uploading…'\)/);
assert.equal(typeof Core.knownDurationSeconds, 'function');
assert.equal(typeof Core.formatClipLength, 'function');
assert.equal(Core.knownDurationSeconds(0, null, 3000), 3000, '0:00 header must not beat a 50-minute clock');
assert.equal(Core.knownDurationSeconds(10), 10);
assert.equal(Core.formatClipLength(10), '10 seconds');
assert.equal(Core.formatClipLength(50 * 60), '50 minutes');
assert.equal(Core.formatClipLength(0), '—');
assert.match(coreSrc, /currentTime = Number.MAX_SAFE_INTEGER/, 'WebM duration must be discovered by seeking to the end');
assert.match(appSrc, /durationSeconds: clip.durationSeconds/, 'upload must keep the recorder clock');
assert.match(appSrc, /Core\.formatClipLength/, 'the door must say 10 seconds / 50 minutes, not 3000s');
assert.doesNotMatch(html, /Search Google for the site address/);
assert.doesNotMatch(html, /new-job-address/);
assert.doesNotMatch(html, /\.addr-list/);
assert.doesNotMatch(appSrc, /function bindAddressLookup/);
assert.doesNotMatch(appSrc, /function resolveNewJobSite/);
assert.doesNotMatch(appSrc, /Core\.placesAutocomplete/);
assert.doesNotMatch(appSrc, /Core\.placesDetails/);
assert.doesNotMatch(appSrc, /Core\.placesResolve/);
assert.doesNotMatch(appSrc, /placeId: site\.placeId/);
assert.match(coreSrc, /\/api\/field-app\/places\/autocomplete/);
assert.match(coreSrc, /\/api\/field-app\/places\/resolve/);
assert.equal(typeof Core.placesAutocomplete, 'function');
assert.equal(typeof Core.placesDetails, 'function');
assert.equal(typeof Core.placesResolve, 'function');
assert.equal(typeof Core.placesStatus, 'function');
assert.match(appSrc, /atmosphere: 'theme'/, 'Field Capture switchbar follows the office dark/light toggle');
assert.match(appSrc, /function applyOfficeTheme/);
assert.match(html, /html\[data-theme="dark"\] \{ color-scheme: dark; \}/);
assert.match(appSrc, /request-field-session/, 'Platform iframe can ask Field Capture for the shared session');
assert.match(appSrc, /field-session-missing/, 'unsigned Field Capture must not fake an office session');
assert.match(appSrc, /warmPlatformFrame/, 'signing in on Field Capture warms the in-app Platform');
assert.match(appSrc, /notifyOfficeLibraryChanged/, 'a new Field Capture job must refresh the office list');
assert.match(appSrc, /atmosphere: 'library-changed'/);
assert.match(appSrc, /scheduleFailRetry/, 'hard-fail still auto-retries so Retry is not the only path');
assert.match(html, /id="door-sub"/);
assert.doesNotMatch(html, /Your part is done/);
assert.doesNotMatch(html, /Your day, as the office will read it/);
assert.doesNotMatch(appSrc, /Fix signal and tap Retry upload/);
assert.doesNotMatch(appSrc, /Upload paused/);
assert.doesNotMatch(appSrc, /showRetryAction\(\)/, 'failed filing stays on the progress line — no Retry drama');
assert.match(appSrc, /Waiting for signal/);
assert.match(appSrc, /function flushFieldWork/);
assert.match(appSrc, /addEventListener\('online'/);
assert.match(appSrc, /Core\.loginWithPassword/, 'Field Capture signs in with the Platform password');
assert.doesNotMatch(appSrc, /Core\.joinCrew/, 'name + invite code is no longer the Field Capture login');
assert.match(appSrc, /resolveOfficeHref\('\/forgot-password'\)/);
assert.match(appSrc, /resolveOfficeHref\('\/signup'\)/);
assert.doesNotMatch(html, /This week/);
assert.doesNotMatch(html, /week-wrap/);
assert.doesNotMatch(appSrc, /week-wrap/);
assert.match(html, /\.daybtn:disabled/);
assert.match(html, /class="home-scroll"/, 'Today must scroll independently of Start the day');
assert.match(html, /class="joblist"/, 'jobs must live in a scrollable list');
assert.match(html, /id="job-hint"/);
assert.match(html, /id="job-search"/);
assert.match(html, /placeholder="Search jobs"/);
assert.match(html, /class="job-search-row"/, 'search and + sit in one row, not inside the field');
assert.match(html, /id="job-add"/);
assert.match(html, /aria-label="Start recording a new job"/);
assert.match(html, /id="s-new-job"/);
assert.match(html, /id="new-job-form"/);
assert.match(html, /id="new-job-name"[^>]*required/);
assert.doesNotMatch(html, /id="new-job-address"/);
assert.match(html, /id="new-job-note"/);
assert.match(html, />Start recording</);
assert.match(html, /Name it, then start recording/);
assert.match(html, /<\/label>\s*<button type="button" class="job-add" id="job-add"/);
assert.doesNotMatch(html, /footage carries where it was/);
assert.doesNotMatch(html, /hold it for 5 seconds when you are done/);
assert.doesNotMatch(html, /proof instead of silent video/);
assert.doesNotMatch(html, /id="btnhint"/, 'Start the day no longer carries the proof explainer');
assert.match(appSrc, /bindJobSearch/);
assert.match(appSrc, /bindNewJob/);
assert.match(appSrc, /Core\.filterJobs/);
assert.match(appSrc, /Core\.createTodayJob/);
{
  const submitFrom = appSrc.indexOf("form.addEventListener('submit'");
  const submitTo = appSrc.indexOf('function renderExpect');
  assert.ok(submitFrom >= 0 && submitTo > submitFrom, 'new-job submit must exist');
  const submitSrc = appSrc.slice(submitFrom, submitTo);
  assert.ok(
    submitSrc.indexOf('navigator.mediaDevices.getUserMedia') < submitSrc.indexOf('Core.createTodayJob({'),
    'Start recording must call getUserMedia before the job POST so iPhone Safari still has a user gesture',
  );
  assert.ok(
    submitSrc.indexOf('finishLocal(localJob, stream)') < submitSrc.indexOf('Core.createTodayJob({'),
    'recording starts on the local draft before the office POST',
  );
}
assert.match(
  appSrc,
  /function finishLocal\(job, stream\) \{\s*selectCreatedJob\(job\);\s*startRecordingForNewJob\(stream\);/,
  'after the job exists, leave Start recording disabled and start the camera',
);
assert.match(coreSrc, /opts\.stream/, 'recordDayFilm must reuse the stream from the original tap');
assert.match(coreSrc, /function createTodayJob/);
assert.match(coreSrc, /\/api\/field-app\/jobs/);
assert.equal(typeof Core.createTodayJob, 'function');
assert.equal(typeof Core.draftFieldJob, 'function');
assert.equal(typeof Core.isLocalJobId, 'function');
assert.equal(typeof Core.mergeTodayJobs, 'function');
assert.equal(typeof Core.isTransientNetworkError, 'function');
assert.equal(Core.isLocalJobId('local-123'), true);
assert.equal(Core.isLocalJobId('new-1'), true);
assert.equal(Core.isLocalJobId('job-real'), false);

const draft = Core.draftFieldJob({ title: 'Camden Court', situation: 'Roof' });
assert.equal(Core.isLocalJobId(draft.id), true);
assert.equal(draft.name, 'Camden Court');
assert.equal(draft.title, 'Camden Court');
assert.equal(draft.situation, 'Roof');
assert.equal(draft.pending, true);
assert.ok(draft.createdAt);

const memory = {
  data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
  setItem(key, value) { this.data[key] = String(value); },
  removeItem(key) { delete this.data[key]; },
};
Core.upsertPendingJob(draft, memory);
assert.equal(Core.readPendingJobs(memory).length, 1);
assert.equal(Core.readPendingJobs(memory)[0].id, draft.id);
const officeJob = { id: 'job-1038', name: 'Meridian Ave' };
assert.deepEqual(
  Core.mergeTodayJobs([officeJob], [draft]).map((j) => j.id),
  [draft.id, 'job-1038'],
);
Core.markPendingJobSynced(draft.id, officeJob, memory);
assert.equal(Core.readPendingJobs(memory).length, 0);
assert.deepEqual(Core.mergeTodayJobs([officeJob], []).map((j) => j.id), ['job-1038']);
assert.equal(Core.isTransientNetworkError({ message: 'Failed to fetch' }), true);
assert.equal(Core.isTransientNetworkError({ status: 503, message: 'Unavailable' }), true);
assert.equal(Core.isTransientNetworkError({ status: 401, message: 'Unauthorized' }), false);
assert.match(appSrc, /Core\.draftFieldJob/);
assert.match(appSrc, /Core\.upsertPendingJob/);
assert.match(appSrc, /function syncPendingJobs/);
assert.match(appSrc, /function resolveActiveJobId/);
assert.match(
  appSrc,
  /isTransientNetworkError\(err\) && cachedMe/,
  'signed-in crew keep Today when the office API is unreachable',
);
assert.deepEqual(
  Core.filterJobs(
    [
      { id: 'j1', name: 'Camden Court', addr: 'Austin' },
      { id: 'j2', name: 'Meridian Ave', addr: 'Houston' },
    ],
    'camden',
  ).map((j) => j.id),
  ['j1'],
);
assert.equal(Core.filterJobs([{ id: 'j1', name: 'Camden Court' }], 'zzz').length, 0);
assert.equal(Core.filterJobs([{ id: 'j1', name: 'Camden Court' }], '').length, 1);
assert.doesNotMatch(html, /sharelink/, 'job cards must not show raw share URLs');
assert.doesNotMatch(appSrc, /sharelink/);
assert.doesNotMatch(appSrc, /hrefAttr/);
assert.match(appSrc, /role="option"/, 'assigned jobs are tappable options, not links');
assert.match(appSrc, /function jobMetaLine/, 'job cards show metadata, not a URL');

console.log('hold-to-finish OK');
