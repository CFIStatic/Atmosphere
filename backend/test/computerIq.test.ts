/**
 * Computer IQ: site catalog and terms guard, practice tasks, playbook steps
 * (PII rules), model routing, DOM tools with verification, file upload and
 * download, stuck handoff, practice runs with playbook capture and replay.
 * Runs the real worker, agent and gate on the mock provider.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentBlock, ComputerModel, ComputerModelRequest, ComputerModelResponse } from '../src/computer/agent.js';
import { computerSettings } from '../src/computer/config.js';
import { MockComputerProvider, MockSite } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { decideApproval, startComputerTask } from '../src/computer/service.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { runComputerTask, setComputerWorkerDepsForTests, type ComputerWorkerDeps } from '../src/computer/worker.js';
import {
  CATEGORY_LABELS,
  SITE_CATALOG,
  catalogSiteForHost,
  isAutomationRestrictedSite,
  loginCatalogView,
  pickerSites,
  siteGuideFor,
  starterSignInPlaybook,
  EXCLUDED_SITES,
} from '../src/computer/catalog/sites.js';
import { autoSignIn, signInHintsFor, type SavedSignIn } from '../src/computer/autoSignIn.js';
import { credentialKeyFingerprint, sealCredential } from '../src/computer/credentialCrypto.js';
import { MockDriver } from '../src/computer/providers/mock.js';
import { assertNoPii } from '../src/computer/sitePlaybooks.js';
import { PRACTICE_MAILBOX, PRACTICE_TASKS, type PracticeTask } from '../src/computer/iq/practice/catalog.js';
import { runPracticeTask } from '../src/computer/iq/practice/runner.js';
import { MemoryIqStore } from '../src/computer/iq/store.js';
import { chooseRoute, routingConfig } from '../src/computer/iq/routing.js';
import { parseSteps, stepsFromRecording, stepsFromTrace } from '../src/computer/iq/playbookSteps.js';
import type { JobFileAskContext } from '../src/shared/jobFileAsk.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const USER = '0c000000-0000-4000-8000-000000000003';
const JOB = '0d000000-0000-4000-8000-000000000004';
const FILE: JobFileAskContext = { job: { title: 'TEST roof', claimNumber: 'CLM-TEST-001' }, facts: { 'Insured name': 'Jane Testcase' }, messages: [] };

let seq = 0;
const computer = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({ type: 'tool_use', id: `tu_${(seq += 1)}`, name, toolset_name: 'computer', input });
const tool = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({ type: 'tool_use', id: `tu_${(seq += 1)}`, name, input });

function scripted(turns: Array<ContentBlock[] | ((req: ComputerModelRequest) => ContentBlock[])>) {
  const seen: ComputerModelRequest[] = [];
  const model: ComputerModel = {
    async create(req): Promise<ComputerModelResponse> {
      seen.push(JSON.parse(JSON.stringify(req)));
      const turn = turns[seen.length - 1];
      const content = turn ? (typeof turn === 'function' ? turn(req) : turn) : [tool('finish', { title: 'Out of script', fields: [], submitted: false })];
      return { model: req.model, content, usage: { input_tokens: 1000, output_tokens: 100 } };
    },
  };
  return { model, seen };
}

const lastResults = (req: ComputerModelRequest) => req.messages[req.messages.length - 1].content.filter((b) => b.type === 'tool_result');
const text = (b: ContentBlock) =>
  typeof b.content === 'string' ? b.content : (b.content as ContentBlock[]).filter((c) => c.type === 'text').map((c) => c.text).join(' ');

const metering = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;

afterEach(() => {
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

/* ------------------------------------------------------------- catalog -- */

test('catalog: no Xactimate or XactAnalysis anywhere, and Verisk hosts are restricted', () => {
  const blob = JSON.stringify(SITE_CATALOG).toLowerCase();
  assert.ok(!/xactimate|xactanalysis|xactware/.test(blob));
  assert.ok(!PRACTICE_TASKS.some((t) => /xact/i.test(JSON.stringify(t))));
  for (const h of ['identity.xactware.com', 'www.xactanalysis.com', 'xactimate.com', 'www.verisk.com', 'www.claimxperience.com']) assert.equal(isAutomationRestrictedSite(h), true, h);
  assert.ok(!/claimxperience/.test(blob), 'ClaimXperience (Verisk) is excluded, not catalogued');
});

test('catalog: entries are well formed data', () => {
  const ids = new Set<string>();
  for (const s of SITE_CATALOG) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`);
    ids.add(s.id);
    assert.match(s.signInUrl, /^https:\/\//, s.id);
    assert.ok(s.hosts.length > 0 && s.hosts.every((h) => /^[a-z0-9.-]+$/.test(h)), s.id);
    assert.ok(CATEGORY_LABELS[s.category], s.id);
    assert.ok(s.terms.note.length > 10 && /^https:\/\//.test(s.terms.url), s.id);
    assert.ok(s.logo.text.length <= 3 && /^#[0-9A-F]{6}$/i.test(s.logo.color), s.id);
  }
});

test('catalog: the major business sites the user named are in the picker', () => {
  const picker = new Set(pickerSites().map((s) => s.id));
  for (const id of [
    'outlook', 'microsoft365', 'teams', 'gmail', 'google_calendar', 'google_drive', 'google_business', 'slack', 'zoom',
    'dropbox', 'docusign', 'adobe', 'salesforce', 'hubspot', 'quickbooks', 'stripe', 'gusto',
    'acculynx', 'jobnimbus', 'housecallpro', 'jobber', 'jobtread', 'buildertrend', 'companycam', 'grainger',
    'gafquickmeasure', 'servicefinance',
    'managecasa', 'propertymeld', 'vendorcafe', 'alacnet', 'allcat',
    'encircle', 'albi', 'docusketch', 'xcelerate',
  ]) {
    assert.ok(picker.has(id), id);
  }
});

test('catalog: Google, Microsoft and Slack are marked for codes and single sign-on', () => {
  for (const id of ['outlook', 'microsoft365', 'teams', 'gmail', 'google_calendar', 'google_drive', 'google_business', 'slack']) {
    const s = SITE_CATALOG.find((x) => x.id === id)!;
    assert.equal(s.twoStep, 'likely', id);
    assert.equal(s.sso, true, id);
  }
});

const TERMS_FLAGGED_41 = ['homedepot', 'lowes', 'abcsupply', 'srs', 'beacon', 'ferguson', 'sherwinwilliams', 'eagleview', 'hover', 'roofr', 'servicetitan', 'greensky', 'hearth', 'box', 'xero', 'square', 'paypal', 'amazonbusiness', 'linkedin', 'meta_business', 'yelp_business', 'angi', 'thumbtack', 'nextdoor', 'indeed', 'adp',
  'appfolio', 'buildium', 'realpage', 'propertyware', 'entrata', 'servicechannel', 'corrigo', 'latchel', 'procore',
  'accuserve', 'contractorconnection', 'symbility', 'nextgear', 'allstate', 'matterport'];

test('catalog: sites whose terms ban automation are normal entries (customer decision); the flag is staff data only', () => {
  const byId = new Map(SITE_CATALOG.map((s) => [s.id, s]));
  const view = loginCatalogView();
  const inView = new Set(view.sites.map((s) => s.id));
  for (const id of TERMS_FLAGGED_41) {
    const s = byId.get(id)!;
    assert.equal(s.terms.status, 'flagged', `${id}: the internal terms flag is kept`);
    assert.equal(isAutomationRestrictedSite(s.hosts[0]), false, `${id}: a terms flag restricts nothing`);
    if (id === 'allstate') {
      // Its only public portal is for roadside/towing providers: no verified contractor sign-in, so not offered.
      assert.ok(s.notInPicker && !inView.has(id) && s.signIn === null);
      continue;
    }
    assert.ok(inView.has(id), `${id} is in Add a login`);
    assert.ok(s.signIn, `${id} is ready to go`);
    assert.ok(PRACTICE_TASKS.some((t) => t.catalogId === id), `${id} has a practice task`);
    assert.ok(siteGuideFor(s.hosts[0]).length > 0, `${id} has starter hints`);
  }
  assert.ok(view.sites.every((s) => s.termsNote === null), 'no terms warnings in the Logins UI');
  assert.ok(!JSON.stringify(view).includes('flagged'), 'terms verdicts never reach the customer catalog');
  assert.ok(!view.sites.some((s) => s.id.startsWith('practice_')), 'public test sites are practice-only');
  assert.equal(isAutomationRestrictedSite('outlook.office.com'), false);
  assert.ok(view.categories.every((c) => view.sites.some((s) => s.category === c.id)), 'no empty categories');
  assert.equal(view.sites.length, 76);
  assert.ok(view.categories.find((c) => c.id === 'suppliers')!.terms.includes('supply'), '"supply" finds Suppliers in the Logins search');
  // Sign-in pages that changed hands or sit behind a hub page.
  assert.equal(byId.get('beacon')!.signInUrl, 'https://www.qxo.com/', 'Beacon is now QXO');
  assert.equal(byId.get('beacon')!.signIn!.flow, 'open_first', 'QXO: click Login (its home-page email box is a newsletter sign-up)');
  assert.equal(byId.get('abcsupply')!.signInUrl, 'https://account.abcsupply.com/', 'myABCsupply, not the WordPress login');
  assert.equal(byId.get('entrata')!.signInUrl, 'https://sso.entrata.com/entrata/login');
  const hd = PRACTICE_TASKS.find((t) => t.key === 'homedepot.supplier_search')!;
  assert.equal(hd.mode, 'read_only');
  assert.match(hd.instructions, /Do not add anything to the cart/);
});

test('catalog: host lookup and starter guides', () => {
  assert.equal(catalogSiteForHost('outlook.office.com')?.id, 'outlook');
  assert.equal(catalogSiteForHost('my.acculynx.com')?.id, 'acculynx');
  assert.equal(catalogSiteForHost('unknown.example'), null);
  assert.ok(siteGuideFor('app.jobnimbus.com').some((g) => /Jobs/.test(g)));
  assert.match(siteGuideFor('www.homedepot.com')[0], /^Sign-in: Username, then Next, then password/);
  assert.equal(catalogSiteForHost('interiors.app.accuserve.com')?.aliases.includes('code blue'), true, 'Code Blue now runs under Accuserve');
  assert.ok(SITE_CATALOG.find((s) => s.id === 'hover')!.aliases.includes('hover for carriers'));
  assert.ok(SITE_CATALOG.find((s) => s.id === 'eagleview')!.aliases.includes('eagleview assess'));
  assert.ok(siteGuideFor('app.propertymeld.com').some((g) => /work order/i.test(g)));
  assert.ok(siteGuideFor('www.alacrity.net').some((g) => /claim/i.test(g)));
  assert.ok(catalogSiteForHost('www.alacrity.net')!.aliases.includes('accltery'));
  assert.equal(isAutomationRestrictedSite('login.procore.com'), false, 'only Verisk sites are restricted');
});

test('catalog: restoration tools, Verisk exclusions and sites left out', () => {
  const byId = new Map(SITE_CATALOG.map((s) => [s.id, s]));
  for (const id of ['encircle', 'albi', 'docusketch', 'xcelerate', 'nextgear', 'matterport']) assert.equal(byId.get(id)?.category, 'restoration', id);
  assert.equal(byId.get('nextgear')!.terms.status, 'flagged', 'DASH by Next Gear: Cotality terms ban robots');
  assert.equal(byId.get('matterport')!.terms.status, 'flagged', 'Matterport bans AI agents by name');
  for (const h of ['rl.restorationmanager.net', 'www.claimxperience.com']) assert.equal(isAutomationRestrictedSite(h), true, h);
  assert.ok(EXCLUDED_SITES.some((e) => e.name === 'Restoration Manager'));
  // No verified sign-in page (or the page shows no form): left out rather than guessed.
  for (const id of ['sedgwick', 'statefarm', 'clerkoftheworks', 'restore365', 'psa', 'irestore', 'resman', 'rentmanager', 'paragon', 'wegman']) assert.ok(!byId.has(id), id);
  // Accela has one address per city: recognised and practised, not offered in the picker.
  assert.ok(byId.has('accela') && !pickerSites().some((s) => s.id === 'accela'));
});

test('ready to go: every picker site has a checked sign-in recipe, steps in plain words and a starter playbook', () => {
  const view = loginCatalogView();
  for (const site of pickerSites()) {
    assert.ok(site.signIn, `${site.id} has a sign-in recipe`);
    assert.ok(['live_page', 'blocked_probe'].includes(site.signIn!.checked), site.id);
    if (site.signIn!.flow === 'open_first') assert.ok(site.signIn!.openWith?.length, `${site.id} names the link that opens the form`);
    const entry = view.sites.find((e) => e.id === site.id)!;
    assert.match(entry.signInSteps, /Computer fills in the saved login/, site.id);
    const steps = starterSignInPlaybook(site);
    assert.deepEqual(steps[0], { kind: 'navigate', url: site.signInUrl }, site.id);
    assert.ok(!steps.some((st) => st.kind === 'type'), `${site.id}: no typed step, credentials never become playbook slots`);
    assertNoPii(steps);
    assert.match(siteGuideFor(site.hosts[0])[0], /^Sign-in: /, site.id);
  }
  for (const s of SITE_CATALOG.filter((x) => x.notInPicker && !x.signIn)) assert.ok(!view.sites.some((e) => e.id === s.id), s.id);
  const m365 = SITE_CATALOG.find((s) => s.id === 'microsoft365')!;
  assert.deepEqual(starterSignInPlaybook(m365)[1], { kind: 'click', target: { role: 'link', name: 'Sign in', tag: null } });
});

function savedFor(host: string, url: string): SavedSignIn {
  const loginId = 'login-ready-1';
  const org = 'org-ready';
  return {
    login: { id: loginId, org_id: org, label: host, url, host, cookie_domains: [], created_by: null, created_at: '', last_signed_in_at: null, last_signed_in_by: null, updated_at: '' },
    credential: {
      login_id: loginId, org_id: org, key_fingerprint: credentialKeyFingerprint(), login_url: url, status: 'ok', attention_reason: null, last_used_at: null, created_by: null, updated_by: null, created_at: '', updated_at: '',
      username_sealed: sealCredential('ready.user@example-carrier.test', org, loginId, 'username'),
      password_sealed: sealCredential('PW-ready-zq9-never-shown', org, loginId, 'password'),
    },
  };
}

async function withCredentialKey(fn: () => Promise<void>) {
  const before = process.env.COMPUTER_CREDENTIAL_KEY;
  process.env.COMPUTER_CREDENTIAL_KEY = 'test-only-computer-credential-key-0123456789abcdef';
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.COMPUTER_CREDENTIAL_KEY;
    else process.env.COMPUTER_CREDENTIAL_KEY = before;
  }
}

test('sign-in hints: catalog recipe link and identity providers; other websites are refused', async () => {
  await withCredentialKey(async () => {
    const m365 = signInHintsFor(savedFor('m365.cloud.microsoft', 'https://m365.cloud.microsoft/'));
    assert.deepEqual(m365.openWith, ['Sign in']);
    assert.equal(m365.allowHost!('login.microsoftonline.com'), true);
    assert.equal(m365.allowHost!('m365.cloud.microsoft'), true);
    assert.equal(m365.allowHost!('phish.example.net'), false);
    const encircle = signInHintsFor(savedFor('encircleapp.com', 'https://encircleapp.com/login'));
    assert.equal(encircle.allowHost!('auth.encircleapp.com'), true);
  });
});

test('auto sign-in opens a form behind a "Sign in" link, and never types the password on another website', async () => {
  await withCredentialKey(async () => {
    const store = new MemoryComputerStore();
    const audit = {};
    const url = 'https://portal.example-carrier.test/login';

    const behind = new MockSite({ start: 'login', signInBehind: { link: 'Sign in' }, account: { username: 'ready.user@example-carrier.test', password: 'PW-ready-zq9-never-shown' } });
    const ok = await autoSignIn({ store, driver: new MockDriver(behind), saved: savedFor('portal.example-carrier.test', url), now: () => Date.now(), audit });
    assert.equal(ok.outcome, 'signed_in', ok.message);
    assert.ok(behind.actions.includes('open_sign_in:Sign in'));

    const offSite = new MockSite({ start: 'login', signInBehind: { link: 'Sign in', leadsTo: 'phish.example.net' } });
    const refused = await autoSignIn({ store, driver: new MockDriver(offSite), saved: savedFor('portal.example-carrier.test', url), now: () => Date.now(), audit });
    assert.equal(refused.outcome, 'incomplete');
    assert.match(refused.message, /different website/);
    assert.equal(offSite.values.password, undefined, 'the password was not typed');
    assert.ok(!refused.message.includes('PW-ready'));
  });
});

test('practice tasks: generated per site, read-only or stop-before-submit, unique keys', () => {
  const keys = new Set(PRACTICE_TASKS.map((t) => t.key));
  assert.equal(keys.size, PRACTICE_TASKS.length);
  assert.ok(PRACTICE_TASKS.length >= 30);
  for (const t of PRACTICE_TASKS) assert.ok(t.mode === 'read_only' || t.mode === 'stop_before_submit', t.key);
  const draft = PRACTICE_TASKS.find((t) => t.key === 'outlook.draft_email')!;
  assert.equal(draft.params?.recipient, PRACTICE_MAILBOX);
  assert.ok(!/@(?!atmosphereteam\.com)/.test(draft.instructions.replace(PRACTICE_MAILBOX, '')), 'a practice draft names only the practice mailbox');
  for (const k of ['practice_forms.fill_form', 'practice_forms.upload_file', 'practice_signin.download_file', 'accela.permit_search']) {
    assert.equal(PRACTICE_TASKS.find((t) => t.key === k)?.loginHost, null, k);
  }
  assert.equal(PRACTICE_TASKS.find((t) => t.key === 'practice_signin.sign_in_check')?.loginHost, 'the-internet.herokuapp.com');
  assert.match(PRACTICE_TASKS.find((t) => t.key === 'accela.permit_search')!.startUrl, /^https:\/\/aca-prod\.accela\.com\/ATLANTA_GA\//, 'a real agency portal, not the bare Accela host');
  assert.equal(PRACTICE_TASKS.find((t) => t.key === 'gmail.read_inbox')?.loginHost, 'mail.google.com');
  assert.equal(PRACTICE_TASKS.find((t) => t.key === 'propertymeld.work_orders_open')?.loginHost, 'app.propertymeld.com');
  assert.equal(PRACTICE_TASKS.find((t) => t.key === 'alacnet.claim_assignments')?.mode, 'read_only');
  assert.equal(PRACTICE_TASKS.find((t) => t.key === 'encircle.restoration_jobs')?.loginHost, 'encircleapp.com');
});

/* ----------------------------------------------------- playbook steps -- */

test('playbook steps: typed values become slots, personal labels become explore steps', () => {
  const ctx = { projection: [{ key: 'claimNumber', label: 'Claim number', value: 'CLM-TEST-001', source: 'job' }], params: { query: 'safety glasses' }, instructions: '' } as never;
  const steps = stepsFromTrace(
    [
      { kind: 'navigate', url: 'https://portal.example.test/search?q=secret' },
      { kind: 'click', target: { role: 'textbox', name: 'Search', tag: 'input' } },
      { kind: 'type', target: { role: 'textbox', name: 'Search', tag: 'input' }, value: 'safety glasses' },
      { kind: 'click', target: { role: 'button', name: 'Go', tag: 'button' }, urlBefore: 'https://portal.example.test/', urlAfter: 'https://portal.example.test/s/x?y=1' },
      { kind: 'type', target: { role: 'textbox', name: 'Claim', tag: 'input' }, value: 'CLM-TEST-001' },
      { kind: 'click', target: { role: 'link', name: 'jane.testcase@example.test', tag: 'a' } },
    ],
    ctx,
  );
  const json = JSON.stringify(steps);
  assert.ok(!json.includes('safety glasses') && !json.includes('CLM-TEST-001') && !json.includes('jane.testcase'), json);
  assert.ok(!json.includes('secret'), 'query strings are dropped');
  assert.deepEqual(steps.find((s) => s.kind === 'type' && s.target.name === 'Search'), { kind: 'type', target: { role: 'textbox', name: 'Search', tag: 'input' }, slot: 'task.query' });
  assert.ok(steps.some((s) => s.kind === 'type' && s.slot === 'job.claimNumber'));
  assert.ok(steps.some((s) => s.kind === 'click' && s.expect?.urlIncludes === '/s'));
  assert.equal(steps[steps.length - 1].kind, 'explore');
});

test('playbook steps: a demonstration never records sign-in typing; malformed JSON is dropped', () => {
  const steps = stepsFromRecording(
    [
      { kind: 'sign_in', at: 1 },
      { kind: 'click', role: 'link', name: 'Jobs', tag: 'a', at: 2 },
      { kind: 'navigate', url: 'https://crm.example.test/jobs', at: 3 },
      { kind: 'type', role: 'textbox', name: 'Filter', tag: 'input', value: 'Some Person', at: 4 },
    ] as never,
    { projection: [], params: {}, instructions: '' },
  );
  assert.equal(steps[0].kind, 'explore');
  assert.ok(!JSON.stringify(steps).includes('Some Person'));
  assert.ok(steps.some((s) => s.kind === 'type' && s.slot === 'person'));
  assert.deepEqual(parseSteps([{ kind: 'navigate', url: 'javascript:alert(1)' }, { kind: 'click' }, { kind: 'explore', note: 'ok' }, 7]), [{ kind: 'explore', note: 'ok' }]);
});

/* ------------------------------------------------------------ routing -- */

test('routing: strong model plans and recovers, fast model for routine steps', () => {
  const cfg = routingConfig('claude-sonnet-5-5');
  const base = { step: 3, lastTurnFailed: false, afterHandoff: false, afterReplayFailure: false, noProgressTurns: 0, fastUnavailable: false };
  assert.equal(chooseRoute({ ...base, step: 1 }, cfg, 'claude-sonnet-5-5').route, 'strong');
  assert.equal(chooseRoute(base, cfg, 'claude-sonnet-5-5').route, 'fast');
  assert.equal(chooseRoute({ ...base, lastTurnFailed: true }, cfg, 'claude-sonnet-5-5').route, 'strong');
  assert.equal(chooseRoute({ ...base, noProgressTurns: 2 }, cfg, 'claude-sonnet-5-5').route, 'strong');
  assert.equal(chooseRoute({ ...base, fastUnavailable: true }, cfg, 'claude-sonnet-5-5').model, 'claude-sonnet-5-5');
});

/* ---------------------------------------------------- agent on the mock -- */

async function setup(opts: { turns: Parameters<typeof scripted>[0]; site?: MockSite; person?: (store: MemoryComputerStore) => Promise<void>; files?: boolean; iq?: MemoryIqStore }) {
  const store = new MemoryComputerStore();
  const site = opts.site ?? new MockSite();
  const provider = new MockComputerProvider({ site });
  const { model, seen } = scripted(opts.turns);
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    model,
    meteringClient: metering,
    iq: opts.iq ?? new MemoryIqStore(),
    isPaused: async () => false,
    sleep: async () => {
      await opts.person?.(store);
    },
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000 },
    ...(opts.files ? { taskFiles: async () => [{ id: 'f1', name: 'roof-photo.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('jpeg-bytes') }] } : {}),
  });
  const task = await startComputerTask({ orgId: ORG, userId: USER, jobId: JOB, instructions: 'Upload the roof photo to the claim form on portal.example-carrier.test.', file: FILE, address: '1 Test Lane' });
  return { store, site, provider, seen, taskId: task.id, run: () => runComputerTask(task.id) };
}

const approveAll = async (store: MemoryComputerStore) => {
  const pending = [...store.approvals.values()].find((a) => a.status === 'pending');
  if (pending) await decideApproval(ORG, pending.id, USER, 'approve');
};

test('DOM tools: click_element and type_into by role and name, with the page outline in the prompt', async () => {
  const h = await setup({
    turns: [
      [tool('type_into', { role: 'textbox', name: 'Insured name', text: 'Jane Testcase' })],
      [tool('click_element', { role: 'button', name: 'Save draft' })],
      [tool('finish', { title: 'Draft saved', fields: [{ label: 'Insured name', value: 'Jane Testcase' }], submitted: false })],
    ],
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  assert.equal(h.site.values.insured, 'Jane Testcase');
  assert.equal(h.site.draftSaved, 1);
  const first = JSON.stringify(h.seen[0].messages[0].content);
  assert.match(first, /page_outline/);
  assert.match(first, /Insured name/);
  assert.match(first, /site_guide|task_files|<task>/);
});

test('verification: a click that changes nothing is reported as not working', async () => {
  let said = '';
  const h = await setup({
    turns: [
      [computer('left_click', { coordinate: [40, 40] })],
      (req) => {
        said = text(lastResults(req)[0]);
        return [tool('finish', { title: 'Stopped', fields: [], submitted: false })];
      },
    ],
  });
  await h.run();
  assert.match(said, /did not change anything on the page/);
});

test('upload: attach_file is blocked without approval, then attaches after the person approves', async () => {
  let blocked = '';
  let attached = '';
  const h = await setup({
    files: true,
    person: approveAll,
    turns: [
      (req) => {
        assert.match(JSON.stringify(req.messages[0].content), /task_files[\s\S]*roof-photo\.jpg/);
        assert.ok(!JSON.stringify(req.messages[0].content).includes('jpeg-bytes'), 'file bytes never reach the model');
        return [tool('attach_file', { file_id: 'f1', name: 'Attach photos' })];
      },
      (req) => {
        blocked = text(lastResults(req)[0]);
        return [tool('request_approval', { button_label: 'Attach photos', summary: 'Attach roof-photo.jpg to the claim.', fields: [{ label: 'File', value: 'roof-photo.jpg', source: 'user message' }] })];
      },
      [tool('attach_file', { file_id: 'f1', name: 'Attach photos' })],
      (req) => {
        attached = text(lastResults(req)[0]);
        return [tool('finish', { title: 'Photo attached', fields: [{ label: 'File', value: 'roof-photo.jpg' }], submitted: false })];
      },
    ],
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  assert.match(blocked, /needs the person's approval/);
  assert.match(attached, /Attached roof-photo\.jpg/);
  assert.deepEqual(h.site.attached, ['roof-photo.jpg']);
  const ev = h.store.audit.find((e) => e.event === 'action' && e.detail.action === 'attach_file');
  assert.equal(ev?.detail.file, 'roof-photo.jpg');
  assert.ok(!JSON.stringify(h.store.audit).includes('jpeg-bytes'));
});

test('download: check_downloads lists what the browser downloaded', async () => {
  let listed = '';
  const site = new MockSite();
  site.downloaded.push({ name: 'estimate.pdf', bytes: 20480, at: 1 });
  const h = await setup({
    site,
    turns: [
      [tool('check_downloads')],
      (req) => {
        listed = text(lastResults(req)[0]);
        return [tool('finish', { title: 'Downloaded', fields: [{ label: 'File', value: 'estimate.pdf' }], submitted: false })];
      },
    ],
  });
  await h.run();
  assert.match(listed, /estimate\.pdf \(20 KB\)/);
});

test('stuck: report_stuck hands off with a screenshot and a specific message', async () => {
  let seenNeedsYou: unknown = null;
  const h = await setup({
    person: async (store) => {
      const t = [...store.tasks.values()][0];
      if (t?.needs_you && !seenNeedsYou) {
        seenNeedsYou = t.needs_you;
        await store.updateTask(t.id, { cancel_requested_at: new Date().toISOString() });
      }
    },
    turns: [[tool('report_stuck', { where: 'the claim form', need: 'which field holds the policy number' })]],
  });
  await h.run();
  const ny = seenNeedsYou as { reason: string; message: string; screenshot_jpeg_b64?: string } | null;
  assert.equal(ny?.reason, 'stuck');
  assert.match(ny?.message ?? '', /Stuck at the claim form/);
  assert.match(ny?.message ?? '', /which field holds the policy number/);
  assert.ok((ny?.screenshot_jpeg_b64 ?? '').length > 0);
});

/* ------------------------------------------------------- practice runs -- */

function practiceDeps(store: MemoryComputerStore, iq: MemoryIqStore, provider: MockComputerProvider, model: ComputerModel): ComputerWorkerDeps {
  return {
    store,
    provider,
    model,
    meteringClient: metering,
    iq,
    isPaused: async () => false,
    sleep: async () => undefined,
    now: () => Date.now(),
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000 },
    verifyModel: null,
  };
}

const MOCK_TASK: PracticeTask = {
  key: 'mock.fill_form',
  site: 'example-carrier.test',
  catalogId: 'practice_forms',
  loginHost: null,
  label: 'Mock: fill a form, stop before Submit',
  taskType: 'fill_form',
  mode: 'stop_before_submit',
  startUrl: 'https://portal.example-carrier.test/claims/new',
  params: { insured: 'Pat Practice' },
  instructions: 'Type "Pat Practice" in Insured name, then ask for approval to click Submit claim.',
  maxSteps: 10,
};

test('practice: needs login is recorded without opening a browser', async () => {
  const store = new MemoryComputerStore();
  const iq = new MemoryIqStore();
  const provider = new MockComputerProvider();
  const { model } = scripted([]);
  const row = await runPracticeTask({ ...MOCK_TASK, key: 'mock.login', loginHost: 'app.jobnimbus.com' }, { orgId: ORG, deps: practiceDeps(store, iq, provider, model), iq });
  assert.equal(row?.status, 'needs_login');
  assert.match(row?.failure_reason ?? '', /No saved Login for app\.jobnimbus\.com/);
  assert.equal(provider.sessions.length, 0);
});

test('practice: stops before Submit, saves a playbook, and the next run replays it with no model calls', async () => {
  const store = new MemoryComputerStore();
  const iq = new MemoryIqStore();
  const site = new MockSite();
  const provider = new MockComputerProvider({ site });
  const { model, seen } = scripted([
    [tool('type_into', { role: 'textbox', name: 'Insured name', text: 'Pat Practice' })],
    [tool('request_approval', { button_label: 'Submit claim', summary: 'Submit the claim.', fields: [{ label: 'Insured name', value: 'Pat Practice', source: 'user message' }] })],
  ]);
  const deps = practiceDeps(store, iq, provider, model);
  const first = await runPracticeTask(MOCK_TASK, { orgId: ORG, runDate: '2026-10-06', deps, iq });
  assert.equal(first?.status, 'succeeded', first?.failure_reason ?? '');
  assert.equal(site.submitted, false, 'practice never submits');
  assert.ok((first?.model_calls ?? 0) >= 1);
  const pb = await iq.loadPlaybook('example-carrier.test', 'fill_form');
  assert.ok(pb, 'playbook captured from the verified success');
  assert.ok(!JSON.stringify(pb!.steps).includes('Pat Practice'), 'typed values are slots, not stored');
  assert.ok(pb!.steps.some((s) => s.kind === 'type' && s.slot === 'task.insured'));
  assert.ok(pb!.steps.some((s) => s.kind === 'click' && s.consequential === 'submit'));

  provider.site = new MockSite();
  const callsBefore = seen.length;
  const second = await runPracticeTask(MOCK_TASK, { orgId: ORG, runDate: '2026-10-07', deps, iq });
  assert.equal(second?.status, 'succeeded', second?.failure_reason ?? '');
  assert.equal(second?.used_playbook, true);
  assert.equal(second?.model_calls, 0);
  assert.equal(seen.length, callsBefore, 'replay needed no model');
  assert.equal(provider.site.values.insured, 'Pat Practice');
  assert.equal(provider.site.submitted, false);
});
