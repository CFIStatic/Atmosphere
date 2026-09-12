import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = readFileSync(join(here, 'capture-core.js'), 'utf8');
const appSrc = readFileSync(join(here, 'app.js'), 'utf8');
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const sandbox = { navigator: {}, console, setTimeout, clearTimeout, URL, URLSearchParams, Blob };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSrc, sandbox);
const Core = sandbox.FieldCaptureCore;

assert.equal(typeof Core.bindLivePreview, 'function', 'iPhone preview needs bindLivePreview');
assert.equal(Core.HOLD_TO_FINISH_MS, 5000, 'hold-to-finish must be 5 seconds');

assert.equal(Core.DAY_FILM_MAX_WIDTH, 1280, 'day film long edge capped at 1280');
assert.equal(Core.DAY_FILM_MAX_HEIGHT, 720, 'day film short edge capped at 720');
assert.equal(Core.DAY_FILM_VIDEO_BITS_PER_SECOND, 2000000, 'day film ~2 Mbps');
assert.equal(typeof Core.dayFilmGetUserMediaConstraints, 'function');
assert.equal(typeof Core.dayFilmRecorderOptions, 'function');
{
  const gUM = Core.dayFilmGetUserMediaConstraints();
  assert.equal(gUM.audio, true, 'day film keeps microphone');
  assert.equal(gUM.video.width.ideal, 1280);
  assert.equal(gUM.video.width.max, 1280);
  assert.equal(gUM.video.height.ideal, 720);
  assert.equal(gUM.video.height.max, 720);
  assert.equal(gUM.video.frameRate.ideal, 30);
  assert.equal(gUM.video.frameRate.max, 30);
  const rec = Core.dayFilmRecorderOptions('video/webm');
  assert.equal(rec.videoBitsPerSecond, 2000000);
  assert.equal(rec.mimeType, 'video/webm');
}
assert.match(coreSrc, /videoBitsPerSecond/, 'MediaRecorder must request a video bitrate');
assert.match(coreSrc, /dayFilmGetUserMediaConstraints\(\)/, 'recordDayFilm uses shared constraints');
assert.match(appSrc, /dayFilmGetUserMediaConstraints/, 'app.js acquires camera with day-film caps');

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
  /id === 's-home' \|\| id === 's-new-job' \|\| id === 's-platform'/,
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
assert.match(html, /id="signup-form"/);
assert.match(html, /id="signup-email"/);
assert.match(html, /id="signup-password"/);
assert.match(html, /id="signup-tos"/);
assert.doesNotMatch(html, /Join code/);
assert.doesNotMatch(html, /id="s-office"/);
assert.doesNotMatch(appSrc, /intent=join/);
assert.match(appSrc, /signupWithPassword/);
assert.match(coreSrc, /signupWithPassword/);
assert.match(appSrc, /Sign in or create an account to record/);
assert.match(html, /<button class="daybtn" type="submit" id="login-btn">/);
assert.match(html, />Sign in</);
assert.doesNotMatch(html, /Office invite code/);
assert.doesNotMatch(html, /id="login-name"/);
assert.doesNotMatch(html, /id="login-code"/);
assert.match(html, /js\/capture-core\.js\?v=no-office-link-1/);
assert.match(html, /js\/app\.js\?v=no-office-link-1/);
assert.match(html, /Back to Home Screen/, 'door must offer a clear path home after recording');
assert.match(html, /id="donebtn"/);
assert.match(html, /id="retrybtn"/, 'stuck multipart failures get an explicit Retry upload on the door');
assert.match(html, /\.donebtn\.on, \.nextbtn\.on, \.retrybtn\.on \{ display: block; \}/);
assert.match(html, /id="nextbtn"/, 'stop one video, start the next: the camera opens straight from the door');
assert.match(html, /Record another/);
assert.match(html, /class="door-actions"/, 'home actions stay pinned under the door scroll');
assert.match(html, /\.door-actions \{[\s\S]*?flex: 0 0 auto/, 'home button stays visible while checks scroll');
assert.match(html, /\.donebtn\.on/);
assert.match(appSrc, /function uploadFilm/);
assert.match(appSrc, /showHomeAction/);
assert.match(
  appSrc,
  /function renderDoorSaved\([\s\S]*?showHomeAction\(\)/,
  'Back to Home Screen must appear as soon as recording ends, while the film is still filing',
);
assert.match(appSrc, /filmQueue\.enqueue\(entry, settle/, 'the day film goes to the filing queue, which holds it until the office has it');
assert.match(appSrc, /Core\.openDayFilmStore/, 'films wait in IndexedDB so a killed tab does not lose the day');
assert.match(appSrc, /Core\.createDayFilmQueue/);
{
  const doneFrom = appSrc.indexOf("$('#donebtn')");
  const doneTo = appSrc.indexOf('bindJobSearch();');
  assert.ok(doneFrom >= 0 && doneTo > doneFrom, 'Home lives on the door done button');
  const doneHandler = appSrc.slice(doneFrom, doneTo);
  assert.match(doneHandler, /show\('s-home'\)/);
  assert.doesNotMatch(
    doneHandler,
    /filmQueue\.(remove|drop|clear)/,
    'Home must never drop a film that is still filing',
  );
  assert.doesNotMatch(doneHandler, /Still on this phone/, 'the Today strip, not the status line, shows what is still filing');
}
assert.doesNotMatch(
  appSrc,
  /The last day is still uploading/,
  'a second day starts while the previous film is still filing in the background',
);
assert.doesNotMatch(
  appSrc,
  /The last day is still on this phone/,
  'Home starts a second day even while the last film is still local',
);
assert.match(
  appSrc,
  /var boundJobId = \(rec && rec\.jobId\) \|\| state\.activeJobId;[\s\S]*?jobId: boundJobId/,
  'stop must stamp the job the day was filmed on so a later Home tap cannot reroute the file',
);
assert.match(
  appSrc,
  /resolveJob: resolveFilmJob/,
  'filing must resolve the film job, not whatever is selected on Today',
);
assert.match(
  appSrc,
  /filmQueue\.remapJob\(localId, listed\.id\)/,
  'a local-to-office remap must move every waiting film onto that office job',
);
{
  const openFrom = appSrc.indexOf('function openNewJobForm');
  const openTo = appSrc.indexOf('function selectCreatedJob');
  assert.ok(openFrom >= 0 && openTo > openFrom, 'openNewJobForm must exist');
  const openSrc = appSrc.slice(openFrom, openTo);
  assert.doesNotMatch(
    openSrc,
    /lastClip|finishing|uploading/,
    '+ opens a new job even while an earlier film is still filing',
  );
}
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
assert.match(coreSrc, /nextFilingBackoffMs/, 'a failed filing retries on its own with backoff');
assert.match(coreSrc, /filingHomeVisible/, 'home only shows filing when the crew must act');
assert.match(coreSrc, /isStuckStatus: isStuckStatus/, 'door can detect stuck multipart answers');
assert.match(appSrc, /showHomeAction\(\{ retry: true \}\)/, 'stuck upload turns Retry on at the door');
assert.match(appSrc, /filmQueue\.retryNow/, 'Retry upload kicks the filing queue');
assert.match(appSrc, /filingHomeVisible\(summary\)/, 'the home strip gates on filingHomeVisible');
assert.match(html, /id="door-sub"/);
assert.match(html, /id="doneline-title"/, 'the door done-line changes from Done to Uploaded as the film files');
assert.match(html, /id="filing"/, 'Today keeps a warn-only strip for filing that needs the crew');
assert.match(html, /id="filing-title"/);
assert.match(html, /id="filing-detail"/);
assert.match(html, /id="filing-rows"/);
assert.match(html, /id="filing-bar"/);
assert.match(appSrc, /function renderFilingStrip/);
assert.match(appSrc, /function paintFiling/);
assert.match(appSrc, /Core\.summarizeDayFilms/);
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
assert.doesNotMatch(coreSrc, /function joinCrew/);
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
    submitSrc.indexOf('navigator.mediaDevices.getUserMedia') < submitSrc.indexOf('syncPendingJobs()'),
    'Start recording must call getUserMedia before the job POST so iPhone Safari still has a user gesture',
  );
  assert.ok(
    submitSrc.indexOf('finishLocal(localJob, stream)') < submitSrc.indexOf('syncPendingJobs()'),
    'recording starts on the local draft before the office POST',
  );
  assert.doesNotMatch(
    submitSrc,
    /Core\.createTodayJob\(\{/,
    'new-job submit must POST through pendingSync, not a parallel createTodayJob',
  );
  assert.doesNotMatch(
    submitSrc,
    /state\.finishing|state\.lastClip/,
    'Start recording drafts the next job even while the last film is still filing',
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
Core.upsertPendingJob(draft, memory);
Core.writeCachedJobs(
  [{ id: 'job-1038', name: 'Meridian Ave', sharePath: '/share/secret-token' }],
  memory,
);
assert.equal(Core.readCachedJobs(memory)[0].sharePath, undefined);
assert.equal(typeof Core.clearFieldLocalCache, 'function');
assert.equal(typeof Core.adoptFieldCache, 'function');
assert.equal(typeof Core.fieldCacheMatchesSession, 'function');
Core.adoptFieldCache('user-a', 'aaaaaaaaaaaaTOKENA', memory);
assert.equal(Core.readPendingJobs(memory).length, 1);
Core.adoptFieldCache('user-b', 'bbbbbbbbbbbbTOKENB', memory);
assert.equal(Core.readPendingJobs(memory).length, 0, 'a new account must not inherit leftover drafts');
assert.equal(Core.readCachedJobs(memory).length, 0);
assert.equal(Core.fieldCacheMatchesSession('bbbbbbbbbbbbTOKENB', memory), true);
assert.equal(Core.fieldCacheMatchesSession('aaaaaaaaaaaaTOKENA', memory), false);
Core.clearFieldLocalCache(memory);
assert.equal(Core.fieldCacheMatchesSession('bbbbbbbbbbbbTOKENB', memory), false);
assert.equal(Core.isTransientNetworkError({ message: 'Failed to fetch' }), true);
assert.equal(Core.isTransientNetworkError({ status: 503, message: 'Unavailable' }), true);
assert.equal(Core.isTransientNetworkError({ status: 401, message: 'Unauthorized' }), false);
assert.match(appSrc, /Core\.draftFieldJob/);
assert.match(appSrc, /Core\.upsertPendingJob/);
assert.match(appSrc, /function syncPendingJobs/);
assert.match(appSrc, /function resolveFilmJob/);
assert.match(
  appSrc,
  /isTransientNetworkError\(err\) && cachedMe/,
  'signed-in crew keep Today when the office API is unreachable',
);
assert.match(
  appSrc,
  /fieldCacheMatchesSession\(state\.accessToken\)/,
  'offline Today must not hydrate another account\'s cache',
);
assert.match(
  appSrc,
  /!accessToken[\s\S]*?endSessionWork\(\)/,
  'sign-out must drop pending jobs and cached profile, not only the session tokens',
);
{
  const from = appSrc.indexOf('function endSessionWork');
  const to = appSrc.indexOf('/* ---------- home hydration ---------- */');
  assert.ok(from >= 0 && to > from, 'endSessionWork must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /sessionGen \+= 1/, 'sign-out must invalidate in-flight sync');
  assert.match(src, /pendingSync = null/);
  assert.doesNotMatch(src, /filmQueue/, 'sign-out must not drop day films — they wait on this phone for the same crew');
}
{
  const from = appSrc.indexOf('function signOutFieldAccount');
  const to = appSrc.indexOf('var whoBtn = ');
  assert.ok(from >= 0 && to > from, 'signOutFieldAccount must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /filmQueue\.pending/, 'sign-out must check for films still filing');
  assert.match(src, /window\.confirm/, 'sign-out with films still filing asks first');
  assert.match(src, /still filing with the office/);
}
{
  const from = appSrc.indexOf('function captureSession');
  const to = appSrc.indexOf('function startRecordingForNewJob');
  assert.ok(from >= 0 && to > from, 'sync/upload must bind to the session that started them');
  const src = appSrc.slice(from, to);
  assert.match(src, /function sessionStillOpen/);
  assert.match(
    src,
    /withSession\(function \(accessToken\) \{\s*return Core\.createTodayJob/,
    'pending-job POST must refresh a one-hour token on 401 instead of failing the day',
  );
  assert.match(
    src,
    /if \(!sessionStillOpen\(bound\)\) return;[\s\S]*?Core\.createTodayJob/,
    'sign-out must stop the next pending-job POST',
  );
  assert.match(src, /function refreshAccess/);
  assert.match(src, /Core\.refreshSession\(API_BASE, refreshToken\)/);
  assert.match(src, /function sessionExpired/);
  assert.match(
    src,
    /screen === 's-rec' \|\| screen === 's-door'/,
    'an expired session must not yank a crew off a running recording or the door',
  );
  assert.match(
    src,
    /if \(!sessionStillOpen\(bound\)\) return;[\s\S]*?remapLocalJob/,
    'a late office create must not remap into the next account',
  );
  assert.match(
    src,
    /if \(!sessionStillOpen\(bound\)\) throw new Error\('Session ended\.'\);/,
    'resolveFilmJob must not resolve into the next account\'s session',
  );
  assert.match(
    src,
    /function flushFieldWork[\s\S]*?filmQueue\.kick/,
    'signal back / app in front must kick the filing queue',
  );
  assert.match(
    src,
    /return remapLocalJob\(localJob\.id, serverJob\)\.then\(function \(\) \{[\s\S]*?markPendingJobSynced/,
    'films follow the office job before the draft is forgotten',
  );
  assert.match(src, /function resolveFilmJob/);
  assert.match(
    src,
    /entry\.jobDraft && Core\.upsertPendingJob/,
    'a film on a cleared phone-only job recreates that job from its own draft',
  );
  assert.match(
    src,
    /if \(pendingSync === work\) pendingSync = null/,
    'a signed-out sync must not clear the next session\'s in-flight lock',
  );
}
{
  const from = appSrc.indexOf('function uploadFilm');
  const to = appSrc.indexOf('function filmFiled');
  assert.ok(from >= 0 && to > from, 'uploadFilm must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /return withSession\(attempt\)/, 'a 401 mid-queue refreshes the token and retries, not fails the day');
  assert.match(src, /knownSite: entry\.site \|\| null/, 'the film is placed where it was filmed, not where the truck is when signal returns');
  assert.match(src, /noPosition: !entry\.site && stale/);
  assert.match(src, /workDate: entry\.workDate/, 'a film sent after midnight files under the day it was filmed');
  assert.match(src, /recordedAt: entry\.recordedAt/);
  assert.match(src, /facts: entry\.facts \|\| null/, 'a retry must not hash the film again');
  assert.match(src, /onFacts: hooks\.onFacts/);
}
{
  const from = appSrc.indexOf('function finishLiveDay');
  const to = appSrc.indexOf('function setDoorSub');
  assert.ok(from >= 0 && to > from, 'finishLiveDay must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /var boundJobId = \(rec && rec\.jobId\) \|\| state\.activeJobId/, 'the film files on the job the recording started on');
  assert.match(src, /var boundOwner = state\.filmOwner \|\| state\.owner/, 'the film belongs to the crew that started it, even if the session dies mid-day');
  assert.match(src, /owner: boundOwner/);
  assert.match(src, /Core\.newDayFilmEntry\(/);
  assert.ok(
    src.indexOf('renderDoorSaved(entry)') < src.indexOf('filmQueue.enqueue(entry,'),
    'the door shows the day as done before the save or upload even starts',
  );
  assert.match(src, /markJobFilmed\(boundJobId\)/, 'Today shows the job filmed the moment the recorder stops');
  assert.match(src, /site: site/, 'GPS from the recording travels with the film');
  assert.doesNotMatch(src, /uploadDayFilm/, 'finish never uploads inline — the queue does, in the background');
}
{
  const from = appSrc.indexOf('function renderDoorSaved');
  const to = appSrc.indexOf('function paintDoorFilm');
  assert.ok(from >= 0 && to > from, 'renderDoorSaved must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /Saved on this phone/);
  assert.match(src, /Filing with the office/);
  assert.match(src, /setDoneline\(\s*'Done\.'/, 'the door reads as done immediately');
  assert.match(src, /You can start the next one now/);
  assert.match(src, /classList\.add\('on'\)/);
}
{
  const from = appSrc.indexOf('function renderDoorLive');
  const to = appSrc.indexOf('/* ---------- the filing queue');
  assert.ok(from >= 0 && to > from, 'renderDoorLive must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /setDoneline\('Uploaded\.', DONELINE_OK\)/, 'Uploaded is said only once the office really has it');
}
{
  const from = appSrc.indexOf('function startLiveDay');
  const to = appSrc.indexOf('function jobById');
  assert.ok(from >= 0 && to > from, 'startLiveDay must exist');
  const src = appSrc.slice(from, to);
  assert.doesNotMatch(src, /filmQueue|lastClip|finishing/, 'Start the day never waits on the filing queue');
  assert.match(src, /state\.filmOwner = state\.owner/);
  assert.match(src, /resetRecScreen\(\)/, 'the second day must not open with a full red fill bar from the first hold');
}
{
  const from = appSrc.indexOf('function resetRecScreen');
  const to = appSrc.indexOf('function jobById');
  assert.ok(from >= 0 && to > from, 'resetRecScreen must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /removeAttribute\('data-holding'\)/);
  assert.match(src, /Hold 5 seconds to finish/);
}
assert.match(appSrc, /addEventListener\('visibilitychange'/, 'Field Capture back in front kicks the queue');
assert.match(appSrc, /addEventListener\('pageshow'/);
assert.match(appSrc, /flushFieldWork\('tick'\)/, 'the safety tick keeps filing even if an event is missed');
assert.match(
  appSrc,
  /if \(!sessionStillOpen\(bound\)\) \{[\s\S]*?upsertPendingJob/,
  'sign-out during getUserMedia must not persist a draft into the next account',
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

assert.equal(typeof Core.buildFieldCaptureSupportUrl, 'function');
assert.equal(Core.CONTACT_PUBLIC_URL, 'https://atmosphereteam.com/contact.html');
assert.match(Core.FIELD_CAPTURE_SUPPORT_NOTE, /Field Capture/);
assert.doesNotMatch(Core.FIELD_CAPTURE_SUPPORT_NOTE, /Platform/);
{
  const url = Core.buildFieldCaptureSupportUrl({
    email: 'jack@jettx.ai',
    name: 'Jack Cyganiak',
    orgName: 'Jettx LLC',
    orgId: 'org-1',
    path: '/fieldcapture/',
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get('email'), 'jack@jettx.ai');
  assert.equal(params.get('company'), 'Jettx LLC');
  assert.match(params.get('note') || '', /Atmosphere Field Capture/);
  assert.match(params.get('note') || '', /Organization: Jettx LLC \(org-1\)/);
}
assert.equal(
  Core.fieldCaptureSupportPath({ pathname: '/fieldcapture/', search: '?token=secret', hash: '' }),
  '/fieldcapture/',
);
assert.match(html, /id="fc-menu-support"/);
assert.match(html, /contact\.html/);
assert.match(appSrc, /buildFieldCaptureSupportUrl/);
assert.match(appSrc, /refreshFieldSupportLink/);


/* ---------- the filing queue: the crew is done at hold-to-finish ----------
   The film is saved on the phone, the door reads Done, Today opens, and the
   next day can start. The queue files one film at a time in the background,
   waits for signal instead of failing, and survives a killed tab. */

assert.equal(typeof Core.openDayFilmStore, 'function');
assert.equal(typeof Core.createDayFilmQueue, 'function');
assert.equal(typeof Core.newDayFilmEntry, 'function');
assert.equal(typeof Core.summarizeDayFilms, 'function');
assert.equal(typeof Core.refreshSession, 'function');
assert.equal(Core.nextFilingBackoffMs(0), 5000);
assert.equal(Core.nextFilingBackoffMs(1), 10000);
assert.equal(Core.nextFilingBackoffMs(9), 60000, 'retries settle at once a minute and never give up');
assert.equal(Core.WAITING_FOR_SIGNAL, 'Waiting for signal…');
assert.equal(Core.POSITION_FRESH_MS, 10 * 60 * 1000);
assert.match(coreSrc, /workDate: workDate,/, 'upload files under the day it was filmed, not the day signal came back');
assert.doesNotMatch(coreSrc, /workDate: todayISO\(\)/);
assert.match(coreSrc, /function readFacts/, 'a retry reuses hash, stills and GPS instead of reading 400 MB again');
assert.match(coreSrc, /onFacts\(facts\)/, 'the first read is handed back even when the PUT fails');
assert.match(coreSrc, /lastModified: Number\.isFinite\(recordedMs\) \? recordedMs : Date\.now\(\)/, 'capturedAt is the recording time, not the upload time');
assert.match(coreSrc, /opts\.noPosition/, 'an old film is not placed where the truck is now');
assert.match(coreSrc, /\/api\/auth\/refresh/);
assert.match(coreSrc, /createObjectStore\(DAY_FILM_BYTES_STORE/, 'bytes live in their own store so a status change never rewrites the film');

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  const pending = new Map();
  let seq = 0;
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) {
        const id = ++seq;
        pending.set(id, { at: t + ms, fn });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    async advance(ms) {
      t += ms;
      for (const [id, entry] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at <= t) {
          pending.delete(id);
          entry.fn();
          await flush();
        }
      }
    },
  };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const fakeBlob = (size) => ({ size, type: 'video/webm' });
const okResult = { proof: { id: 'p' }, checks: [], problems: [], facts: { durationSeconds: 12 } };

{
  // Record, go Home, record again: both files, one at a time, oldest first.
  const store = Core.openDayFilmStore({ indexedDB: null });
  assert.equal(await store.ready, false, 'no IndexedDB → memory store, still works');
  const clock = fakeClock();
  const uploads = [];
  const filed = [];
  const changes = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry, hooks) {
      const d = deferred();
      uploads.push({ entry, hooks, d });
      return d.promise;
    },
    onChange(films, reason) {
      changes.push(reason);
    },
    onFiled(entry, result) {
      filed.push({ id: entry.id, result });
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const a = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-a', jobName: 'Meridian Ave', blob: fakeBlob(10),
    durationSeconds: 12, recordedAt: '2026-09-09T10:00:00.000Z',
  });
  const b = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-b', jobName: 'Cedar Ridge', blob: fakeBlob(20),
    durationSeconds: 30, recordedAt: '2026-09-09T10:05:00.000Z',
  });
  await queue.enqueue(a);
  await flush();
  assert.equal(uploads.length, 1, 'the first film starts filing at once');
  assert.equal(queue.get(a.id).status, 'uploading');
  await queue.enqueue(b);
  await flush();
  assert.equal(uploads.length, 1, 'the second film waits — one film at a time keeps each one fast');
  assert.equal(queue.get(b.id).status, 'queued');
  assert.equal((await store.list()).length, 2, 'both films are saved on the phone while the first sends');
  uploads[0].hooks.onProgress(0.5);
  assert.equal(queue.get(a.id).progress, 0.5);
  uploads[0].hooks.onStep('Uploading…');
  assert.equal(queue.get(a.id).step, 'Uploading…');
  uploads[0].d.resolve(okResult);
  await flush();
  assert.deepEqual(filed.map((f) => f.id), [a.id]);
  assert.equal(queue.get(a.id), null, 'a filed film leaves the queue');
  assert.equal(uploads.length, 2, 'the next film starts the moment the first is filed');
  assert.equal(uploads[1].entry.id, b.id);
  uploads[1].d.resolve(okResult);
  await flush();
  assert.equal(queue.films().length, 0);
  assert.equal((await store.list()).length, 0, 'nothing left on the phone once the office has both');
  assert.ok(changes.includes('enqueue') && changes.includes('start') && changes.includes('filed'));
}

{
  // Truck signal: a failed PUT waits with backoff, keeps what it already read,
  // and signal coming back skips the wait.
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry, hooks) {
      const d = deferred();
      uploads.push({ entry, hooks, d });
      return d.promise;
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const a = Core.newDayFilmEntry({ owner: 'user:1', jobId: 'job-a', blob: fakeBlob(10) });
  await queue.enqueue(a);
  await flush();
  const facts = { contentHash: 'abc', durationSeconds: 9, frames: [] };
  uploads[0].hooks.onFacts(facts);
  uploads[0].d.reject(Object.assign(new Error('network'), { status: 0 }));
  await flush();
  const after = queue.get(a.id);
  assert.equal(after.status, 'waiting');
  assert.equal(after.attempts, 1);
  assert.equal(after.lastError, 'network');
  assert.equal(after.nextAttemptAt, clock.now() + 5000, 'first retry after 5s');
  assert.deepEqual(after.facts, facts, 'the hash and stills survive a failed PUT');
  assert.equal(uploads.length, 1);
  await clock.advance(4999);
  assert.equal(uploads.length, 1, 'not before the backoff');
  await clock.advance(1);
  assert.equal(uploads.length, 2, 'retries on its own');
  assert.deepEqual(uploads[1].entry.facts, facts, 'the retry reuses the facts');
  uploads[1].d.reject(new Error('network'));
  await flush();
  assert.equal(queue.get(a.id).nextAttemptAt, clock.now() + 10000, 'backoff doubles');
  await queue.kick('online');
  await flush();
  assert.equal(uploads.length, 3, 'signal back skips the backoff');
  uploads[2].d.resolve(okResult);
  await flush();
  assert.equal(queue.films().length, 0);
}

{
  // Airplane mode: nothing is attempted, the film is held, the online event sends it.
  let online = false;
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    isOnline: () => online,
    now: clock.now,
    timers: clock.timers,
  });
  const a = Core.newDayFilmEntry({ owner: 'user:1', jobId: 'job-a', blob: fakeBlob(10) });
  await queue.enqueue(a);
  await flush();
  assert.equal(uploads.length, 0, 'no radio: do not burn an attempt');
  assert.equal(queue.get(a.id).status, 'waiting');
  assert.equal(queue.get(a.id).lastError, Core.WAITING_FOR_SIGNAL);
  assert.equal((await store.list()).length, 1, 'the film is held on the phone');
  online = true;
  await queue.kick('online');
  await flush();
  assert.equal(uploads.length, 1, 'the online event files it immediately');
  uploads[0].d.resolve(okResult);
  await flush();
}

{
  // Signed out, or another crew on the phone: films wait for their owner.
  let owner = '';
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    canRun: (e) => e.owner === owner,
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const mine = Core.newDayFilmEntry({ owner: 'user:1', jobId: 'job-a', blob: fakeBlob(10) });
  const theirs = Core.newDayFilmEntry({ owner: 'user:2', jobId: 'job-z', blob: fakeBlob(10) });
  await queue.enqueue(mine);
  await queue.enqueue(theirs);
  await flush();
  assert.equal(uploads.length, 0, 'signed out: films wait, nothing is sent');
  assert.equal(queue.pending().length, 2);
  owner = 'user:1';
  await queue.kick('session');
  await flush();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].entry.owner, 'user:1', "only the signed-in crew's films file");
  uploads[0].d.resolve(okResult);
  await flush();
  assert.equal(uploads.length, 1, "another crew's film stays on the phone for them");
  assert.equal(queue.pending((f) => f.owner === 'user:2').length, 1);
}

{
  // A day filmed on a phone-only job files once the office id arrives.
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    resolveJob(entry) {
      if (Core.isLocalJobId(entry.jobId)) return Promise.reject(new Error(Core.WAITING_FOR_SIGNAL));
      return Promise.resolve(entry.jobId);
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const a = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'local-1-abc', jobDraft: { title: 'Camden Court' }, blob: fakeBlob(10),
  });
  await queue.enqueue(a);
  await flush();
  assert.equal(uploads.length, 0, 'no office job yet: nothing to PUT against');
  assert.equal(queue.get(a.id).status, 'waiting');
  assert.equal(queue.get(a.id).lastError, Core.WAITING_FOR_SIGNAL);
  assert.equal(
    JSON.stringify(queue.get(a.id).jobDraft),
    JSON.stringify({ title: 'Camden Court', situation: '' }),
    'the film carries the draft so a cleared draft list can recreate the job',
  );
  const moved = await queue.remapJob('local-1-abc', 'job-1038');
  await flush();
  assert.equal(moved, 1);
  assert.equal(uploads.length, 1, 'the office id arrives → files at once, no backoff');
  assert.equal(uploads[0].entry.jobId, 'job-1038');
  assert.equal((await store.list())[0].jobId, 'job-1038', 'the remap is saved on the phone too');
  uploads[0].d.resolve(okResult);
  await flush();
}

{
  // The tab dies mid-upload: the next launch finds both films and starts over, oldest first.
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const first = Core.createDayFilmQueue({
    store,
    upload() {
      return deferred().promise;
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const older = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-a', jobName: 'Meridian Ave', blob: fakeBlob(10), recordedAt: '2026-09-09T09:00:00.000Z',
  });
  const newer = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-b', jobName: 'Cedar Ridge', blob: fakeBlob(10), recordedAt: '2026-09-09T09:30:00.000Z',
  });
  await first.enqueue(newer);
  await first.enqueue(older);
  await flush();
  assert.equal(first.get(newer.id).status, 'uploading');
  assert.equal(first.get(older.id).status, 'queued');
  const uploads = [];
  const second = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const films = await second.load();
  assert.equal(films.length, 2, 'a killed tab keeps both films');
  assert.ok(films.every((f) => f.status === 'queued'), 'a film left mid-upload starts over instead of hanging');
  await second.kick('session');
  await flush();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].entry.id, older.id, 'oldest first');
  assert.ok(uploads[0].entry.blob, 'the bytes come back from the store');
}

{
  // The Today strip, in words.
  const films = [
    { id: 'f1', owner: 'user:1', status: 'uploading', progress: 0.43, step: 'Uploading…', jobName: 'Meridian Ave', durationSeconds: 720, lastStatus: 0, jobId: 'job-a' },
    { id: 'f2', owner: 'user:1', status: 'waiting', progress: 0, jobName: 'Cedar Ridge', durationSeconds: 180, lastError: 'network', lastStatus: 0, jobId: 'job-b' },
    { id: 'f3', owner: 'user:2', status: 'queued', jobId: 'job-z' },
  ];
  const busy = Core.summarizeDayFilms(films, { owner: 'user:1', online: true, signedIn: true });
  assert.equal(busy.count, 2, "only this crew's films");
  assert.equal(busy.tone, 'busy');
  assert.equal(busy.title, 'Filing 2 days with the office');
  assert.equal(busy.detail, 'Uploading… · 43%');
  assert.equal(busy.progress, 0.43);
  assert.deepEqual(busy.rows.map((r) => r.state), ['Filing · 43%', 'Retrying…']);
  assert.equal(busy.rows[0].name, 'Meridian Ave');
  assert.equal(busy.rows[0].length, '12 minutes');
  const offline = Core.summarizeDayFilms([films[1]], { owner: 'user:1', online: false, signedIn: true });
  assert.equal(offline.tone, 'wait');
  assert.equal(offline.title, '1 day saved on this phone');
  assert.match(offline.detail, /Waiting for signal/);
  assert.deepEqual(offline.rows.map((r) => r.state), ['Waiting for signal']);
  const signedOut = Core.summarizeDayFilms(films, { signedIn: false });
  assert.equal(signedOut.count, 3);
  assert.equal(signedOut.title, 'Sign in to finish filing 3 days');
  assert.equal(signedOut.signInLine, '3 days are saved on this phone. Sign in to finish filing them.');
  const stuck = Core.summarizeDayFilms(
    [{ id: 'f4', owner: 'user:1', status: 'waiting', lastError: 'That day film is too large to assemble here.', lastStatus: 413, jobId: 'job-a' }],
    { owner: 'user:1', online: true, signedIn: true },
  );
  assert.equal(stuck.tone, 'warn');
  assert.equal(stuck.detail, 'That day film is too large to assemble here.', 'a server answer that will not change by itself is said out loud');
  assert.deepEqual(stuck.rows.map((r) => r.state), ['Needs the office']);
  const volatile = Core.summarizeDayFilms(
    [{ id: 'f5', owner: 'user:1', status: 'queued', volatile: true, jobId: 'job-a' }],
    { owner: 'user:1', online: true, signedIn: true },
  );
  assert.match(volatile.detail, /Keep Field Capture open/);
  assert.equal(Core.summarizeDayFilms([], { owner: 'user:1' }).count, 0);
  const localJob = Core.summarizeDayFilms(
    [{ id: 'f6', owner: 'user:1', status: 'waiting', jobId: 'local-9', lastError: Core.WAITING_FOR_SIGNAL, lastStatus: 0 }],
    { owner: 'user:1', online: true, signedIn: true },
  );
  assert.deepEqual(localJob.rows.map((r) => r.state), ['Creating the job']);
  assert.equal(Core.filingHomeVisible(busy), false, 'busy Uploading… is not a home banner');
  assert.equal(Core.filingHomeVisible(offline), false, 'waiting for signal is not a home banner');
  assert.equal(Core.filingHomeVisible(signedOut), true, 'sign-in needed stays on home');
  assert.equal(Core.filingHomeVisible(stuck), true, 'stuck filing stays on home');
  assert.equal(Core.filingHomeVisible(volatile), true, 'volatile keep-open stays on home');
  assert.equal(volatile.tone, 'warn', 'volatile elevates to warn so home can show it');
}

{
  const e = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-a', jobName: 'Meridian Ave', blob: fakeBlob(4096), mimeType: 'video/webm',
    durationSeconds: 61, site: { lat: 30.1, lon: -97.7, accuracyM: 12 },
  });
  assert.match(e.id, /^film-/);
  assert.equal(e.byteSize, 4096);
  assert.equal(e.workDate, Core.todayISO(), 'stamped on the day it was filmed');
  assert.ok(Date.parse(e.recordedAt) > 0);
  assert.equal(JSON.stringify(e.site), JSON.stringify({ lat: 30.1, lon: -97.7, accuracyM: 12 }));
  assert.equal(e.status, 'queued');
  assert.equal(e.attempts, 0);
  assert.equal(e.jobDraft, null);
  assert.equal(Core.newDayFilmEntry({ site: { lat: null } }).site, null);
  assert.equal(Core.newDayFilmEntry({ durationSeconds: 0 }).durationSeconds, null, '0:00 is unknown, not a length');
  assert.equal(Core.newDayFilmEntry({ mode: 'share' }).mode, 'share');
  assert.equal(Core.newDayFilmEntry({}).mode, 'account');
}


/* ---------- upload while recording ----------
   Chunks group into parts and PUT while the camera rolls, one at a time and in
   order. By hold-to-finish most of the film is with the office; the queue sends
   the tail and asks the office to stitch. Any failure just stops the head start. */

assert.equal(typeof Core.createDayFilmStreamer, 'function');
assert.equal(typeof Core.mintPartUploadUrl, 'function');
assert.equal(typeof Core.newClipId, 'function');
assert.equal(typeof Core.localDateISO, 'function');
assert.equal(Core.STREAM_PART_BYTES, 8 * 1024 * 1024);
assert.equal(Core.STREAM_MAX_BYTES, 512 * 1024 * 1024, 'the office stitches at most 512 MB');
assert.equal(Core.STREAM_MAX_PARTS, 128);
assert.match(Core.newClipId(), Core.CLIP_ID, 'clip ids fit the storage path rule');
assert.notEqual(Core.newClipId(), Core.newClipId());
assert.equal(Core.localDateISO(Date.parse('2026-09-09T12:00:00Z')).length, 10);
assert.equal(Core.streamStateOf(null), null);
assert.equal(Core.streamStateOf({ path: 'p', partCount: 0 }), null, 'no landed part → no head start');
assert.equal(
  JSON.stringify(Core.streamStateOf({ path: 'p', partCount: 2, bytesDone: 20, partBytes: 4096, inFlight: true, broken: 'x' })),
  JSON.stringify({ path: 'p', partCount: 2, bytesDone: 20, partBytes: 4096 }),
);
assert.match(coreSrc, /\/proof\/upload-part-url/, 'one signed URL per slice while recording');
assert.match(coreSrc, /function uploadStreamedTail/, 'only the tail is sent after hold-to-finish');
assert.match(coreSrc, /runPool\(tail, 2,/, 'tail parts go two at a time');
assert.match(coreSrc, /whole\.streamFailed = true/, 'a head the office will not stitch falls back to the whole film');
assert.match(coreSrc, /clipId: clipId \|\| undefined/, 'every recording asks for its own storage object');
assert.match(appSrc, /function canStreamNow/);
assert.match(appSrc, /function streamChunk/);
assert.match(appSrc, /onChunk: function \(chunk, meta\)/, 'the recorder hands every chunk to the streamer');
assert.match(appSrc, /Core\.createDayFilmStreamer\(\{/);
assert.match(appSrc, /partBytes: Core\.STREAM_PART_BYTES/);
assert.match(appSrc, /rec\.streamer\.finish\(\)/);
assert.match(appSrc, /clipId: rec \? rec\.clipId : undefined/, 'the film carries the clip id its parts were streamed under');
assert.match(appSrc, /stream: entry\.stream \|\| null/);
assert.match(appSrc, /onStreamAdvance: hooks\.onStreamAdvance/, 'tail progress is saved so a retry resumes from solid ground');
assert.match(appSrc, /workDate: Core\.localDateISO/, 'a film is filed under the day it STARTED');
assert.match(appSrc, /function recordAnother/);
assert.match(appSrc, /when\('#nextbtn'/, 'Record another lives on the door');
{
  const from = appSrc.indexOf('function recordAnother');
  const to = appSrc.indexOf('/** The office has it');
  assert.ok(from >= 0 && to > from, 'recordAnother must exist');
  const src = appSrc.slice(from, to);
  assert.match(src, /startLiveDay\(\)/, 'one tap from the door opens the camera again');
  assert.doesNotMatch(src, /show\('s-home'\);\s*startLiveDay/, 'no detour through Today');
}

{
  // Chunks group into parts; parts land one at a time, in order.
  const clock = fakeClock();
  const puts = [];
  const mints = [];
  const streamer = Core.createDayFilmStreamer({
    mimeType: 'video/webm',
    partBytes: 4096,
    mint: async (index) => {
      mints.push(index);
      return { uploadUrl: 'u' + index, path: 'org/job/party/2026-09-09-after-abc123.webm' };
    },
    put: (url, blob, mime, onProgress, control) => {
      const d = deferred();
      control.abort = () => d.reject(new Error('aborted'));
      puts.push({ url, size: blob.size, d });
      return d.promise;
    },
    timers: clock.timers,
    wait: () => Promise.resolve(),
  });
  const chunk = (n) => new Blob([new Uint8Array(n)]);
  streamer.push(chunk(1500));
  streamer.push(chunk(1500));
  await flush();
  assert.equal(puts.length, 0, 'not yet a full part');
  streamer.push(chunk(1500));
  await flush();
  assert.equal(puts.length, 1, 'a full part is sent while recording continues');
  assert.equal(puts[0].size, 4500, 'a part is whole chunks, never a split chunk');
  assert.deepEqual(mints, [0]);
  streamer.push(chunk(4096));
  await flush();
  assert.equal(puts.length, 1, 'one part in flight at a time keeps the landed prefix contiguous');
  puts[0].d.resolve({ ok: true });
  await flush();
  assert.equal(puts.length, 2);
  assert.equal(streamer.snapshot().bytesDone, 4500);
  assert.equal(streamer.snapshot().partCount, 1);
  assert.equal(streamer.snapshot().path, 'org/job/party/2026-09-09-after-abc123.webm');
  streamer.push(chunk(300));
  const fin = streamer.finish();
  assert.equal(fin.snapshot.bytesDone, 4500, 'the snapshot at finish counts only landed parts');
  assert.equal(fin.snapshot.inFlight, true);
  puts[1].d.resolve({ ok: true });
  const final = await fin.settled;
  assert.equal(final.bytesDone, 8596, 'the part in flight at finish still counts once it lands');
  assert.equal(final.partCount, 2);
  assert.equal(final.inFlight, false);
  assert.equal(final.broken, '');
  streamer.push(chunk(8192));
  await flush();
  assert.equal(puts.length, 2, 'nothing new is sent after finish — the queue owns the tail');
}

{
  // A part that will not land stops the head start; nothing is lost.
  const clock = fakeClock();
  let mints = 0;
  const streamer = Core.createDayFilmStreamer({
    partBytes: 4096,
    mint: async (index) => {
      mints += 1;
      return { uploadUrl: 'u' + index, path: 'p' };
    },
    put: () => Promise.reject(new Error('network')),
    timers: clock.timers,
    wait: () => Promise.resolve(),
  });
  streamer.push(new Blob([new Uint8Array(4096)]));
  await flush();
  assert.equal(mints, 3, 'three tries, then stop');
  assert.equal(streamer.snapshot().broken, 'network');
  assert.equal(streamer.snapshot().bytesDone, 0);
  streamer.push(new Blob([new Uint8Array(4096)]));
  await flush();
  assert.equal(mints, 3, 'once broken, no more attempts while recording');
  const fin = streamer.finish();
  const final = await fin.settled;
  assert.equal(final.partCount, 0);
  assert.equal(Core.streamStateOf(final), null, 'the queue sends the whole film');
}

{
  // finish() never holds the door: past the cap the part in flight is cut off.
  const clock = fakeClock();
  let aborted = false;
  const streamer = Core.createDayFilmStreamer({
    partBytes: 4096,
    finishWaitMs: 1000,
    mint: async () => ({ uploadUrl: 'u', path: 'p' }),
    put: (url, blob, mime, onProgress, control) => {
      const d = deferred();
      control.abort = () => {
        aborted = true;
        d.reject(new Error('aborted'));
      };
      return d.promise;
    },
    timers: clock.timers,
    wait: () => Promise.resolve(),
  });
  streamer.push(new Blob([new Uint8Array(4096)]));
  await flush();
  const fin = streamer.finish();
  assert.equal(fin.snapshot.inFlight, true);
  await clock.advance(999);
  assert.equal(aborted, false);
  await clock.advance(1);
  assert.equal(aborted, true, 'the cap cuts the PUT off');
  const final = await fin.settled;
  assert.equal(final.bytesDone, 0, 'a cut-off part does not count');
  assert.equal(final.inFlight, false);
}

{
  // The queue holds a film until its streamed head has settled, then sends the tail.
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const settle = deferred();
  const film = Core.newDayFilmEntry({
    owner: 'user:1', jobId: 'job-a', clipId: 'abc123xyz', blob: fakeBlob(40),
    stream: { path: 'org/job/party/2026-09-09-after-abc123xyz.webm', partCount: 1, bytesDone: 4500, partBytes: 4096, inFlight: true },
  });
  assert.equal(film.clipId, 'abc123xyz');
  assert.equal(JSON.stringify(film.stream), JSON.stringify({ path: 'org/job/party/2026-09-09-after-abc123xyz.webm', partCount: 1, bytesDone: 4500, partBytes: 4096 }));
  await queue.enqueue(film, { settle: settle.promise });
  await flush();
  assert.equal(uploads.length, 0, 'the tail waits for the part in flight to land');
  assert.equal(queue.get(film.id).status, 'queued');
  settle.resolve({ stream: { path: 'org/job/party/2026-09-09-after-abc123xyz.webm', partCount: 2, bytesDone: 8596, partBytes: 4096 } });
  await flush();
  assert.equal(uploads.length, 1, 'settled → the tail goes at once');
  assert.equal(uploads[0].entry.stream.bytesDone, 8596, 'the upload sees the landed head');
  assert.equal((await store.list())[0].stream.bytesDone, 8596, 'and it is saved on the phone');
  // The office refuses to stitch: the queue drops the head and sends the whole film right away.
  uploads[0].d.reject(Object.assign(new Error('Upload part 2 did not land. Retry that slice.'), { status: 409, streamFailed: true }));
  await flush();
  assert.equal(uploads.length, 2, 'whole-film attempt starts without waiting for a backoff');
  assert.equal(uploads[1].entry.stream, null);
  uploads[1].d.resolve(okResult);
  await flush();
  assert.equal(queue.films().length, 0);
}

{
  // A settle that never comes back cannot hold a film forever.
  const store = Core.openDayFilmStore({ indexedDB: null });
  const clock = fakeClock();
  const uploads = [];
  const queue = Core.createDayFilmQueue({
    store,
    upload(entry) {
      const d = deferred();
      uploads.push({ entry, d });
      return d.promise;
    },
    isOnline: () => true,
    now: clock.now,
    timers: clock.timers,
  });
  const film = Core.newDayFilmEntry({ owner: 'user:1', jobId: 'job-a', blob: fakeBlob(40) });
  assert.match(film.clipId, Core.CLIP_ID, 'every film gets a clip id even without streaming');
  await queue.enqueue(film, { settle: new Promise(() => {}) });
  await flush();
  assert.equal(uploads.length, 0);
  await clock.advance(20 * 1000 + 5000);
  assert.equal(uploads.length, 1, 'the guard releases the hold');
  uploads[0].d.resolve(okResult);
  await flush();
}

assert.equal(typeof Core.preferTodayAfterInviteSignIn, 'function');
assert.equal(Core.preferTodayAfterInviteSignIn([{ id: 'a' }, { id: 'b' }]), true);
assert.equal(Core.preferTodayAfterInviteSignIn([{ id: 'a' }]), false);
assert.match(appSrc, /openInviteAfterAccountSignIn/, 'account=1 sign-in can prefer Today');

console.log('hold-to-finish OK');
