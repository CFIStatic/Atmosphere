/**
 * Job Chat routes outside-site commands to Computer (Oct 13 2026 bug: "can you
 * login to restore365 and tell me what current jobs are running" came back as
 * an evidence "Not found. I searched 4 clips…").
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockComputerProvider } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import { looksLikeComputerTask, pickAskToolsHeuristically, parseActionsTrailer, type AskToolContext } from '../src/shared/askTools.js';
import {
  catalogSiteInQuestion,
  looksLikeOutsideSiteCommand,
  matchSavedLogin,
  parseComputerCommand,
} from '../src/shared/askComputerCommand.js';
import { looksLikeComputerCapabilityAsk, computerCapabilityAnswer } from '../src/shared/askComputerCapability.js';
import { applyHonestNotFound } from '../src/shared/askNotFound.js';
import { answerFromAskLookup, geminiLookupTools } from '../src/shared/askReasoning.js';
import { answerFromJobFile } from '../src/shared/jobFileAsk.js';
import { formatComputerResultsForPrompt } from '../src/shared/askComputerContext.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';
import type { ComputerLoginRow } from '../src/computer/store.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const USER = '0c000000-0000-4000-8000-000000000003';
const EXACT = 'can you login to restore365 and tell me what current jobs are running';

const VARIANTS = [
  EXACT,
  'Can you log in to Restore 365 and tell me what current jobs are running?',
  'log into restore 365 and list the active jobs',
  'go into Restore365 and check the jobs',
  'check my restore 365 account',
  'sign in to DASH by Next Gear and pull up current jobs',
  'login to xactimate and list my jobs',
  'go into xactimate and tell me what estimates are open',
  'check my jobnimbus for this job',
  'open outlook and check the latest email',
];

const NOT_COMMANDS = [
  'what did the homeowner say about the tarp',
  'when was the drywall delivered',
  'summarize this job',
  'what about the second one?',
  'is the dashboard working',
  'who is on this job',
];

afterEach(() => {
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

function login(partial: Partial<ComputerLoginRow> & Pick<ComputerLoginRow, 'label' | 'host' | 'url'>): ComputerLoginRow {
  const at = new Date().toISOString();
  return {
    id: `login-${partial.host}`,
    org_id: ORG,
    cookie_domains: [],
    created_by: USER,
    created_at: at,
    last_signed_in_at: null,
    last_signed_in_by: null,
    updated_at: at,
    ...partial,
  };
}

test('the exact phrase and variants are Computer commands, not capability questions', () => {
  for (const q of VARIANTS) {
    assert.equal(looksLikeComputerTask(q), true, q);
    assert.deepEqual(pickAskToolsHeuristically(q, 'org'), ['start_computer_task'], q);
    assert.equal(looksLikeComputerCapabilityAsk(q), false, q);
  }
  // Viewers never get a browser.
  assert.ok(!pickAskToolsHeuristically(EXACT, 'viewer').includes('start_computer_task'));
  // "What websites can you log in to?" is still a capability question.
  assert.equal(looksLikeComputerCapabilityAsk('what websites can you log in to?'), true);
});

test('job questions and follow-ups stay off Computer', () => {
  for (const q of NOT_COMMANDS) assert.equal(looksLikeComputerTask(q), false, q);
});

test('catalog site names (Restore 365 is DASH) resolve to the saved login', () => {
  assert.equal(catalogSiteInQuestion(EXACT)?.host, 'dash-ngs.net');
  assert.equal(catalogSiteInQuestion('log in to restore 365')?.host, 'dash-ngs.net');
  assert.equal(catalogSiteInQuestion('the dashboard is broken'), null);
  const logins = [
    login({ label: 'Gmail', host: 'mail.google.com', url: 'https://mail.google.com' }),
    login({ label: 'DASH', host: 'dash-ngs.net', url: 'https://dash-ngs.net/NextGear/Enterprise/Module/User/Login.aspx' }),
  ];
  const matched = matchSavedLogin(logins, parseComputerCommand(EXACT));
  assert.equal(matched?.login.host, 'dash-ngs.net');
});

test('a saved login label the catalog does not know still routes to Computer', () => {
  const saved = [{ label: 'Jettx Ops Portal', host: 'ops.jettx-internal.test' }];
  assert.equal(looksLikeOutsideSiteCommand('go into the jettx ops portal and tell me what is scheduled', saved), true);
  assert.equal(looksLikeOutsideSiteCommand('check jettx-internal and list open tickets', saved), true);
  assert.equal(looksLikeOutsideSiteCommand('what did the homeowner say about the tarp', saved), false);
});

test('Computer and capability replies are never rewritten into evidence Not found', () => {
  const cat: AskLookupCatalog = {
    orgId: ORG,
    jobId: JOB,
    access: 'org',
    clips: [{ proofId: 'p1', jobId: JOB, orgId: ORG, title: 'Handheld Video of an Indoor Office Desk' }],
    history: [],
    people: [],
  };
  const capability = computerCapabilityAnswer({ access: 'org', configured: true });
  assert.equal(applyHonestNotFound(capability, cat, 'what websites can you log in to?', { noGroundedClaim: true }), capability);
  const card = "Opening DASH now, and I'll check with you before anything is submitted.\n\n⟦actions: start_computer_task|Started|computer|computer-task:abc⟧";
  assert.equal(applyHonestNotFound(card, cat, EXACT, { noGroundedClaim: true }), card);
  assert.equal(applyHonestNotFound('No idea.', cat, EXACT, { noGroundedClaim: true, nonEvidence: true }), 'No idea.');
  // A real evidence miss still gets the honest Not found.
  assert.match(applyHonestNotFound("I can't find that in the file.", cat, 'what color is the dumpster', { noGroundedClaim: true }), /^Not found\./);
});

test('the model is offered start_computer_task and can hand the turn to Computer', async () => {
  const decls = geminiLookupTools(true, true)[0]!.functionDeclarations.map((d: { name: string }) => d.name);
  assert.ok(decls.includes('start_computer_task'));
  assert.ok(!geminiLookupTools(true, false)[0]!.functionDeclarations.some((d: { name: string }) => d.name === 'start_computer_task'));
  let started: string | null = null;
  const result = await answerFromAskLookup({
    question: 'hop on the claims site we use and see what is due today',
    catalog: { orgId: ORG, jobId: JOB, access: 'org', clips: [], history: [], people: [] },
    step: async () => ({
      model: 'claude-test',
      text: '',
      calls: [{ name: 'start_computer_task', input: { instructions: 'Open the claims site and list what is due today' } }],
    }),
    computer: {
      start: async ({ instructions }) => {
        started = instructions;
        return 'Opening a browser now.\n\n⟦actions: start_computer_task|Started|computer|computer-task:t1⟧';
      },
    },
  });
  assert.equal(result.computerStarted, true);
  assert.equal(started, 'Open the claims site and list what is due today');
  assert.match(result.answer, /computer-task:t1/);
  assert.doesNotMatch(result.answer, /Not found/);
});

test('multi-turn job thread: a job question, the Restore 365 command, then a follow-up on the results', async () => {
  const prev = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GEMINI_API_KEY, o: process.env.GOOGLE_API_KEY };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const store = new MemoryComputerStore();
    setComputerProviderForTests(new MockComputerProvider());
    setComputerWorkerDepsForTests({ store, admin: null });
    await store.saveLogin({
      org_id: ORG,
      label: 'DASH (Restore 365)',
      url: 'https://dash-ngs.net/NextGear/Enterprise/Module/User/Login.aspx',
      host: 'dash-ngs.net',
      cookie_domains: [],
      user_id: USER,
      at: new Date().toISOString(),
    });
    const file = {
      job: { id: JOB, title: 'Project Tiffany & Co.', claimNumber: 'CLM-12' },
      facts: { Homeowner: 'Pat Test' },
    };
    const ctx = (): AskToolContext => ({
      orgId: ORG,
      jobId: JOB,
      supabase: {} as unknown as SupabaseClient,
      access: 'org',
      userId: USER,
      file,
      address: '2 Test St',
      computerResults: [],
    });

    // Turn 1: a question about this job is answered from the job file.
    const t1 = await answerFromJobFile({ question: 'what is the claim number', file, toolContext: ctx() });
    assert.match(t1.answer, /CLM-12/);
    assert.equal(store.tasks.size, 0);

    // Turn 2: the exact command starts Computer with the saved DASH login.
    const statuses: string[] = [];
    const t2 = await answerFromJobFile({
      question: EXACT,
      file,
      toolContext: ctx(),
      history: [
        { role: 'user', text: 'what is the claim number' },
        { role: 'assistant', text: t1.answer },
      ],
      onStatus: (s) => statuses.push(s),
    });
    assert.doesNotMatch(t2.answer, /Not found|I searched/);
    const [task] = [...store.tasks.values()];
    assert.ok(task, 'a Computer task was queued');
    assert.equal(task!.start_url, 'https://dash-ngs.net/NextGear/Enterprise/Module/User/Login.aspx');
    assert.equal(task!.job_id, JOB);
    const [action] = parseActionsTrailer(t2.answer);
    assert.equal(action?.tool, 'start_computer_task');
    assert.equal(action?.path, `computer-task:${task!.id}`);
    assert.ok(statuses.includes('Starting Computer…'));

    // Turn 3: the follow-up sees the earlier turns and the Computer result.
    const results = [
      {
        id: task!.id,
        instructions: task!.instructions,
        status: 'succeeded',
        result: 'Current jobs in DASH: 1. Smith Residence – water mitigation (drying). 2. Lopez Kitchen – mold remediation (demo). 3. Oak St Duplex – reconstruction.',
        error: null,
        at: '2026-10-13T14:20:00Z',
      },
    ];
    const block = formatComputerResultsForPrompt(results);
    assert.match(block, /Lopez Kitchen/);
    let promptSeen = '';
    const t3 = await answerFromAskLookup({
      question: 'what about the second one?',
      catalog: { orgId: ORG, jobId: JOB, access: 'org', clips: [], history: [], people: [] },
      history: [
        { role: 'user', text: EXACT },
        { role: 'assistant', text: t2.answer },
      ],
      extra: block,
      repair: async () => null,
      step: async ({ user, stable }) => {
        promptSeen = `${stable ?? ''}\n${user}`;
        return { model: 'claude-test', text: 'The second job is Lopez Kitchen, a mold remediation job that is in demo.', calls: [] };
      },
      computer: { start: async () => 'should not start' },
    });
    assert.match(promptSeen, /COMPUTER RESULTS ON THIS JOB/);
    assert.match(promptSeen, /restore365/i);
    assert.equal(t3.computerStarted, undefined);
    assert.match(t3.answer, /Lopez Kitchen/);
    assert.doesNotMatch(t3.answer, /^Not found/);
    assert.equal(store.tasks.size, 1, 'the follow-up does not start a second browser');
  } finally {
    for (const [k, v] of [['ANTHROPIC_API_KEY', prev.a], ['GEMINI_API_KEY', prev.g], ['GOOGLE_API_KEY', prev.o]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('any website: no saved login -> Chat finds the site (web search) and asks for the login in-thread', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  const searched: string[] = [];
  const ctx: AskToolContext = {
    orgId: ORG,
    jobId: JOB,
    supabase: {} as unknown as SupabaseClient,
    access: 'org',
    userId: USER,
    file: { job: { id: JOB, title: 'Project Tiffany & Co.' } },
    computerResults: [],
    webSearch: async (query) => {
      searched.push(query);
      return {
        answer: '',
        hits: [
          { url: 'https://www.yelp.com/biz/acme-claims-hub', title: 'Acme Claims Hub - Yelp', snippet: '' },
          { url: 'https://portal.acmeclaimshub.test/login', title: 'Acme Claims Hub | Sign in', snippet: '' },
        ],
      } as never;
    },
  };
  const q = 'can you log in to acme claims hub and tell me what claims are open';
  assert.equal(looksLikeComputerTask(q), true);
  const turn = await answerFromJobFile({ question: q, file: ctx.file, toolContext: ctx });
  assert.deepEqual(searched, ['acme claims hub login']);
  assert.match(turn.answer, /I searched the web and found Acme Claims Hub at portal\.acmeclaimshub\.test/);
  assert.match(turn.answer, /saved securely to your Logins/);
  assert.doesNotMatch(turn.answer, /Not found|password:/i);
  const [action] = parseActionsTrailer(turn.answer);
  assert.match(action?.path ?? '', /^computer-task:add-login:/);
  const payload = JSON.parse(Buffer.from(action!.path!.slice('computer-task:add-login:'.length), 'base64url').toString('utf8'));
  assert.equal(payload.u, 'https://portal.acmeclaimshub.test/login');
  assert.equal(payload.q, q);
  assert.equal(store.tasks.size, 0, 'no browser opens without a login');

  // The person adds the login from the card; the same request now runs on Computer with it.
  await store.saveLogin({
    org_id: ORG,
    label: payload.n,
    url: payload.u,
    host: payload.h,
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const again = await answerFromJobFile({ question: payload.q, file: ctx.file, toolContext: { ...ctx, savedLogins: undefined } });
  const [task] = [...store.tasks.values()];
  assert.ok(task, 'Computer continues the original command');
  assert.equal(task!.start_url, 'https://portal.acmeclaimshub.test/login');
  assert.match(again.answer, new RegExp(`computer-task:${task!.id}`));
});

test('catalog site with no saved login asks for it without a web search', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  let searchedWeb = false;
  const ctx: AskToolContext = {
    orgId: ORG,
    jobId: JOB,
    supabase: {} as unknown as SupabaseClient,
    access: 'org',
    userId: USER,
    file: { job: { id: JOB } },
    computerResults: [],
    webSearch: async () => {
      searchedWeb = true;
      return { hits: [], answer: '' } as never;
    },
  };
  const turn = await answerFromJobFile({ question: EXACT, file: ctx.file, toolContext: ctx });
  assert.equal(searchedWeb, false);
  assert.match(turn.answer, /I found DASH by Next Gear Solutions \(dash-ngs\.net\)/);
  assert.match(turn.answer, /computer-task:add-login:/);
  assert.equal(store.tasks.size, 0);
});

test('Chat knows what a waiting Computer task needs, including the authenticator number', () => {
  const block = formatComputerResultsForPrompt([
    {
      id: 't1',
      instructions: 'Task: Log in to Outlook and email the update',
      status: 'needs_you',
      result: null,
      error: null,
      at: '2026-10-13T16:41:00Z',
      waiting: { reason: 'number_match', message: 'Enter 47 in your authenticator app.', code: '47' },
    },
  ]);
  assert.match(block, /Status: needs_you/);
  assert.match(block, /Waiting on the person \(number_match\)/);
  assert.match(block, /Authenticator number on the sign-in page: 47/);
});
