/**
 * Computer (Chat's browser agent) end to end on the mock provider: a
 * scripted model clicks and types on a fake claim form while the real gate,
 * store contract, worker and metering run. A "person" callback stands in
 * for the human answering approval and Needs-you cards.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentBlock, ComputerModel, ComputerModelRequest, ComputerModelResponse } from '../src/computer/agent.js';
import { computerSettings } from '../src/computer/config.js';
import { MockComputerProvider, MockSite } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { buildSupplyCart, checkFulfillment } from '../src/computer/supplyOrder.js';
import { cancelTask, decideApproval, resumeTask, startComputerTask, mintLiveView, loadTaskView } from '../src/computer/service.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { runComputerTask, setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import { COMPUTER_SYSTEM_PROMPT } from '../src/computer/prompt.js';
import type { JobFileAskContext } from '../src/shared/jobFileAsk.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const OTHER_ORG = '0b000000-0000-4000-8000-000000000002';
const USER = '0c000000-0000-4000-8000-000000000003';
const JOB = '0d000000-0000-4000-8000-000000000004';

const FILE: JobFileAskContext = {
  job: { title: 'TEST Hail roof', claimNumber: 'CLM-TEST-001', policyNumber: 'POL-TEST-9' },
  facts: { 'Insured name': 'Jane Testcase', 'Lockbox code': '4321' },
  messages: [{ author: 'Office', body: 'TEST private note: gate code 9999' }],
};

// Coordinates on the mock claim form (see providers/mock.ts).
const AT = {
  insured: [350, 200],
  claim: [350, 260],
  address: [350, 320],
  terms: [310, 530],
  draft: [350, 600],
  submit: [600, 600],
  code: [350, 240],
} as const;

let seq = 0;
const computer = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({
  type: 'tool_use',
  id: `tu_${(seq += 1)}`,
  name,
  toolset_name: 'computer',
  input,
});
const tool = (name: string, input: Record<string, unknown>): ContentBlock => ({ type: 'tool_use', id: `tu_${(seq += 1)}`, name, input });

/** A model that plays a fixed script, one turn per call, and records what it saw. */
function scripted(turns: Array<ContentBlock[] | ((req: ComputerModelRequest) => ContentBlock[] | Promise<ContentBlock[]>)>) {
  const seen: ComputerModelRequest[] = [];
  const model: ComputerModel = {
    async create(req): Promise<ComputerModelResponse> {
      seen.push(JSON.parse(JSON.stringify(req)));
      const turn = turns[seen.length - 1];
      const content = turn ? (typeof turn === 'function' ? await turn(req) : turn) : [tool('finish', { summary: 'Out of script.' })];
      return { model: 'claude-sonnet-5-5', content, usage: { input_tokens: 1000, output_tokens: 100 } };
    },
  };
  return { model, seen };
}

function lastToolResults(req: ComputerModelRequest): ContentBlock[] {
  const last = req.messages[req.messages.length - 1];
  return last.content.filter((b) => b.type === 'tool_result');
}

function resultText(block: ContentBlock): string {
  if (typeof block.content === 'string') return block.content;
  return (block.content as ContentBlock[]).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
}

interface Harness {
  store: MemoryComputerStore;
  site: MockSite;
  provider: MockComputerProvider;
  rpc: Array<{ name: string; params: Record<string, unknown> }>;
  taskId: string;
}

async function setup(opts: {
  turns: Parameters<typeof scripted>[0];
  site?: MockSite;
  person?: (h: Harness) => Promise<void>;
  paused?: boolean;
  settings?: Partial<ReturnType<typeof computerSettings>>;
  instructions?: string;
}) {
  const store = new MemoryComputerStore();
  const site = opts.site ?? new MockSite();
  const provider = new MockComputerProvider({ site });
  const rpc: Harness['rpc'] = [];
  const meteringClient = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpc.push({ name, params });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const { model, seen } = scripted(opts.turns);
  const h = { store, site, provider, rpc, taskId: '' } as Harness;
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    model,
    meteringClient,
    isPaused: async () => Boolean(opts.paused),
    sleep: async () => {
      await opts.person?.(h);
    },
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000, ...opts.settings },
  });
  const task = await startComputerTask({
    orgId: ORG,
    userId: USER,
    jobId: JOB,
    instructions: opts.instructions ?? 'Fill out the new claim form on portal.example-carrier.test for this job.',
    file: FILE,
    address: '1 Test Lane, Testville',
  });
  h.taskId = task.id;
  return { ...h, seen, run: () => runComputerTask(task.id) };
}

afterEach(() => {
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

test('only the allowlisted job projection reaches the agent', async () => {
  const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
  await h.run();
  const first = h.seen[0].messages[0].content.find((b) => b.type === 'text')!.text as string;
  assert.match(first, /CLM-TEST-001/);
  assert.match(first, /Jane Testcase/);
  assert.match(first, /1 Test Lane/);
  assert.doesNotMatch(first, /4321/, 'lockbox code never goes to the agent');
  assert.doesNotMatch(first, /9999|private note/, 'notes never go to the agent');
  assert.match(h.seen[0].system[0].text, /untrusted/i);
  // Model routing: the first (planning) step goes to the strong model; routine steps go to the fast one.
  assert.equal(h.seen[0].model, 'claude-opus-5-5');
  assert.ok((h.seen[0].tools as Array<{ type?: string }>).some((t) => t.type === 'computer_toolset_20260801'));
});

test('fills the form without submitting', async () => {
  const h = await setup({
    turns: [
      [computer('left_click', { coordinate: AT.insured }), computer('type', { text: 'Jane Testcase' })],
      [computer('left_click', { coordinate: AT.claim }), computer('type', { text: 'CLM-TEST-001' })],
      [computer('left_click', { coordinate: AT.draft })],
      [tool('finish', { summary: 'Filled insured and claim; saved a draft; did not submit.', submitted: false })],
    ],
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  assert.equal(h.site.values.insured, 'Jane Testcase');
  assert.equal(h.site.values.claim, 'CLM-TEST-001');
  assert.equal(h.site.draftSaved, 1, '"Save draft" is not a consequential click');
  assert.equal(h.site.submitted, false);
  assert.equal(h.store.approvals.size, 0);
  const task = await h.store.getTask(ORG, h.taskId);
  assert.equal(task?.status, 'succeeded');
  assert.match(task?.result_summary ?? '', /did not submit/);
  const typed = h.store.audit.filter((e) => e.event === 'action' && e.detail.action === 'type');
  assert.equal(typed.length, 2);
  assert.ok(typed.every((e) => !JSON.stringify(e.detail).includes('Jane')), 'typed values are never written to the audit');
  assert.equal(h.provider.ended.length, 1, 'browser session released');
});

test('finish reports a structured result: fields, submitted, one plain note', async () => {
  const h = await setup({
    turns: [
      [computer('left_click', { coordinate: AT.insured }), computer('type', { text: 'Jane Testcase' })],
      [
        tool('finish', {
          title: 'Form filled.',
          fields: [
            { label: 'Insured name', value: 'Jane Testcase' },
            { label: '', value: 'dropped: no label' },
          ],
          submitted: true,
          notes: 'No customer details on this job, so test values were used.',
        }),
      ],
    ],
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  const task = await h.store.getTask(ORG, h.taskId);
  assert.ok(task?.result_summary?.startsWith('{"v":1'), 'stored as versioned JSON in result_summary');
  const view = await loadTaskView(ORG, h.taskId, USER);
  assert.deepEqual(view.result, {
    title: 'Form filled',
    fields: [{ label: 'Insured name', value: 'Jane Testcase' }],
    notes: 'No customer details on this job, so test values were used.',
  });
  assert.equal(view.resultSummary, 'No customer details on this job, so test values were used.');
  assert.equal(view.submitted, false, 'the model saying "submitted" is not enough: no approved click went through');
});


test('a submit click is blocked without an approval (and so is Enter)', async () => {
  let blockedText = '';
  let enterText = '';
  const h = await setup({
    turns: [
      [computer('left_click', { coordinate: AT.insured }), computer('type', { text: 'Jane Testcase' })],
      [computer('left_click', { coordinate: AT.submit })],
      (req) => {
        blockedText = resultText(lastToolResults(req)[0]);
        return [computer('left_click', { coordinate: AT.claim }), computer('key', { text: 'Return' })];
      },
      (req) => {
        enterText = resultText(lastToolResults(req)[1]);
        return [computer('type', { text: 'CLM-TEST-001\n' })];
      },
      [tool('finish', { summary: 'Stopped before submitting.' })],
    ],
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  assert.equal(h.site.submitted, false, 'the form was never submitted');
  assert.match(blockedText, /Blocked: this submit action \("Submit claim"\) needs the person's approval/);
  assert.match(enterText, /Blocked/);
  assert.equal(h.site.values.claim, undefined, 'a typed newline (Enter) is blocked before typing');
  const blocked = h.store.audit.filter((e) => e.event === 'blocked');
  assert.equal(blocked.length, 3);
  assert.ok(blocked.every((e) => e.detail.why === 'needs_approval'));
});

test('an approval lets exactly one submit through', async () => {
  let approvedText = '';
  const h = await setup({
    turns: [
      [
        computer('left_click', { coordinate: AT.insured }),
        computer('type', { text: 'Jane Testcase' }),
        computer('left_click', { coordinate: AT.claim }),
        computer('type', { text: 'CLM-TEST-001' }),
        computer('left_click', { coordinate: AT.address }),
        computer('type', { text: '99 Made Up Rd' }),
      ],
      [
        tool('request_approval', {
          button_label: 'Submit claim',
          summary: 'Submit the new claim to the carrier.',
          fields: [
            { label: 'Insured name', value: 'Jane Testcase', source: 'fact.insured_name' },
            { label: 'Claim number', value: 'CLM-TEST-001', source: 'job.claimNumber' },
            { label: 'Property address', value: '99 Made Up Rd', source: 'job.address' },
          ],
        }),
      ],
      (req) => {
        approvedText = resultText(lastToolResults(req)[0]);
        return [computer('left_click', { coordinate: AT.submit })];
      },
      [tool('finish', { summary: 'Submitted the claim.', submitted: true })],
    ],
    person: async (hh) => {
      const pending = [...hh.store.approvals.values()].find((a) => a.status === 'pending');
      if (pending) await decideApproval(ORG, pending.id, USER, 'approve');
    },
  });
  const out = await h.run();
  assert.equal(out?.status, 'succeeded');
  assert.match(approvedText, /Approved/);
  assert.equal(h.site.submitted, true);
  const [approval] = [...h.store.approvals.values()];
  assert.equal(approval.status, 'consumed', 'single use');
  assert.ok(approval.token_hash && approval.token_hash.length === 64, 'only a sha256 of the token is stored');
  assert.ok(approval.screenshot_jpeg_b64, 'approval card has a screenshot');
  const bySource = Object.fromEntries(approval.fields.map((f) => [f.label, f]));
  assert.equal(bySource['Insured name'].source, 'Job brief: Insured name');
  assert.equal(bySource['Insured name'].verified, true);
  assert.equal(bySource['Claim number'].source, 'Job: Claim number');
  assert.equal(bySource['Property address'].verified, false, 'a value not from the job or the message is flagged');
  assert.ok(h.store.audit.some((e) => e.event === 'approval_used'));
  const view = await loadTaskView(ORG, h.taskId, USER);
  assert.equal(view.submitted, true, 'an approved click went through');
  assert.equal(view.resultSummary, 'Submitted the claim.', 'an old-style summary still reads as the note');
  assert.equal(view.result?.fields.length, 3, 'no fields from finish: the approval fields are shown');
});

test('an approval covers one click only, and only the approved button', async () => {
  let wrongButton = '';
  const site = new MockSite();
  const h = await setup({
    site,
    turns: [
      [tool('request_approval', { button_label: 'Submit claim', summary: 'Submit.', fields: [] })],
      // Approved "Submit claim", but tries to tick "I agree to the terms" with it.
      [computer('left_click', { coordinate: AT.terms })],
      (req) => {
        wrongButton = resultText(lastToolResults(req)[0]);
        return [tool('finish', { summary: 'stopped' })];
      },
    ],
    person: async (hh) => {
      const pending = [...hh.store.approvals.values()].find((a) => a.status === 'pending');
      if (pending) await decideApproval(ORG, pending.id, USER, 'approve');
    },
  });
  await h.run();
  assert.match(wrongButton, /Blocked: this accept terms action/);
  assert.equal(h.site.checked.terms, undefined);
});

test('cancel on the approval card stops the task without submitting', async () => {
  const h = await setup({
    turns: [[tool('request_approval', { button_label: 'Submit claim', summary: 'Submit.', fields: [] })]],
    person: async (hh) => {
      const pending = [...hh.store.approvals.values()].find((a) => a.status === 'pending');
      if (pending) await decideApproval(ORG, pending.id, USER, 'cancel');
    },
  });
  const out = await h.run();
  assert.equal(out?.status, 'canceled');
  assert.equal(h.site.submitted, false);
});

test('2FA pauses with a Needs-you card; the code is never typed', async () => {
  const site = new MockSite({ start: 'two_factor' });
  let statusWhilePaused = '';
  let needsYou: unknown = null;
  const h = await setup({
    site,
    turns: [
      [computer('left_click', { coordinate: AT.code }), computer('type', { text: '123456' })],
      [tool('finish', { summary: 'Back on the form after you verified.' })],
    ],
    person: async (hh) => {
      const t = await hh.store.getTask(ORG, hh.taskId);
      if (t?.status === 'needs_you' && !t.resume_requested_at) {
        statusWhilePaused = t.status;
        needsYou = (await loadTaskView(ORG, hh.taskId, USER)).needsYou;
        hh.site.completeHumanStep(); // the person typed the code in the live view
        await resumeTask(ORG, hh.taskId, USER);
      }
    },
  });
  const out = await h.run();
  assert.equal(statusWhilePaused, 'needs_you');
  assert.equal((needsYou as { reason: string }).reason, 'two_factor');
  assert.equal(h.site.values.code, undefined, 'the agent never typed the one-time code');
  assert.equal(out?.status, 'succeeded');
  assert.ok(h.store.audit.some((e) => e.event === 'needs_you' && e.detail.reason === 'two_factor'));
  assert.ok(h.store.audit.some((e) => e.event === 'resumed'));
});

test('a captcha pauses before the model acts, and is never clicked', async () => {
  const site = new MockSite({ captcha: true });
  let pausedBeforeModel = false;
  const h = await setup({
    site,
    turns: [[tool('finish', { summary: 'done' })]],
    person: async (hh) => {
      const t = await hh.store.getTask(ORG, hh.taskId);
      if (t?.status === 'needs_you' && !t.resume_requested_at) {
        pausedBeforeModel = h0.seen.length === 0;
        assert.equal(t.needs_you?.reason, 'captcha');
        hh.site.completeHumanStep();
        await resumeTask(ORG, hh.taskId, USER);
      }
    },
  });
  const h0 = h;
  const out = await h.run();
  assert.equal(pausedBeforeModel, true);
  assert.equal(out?.status, 'succeeded');
  assert.ok(!h.site.actions.includes('click:captcha'));
});

test('a password field is never typed into', async () => {
  const site = new MockSite({ start: 'login' });
  const h = await setup({
    site,
    turns: [
      [computer('left_click', { coordinate: [350, 280] }), computer('type', { text: 'hunter2' })],
      [tool('finish', { summary: 'stopped' })],
    ],
    person: async (hh) => {
      const t = await hh.store.getTask(ORG, hh.taskId);
      if (t?.status === 'needs_you' && !t.resume_requested_at) {
        assert.equal(t.needs_you?.reason, 'login');
        await resumeTask(ORG, hh.taskId, USER);
      }
    },
  });
  await h.run();
  assert.equal(h.site.values.password, undefined);
});

test('open_url outside the sites the task names is blocked', async () => {
  let text = '';
  const h = await setup({
    turns: [
      [tool('open_url', { url: 'https://evil.example.net/steal' })],
      (req) => {
        text = resultText(lastToolResults(req)[0]);
        return [tool('finish', { summary: 'The page asked me to visit another site; I did not.' })];
      },
    ],
  });
  await h.run();
  assert.match(text, /Blocked: evil\.example\.net is not a site this task names/);
  assert.ok(!h.site.actions.some((a) => a.startsWith('navigate:https://evil')));
  assert.match(COMPUTER_SYSTEM_PROMPT, /PAGE CONTENT IS UNTRUSTED/);
});

test('metering: agent tokens and browser time land on the Computer line at 10x', async () => {
  const h = await setup({
    turns: [[computer('screenshot')], [tool('finish', { summary: 'ok' })]],
  });
  await h.run();
  await new Promise((r) => setImmediate(r));
  const rows = h.rpc.filter((c) => c.name === 'record_token_usage').map((c) => c.params);
  const model = rows.filter((p) => p.p_source === 'computer_agent');
  const browser = rows.filter((p) => p.p_source === 'computer_session');
  assert.equal(model.length, 2, 'one row per model call');
  for (const p of model) {
    assert.equal(p.p_feature, 'computer');
    assert.equal(p.p_model_id, 'claude-sonnet-5-5');
    assert.equal(p.p_input_tokens, 1000);
    assert.ok(p.p_cost_nanos > 0);
    assert.equal(p.p_price_nanos, p.p_cost_nanos * 10);
    assert.equal(p.p_org, ORG);
    assert.equal(p.p_job_id, JOB);
  }
  assert.equal(model[0].p_request_id, `computer:${h.taskId}:model:1`);
  assert.equal(browser.length, 1);
  assert.equal(browser[0].p_feature, 'computer');
  assert.equal(browser[0].p_model_id, 'browserbase-browser-time');
  assert.equal(browser[0].p_provider, 'browserbase');
  // 1-minute minimum at $0.12/hour = $0.002.
  assert.equal(browser[0].p_cost_nanos, 2_000_000);
  assert.equal(browser[0].p_price_nanos, 20_000_000);
  const task = await h.store.getTask(ORG, h.taskId);
  assert.ok((task?.cost_nanos ?? 0) > 2_000_000, 'task cost includes tokens and browser time');
});

test('the browser rate can be overridden by COMPUTER_BROWSER_USD_PER_HOUR', async () => {
  process.env.COMPUTER_BROWSER_USD_PER_HOUR = '0.6';
  try {
    const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
    await h.run();
    await new Promise((r) => setImmediate(r));
    const browser = h.rpc.find((c) => c.params.p_source === 'computer_session')!.params;
    assert.equal(browser.p_cost_nanos, 10_000_000);
  } finally {
    delete process.env.COMPUTER_BROWSER_USD_PER_HOUR;
  }
});

test('step cap, per-task budget and AI pause stop the loop', async () => {
  const shots = Array.from({ length: 5 }, () => [computer('screenshot')]);
  const capped = await setup({ turns: shots });
  await capped.store.updateTask(capped.taskId, { max_steps: 2 });
  const a = await capped.run();
  assert.equal(a?.status, 'failed');
  assert.match(a?.error ?? '', /Stopped after 2 steps/);
  assert.equal(capped.seen.length, 2);

  const broke = await setup({ turns: shots });
  await broke.store.updateTask(broke.taskId, { budget_nanos: 1 });
  const b = await broke.run();
  assert.equal(b?.status, 'failed');
  assert.match(b?.error ?? '', /spending cap/);
  assert.equal(broke.seen.length, 0);

  const paused = await setup({ turns: shots, paused: true });
  const c = await paused.run();
  assert.equal(c?.status, 'failed');
  assert.match(c?.error ?? '', /AI is paused/);
  assert.equal(paused.seen.length, 0);
});

test('waiting on a person times out', async () => {
  const h = await setup({
    turns: [[tool('needs_you', { reason: 'login', message: 'Please sign in.' })]],
    settings: { idleTimeoutMs: 5 },
    person: async () => {
      await new Promise((r) => setTimeout(r, 2));
    },
  });
  const out = await h.run();
  assert.equal(out?.status, 'failed');
  assert.match(out?.error ?? '', /idle timeout/);
});

test('cancel while waiting on a Needs-you card stops the task', async () => {
  const h = await setup({
    turns: [[tool('needs_you', { reason: 'other', message: 'Pick the right policy.' })]],
    person: async (hh) => {
      const t = await hh.store.getTask(ORG, hh.taskId);
      if (t?.status === 'needs_you' && !t.cancel_requested_at) await cancelTask(ORG, hh.taskId, USER);
    },
  });
  const out = await h.run();
  assert.equal(out?.status, 'canceled');
  assert.equal((await h.store.getTask(ORG, h.taskId))?.status, 'canceled');
  assert.equal(h.provider.ended.length, 1, 'the browser is released on cancel');
});

test('canceling a queued task means it never runs', async () => {
  const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
  await cancelTask(ORG, h.taskId, USER);
  const out = await h.run();
  assert.equal(out, null, 'a queued task canceled before it started never runs');
  assert.equal((await h.store.getTask(ORG, h.taskId))?.status, 'canceled');
});

test('one active task per org; the second waits in the queue', async () => {
  const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
  const second = await startComputerTask({ orgId: ORG, userId: USER, jobId: JOB, instructions: 'Another form on example.gov' });
  await h.store.transitionTask(h.taskId, ['queued'], { status: 'running' });
  const out = await runComputerTask(second.id);
  assert.equal(out, null);
  assert.equal((await h.store.getTask(ORG, second.id))?.status, 'queued');
});

test('another org cannot see, approve, resume or watch a task', async () => {
  const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
  const approval = await h.store.insertApproval({
    org_id: ORG,
    task_id: h.taskId,
    action_kind: 'submit',
    button_label: 'Submit',
    summary: 'x',
    page_url: null,
    page_origin: null,
    fields: [],
    screenshot_jpeg_b64: null,
    token_hash: 'x',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(loadTaskView(OTHER_ORG, h.taskId, USER), /not found/i);
  await assert.rejects(decideApproval(OTHER_ORG, approval.id, USER, 'approve'), /not found/i);
  await assert.rejects(resumeTask(OTHER_ORG, h.taskId, USER), /not found/i);
  await assert.rejects(cancelTask(OTHER_ORG, h.taskId, USER), /not found/i);
  await assert.rejects(mintLiveView(OTHER_ORG, h.taskId, USER, 'watch'), /not found/i);
  assert.equal((await h.store.getApproval(null, approval.id))?.status, 'pending');
});

test('live view: short-lived per-viewer links, never stored or audited; control pauses the agent', async () => {
  let link: { url: string; expiresAt: string } | null = null;
  let control: { url: string } | null = null;
  const h = await setup({
    turns: [
      async () => {
        link = await mintLiveView(ORG, h0.taskId, USER, 'watch');
        control = await mintLiveView(ORG, h0.taskId, USER, 'control');
        return [computer('screenshot')];
      },
      [tool('finish', { summary: 'ok' })],
    ],
    person: async (hh) => {
      const t = await hh.store.getTask(ORG, hh.taskId);
      if (t?.human_control_by) await hh.store.updateTask(hh.taskId, { human_control_by: null });
    },
  });
  const h0 = h;
  await h.run();
  assert.ok(link && control);
  const a = link as unknown as { url: string; expiresAt: string };
  const b = control as unknown as { url: string };
  assert.notEqual(a.url, b.url, 'each viewer gets a fresh link');
  assert.ok(Date.parse(a.expiresAt) - Date.now() <= 5 * 60_000 + 1000, 'expires within the TTL');
  assert.deepEqual(h.provider.liveLinks.map((l) => l.expiresInSec), [300, 300]);
  const dump = JSON.stringify([...h.store.audit, ...h.store.tasks.values(), ...h.store.sessions.values()]);
  assert.ok(!dump.includes('live.mock.invalid'), 'no live URL is stored or audited');
  assert.ok(h.store.audit.some((e) => e.event === 'took_control'));
  assert.ok(h.store.audit.some((e) => e.event === 'live_view_opened'));
});

test('supply cart Approve records exactly the checked lines on the approval and in the audit', async () => {
  const h = await setup({ turns: [[tool('finish', { summary: 'ok' })]] });
  const base = {
    materialSpec: null, unit: 'each', currency: 'USD' as const, alternatives: [], searchQuery: 'q',
    searchUrl: 'https://www.homedepot.com/s/q', notes: null,
  };
  const matches = [
    { ...base, materialId: 'a', materialItem: 'laminate countertop', quantity: 1, productName: 'FORMICA Laminate Sheet', sku: '202911152', url: 'https://www.homedepot.com/p/x/202911152', priceCents: 7344, confidence: 'medium' as const },
    { ...base, materialId: 'b', materialItem: 'birch plywood', quantity: null, unit: null, productName: 'Swaner Birch Plywood', sku: '305213039', url: 'https://www.homedepot.com/p/x/305213039', priceCents: 5158, confidence: 'medium' as const },
  ];
  const cart = buildSupplyCart({ vendor: 'home_depot', matches, fulfillment: checkFulfillment({ jobAddress: null, matches }) });
  const insert = () =>
    h.store.insertApproval({
      org_id: ORG, task_id: h.taskId, action_kind: 'pay', button_label: 'Place Order', summary: cart.summary,
      page_url: 'https://www.homedepot.com/checkout', page_origin: 'https://www.homedepot.com', fields: cart.approvalFields,
      screenshot_jpeg_b64: 'x', token_hash: 'x', expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

  const a1 = await insert();
  await assert.rejects(
    decideApproval(ORG, a1.id, USER, 'approve', { lines: [{ key: 'L2:305213039' }] }),
    /Enter a quantity/,
  );
  assert.equal((await h.store.getApproval(null, a1.id))?.status, 'pending', 'a bad selection approves nothing');

  await decideApproval(ORG, a1.id, USER, 'approve', { lines: [{ key: 'L2:305213039', quantity: 3 }] });
  const row = await h.store.getApproval(null, a1.id);
  assert.equal(row?.status, 'approved');
  assert.deepEqual(row?.approved_order?.lines.map((l) => [l.sku, l.quantity, l.quantitySource, l.lineTotalCents]), [
    ['305213039', 3, 'person', 15474],
  ]);
  assert.deepEqual(row?.approved_order?.excluded.map((e) => e.sku), ['202911152']);
  type ApprovedAudit = {
    approvalId?: string;
    orderFingerprint?: string;
    approvedLines: Array<{ sku: string }>;
    excludedLines: Array<{ sku: string }>;
  };
  const audit = h.store.audit.find((e) => {
    const d = e.detail as Partial<ApprovedAudit>;
    return e.event === 'approved' && d.approvalId === undefined && Boolean(d.orderFingerprint);
  });
  assert.ok(audit, 'audit has the approved order');
  const detail = audit!.detail as ApprovedAudit;
  assert.equal(detail.orderFingerprint, row?.approved_order?.fingerprint);
  assert.deepEqual(detail.approvedLines.map((l) => l.sku), ['305213039']);
  assert.deepEqual(detail.excludedLines.map((l) => l.sku), ['202911152']);
});
