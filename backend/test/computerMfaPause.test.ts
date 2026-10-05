/**
 * MFA pauses: number-matching and OTP messages for Chat. Never invent a code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mfaPauseFromSignals } from '../src/computer/mfaPause.js';
import type { PageSignals } from '../src/computer/types.js';
import { resumeTask, startComputerTask, loadTaskView } from '../src/computer/service.js';
import { MockComputerProvider, MockSite } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { runComputerTask, setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import { computerSettings } from '../src/computer/config.js';
import type { ContentBlock, ComputerModel, ComputerModelResponse } from '../src/computer/agent.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach } from 'node:test';

const blank = (over: Partial<PageSignals> = {}): PageSignals => ({
  url: 'https://example.test',
  hasPasswordField: false,
  hasOneTimeCodeField: false,
  hasCaptcha: false,
  mentionsVerificationCode: false,
  approvalNumber: null,
  visibleOtpCode: null,
  ...over,
});

test('mfaPauseFromSignals: approve number, visible code, or phone-only', () => {
  assert.deepEqual(mfaPauseFromSignals(blank({ approvalNumber: '47' })), {
    reason: 'number_match',
    message: 'Approve 47 on your phone, then press Resume.',
  });
  assert.deepEqual(mfaPauseFromSignals(blank({ visibleOtpCode: '482913' })), {
    reason: 'two_factor',
    message: 'The code on this page is 482913. Enter it where the site asks, then press Resume.',
  });
  const phone = mfaPauseFromSignals(blank({ hasOneTimeCodeField: true }));
  assert.equal(phone?.reason, 'two_factor');
  assert.match(phone!.message, /sent to your phone or email/);
  assert.equal(mfaPauseFromSignals(blank()), null);
});

const ORG = '0a000000-0000-4000-8000-0000000000e1';
const USER = '0c000000-0000-4000-8000-0000000000e2';
const JOB = '0d000000-0000-4000-8000-0000000000e3';

let seq = 0;
const tool = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({
  type: 'tool_use',
  id: `tu_${(seq += 1)}`,
  name,
  input,
});

afterEach(() => {
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

test('number-matching page pauses with Approve N in the Chat card before the model acts', async () => {
  const site = new MockSite({ start: 'number_match' });
  const store = new MemoryComputerStore();
  const provider = new MockComputerProvider({ site });
  let paused: { reason: string; message: string } | null = null;
  const model: ComputerModel = {
    async create(): Promise<ComputerModelResponse> {
      return {
        model: 'claude-sonnet-5',
        content: [tool('finish', { title: 'Done', fields: [], submitted: false })],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    model,
    meteringClient: { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient,
    isPaused: async () => false,
    sleep: async () => {
      const t = [...store.tasks.values()][0];
      if (t?.status === 'needs_you' && !t.resume_requested_at) {
        paused = { reason: t.needs_you!.reason, message: t.needs_you!.message };
        site.completeHumanStep();
        await resumeTask(ORG, t.id, USER);
      }
    },
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000 },
  });
  const task = await startComputerTask({
    orgId: ORG,
    userId: USER,
    jobId: JOB,
    instructions: 'Open the portal and continue.',
  });
  const out = await runComputerTask(task.id);
  assert.equal(out?.status, 'succeeded');
  assert.ok(paused, 'paused for the person');
  assert.equal(paused!.reason, 'number_match');
  assert.equal(paused!.message, 'Approve 47 on your phone, then press Resume.');
  const view = await loadTaskView(ORG, task.id, USER);
  // After resume the card is done; check the audit / that we never invented another number.
  assert.ok(store.audit.some((e) => e.event === 'needs_you' && e.detail.reason === 'number_match'));
  // Check the pause message and audit detail only — not the whole audit JSON,
  // whose timestamps (e.g. :48 / :49 seconds) would flake this assertion.
  assert.doesNotMatch(paused!.message, /\b48\b|\b49\b/);
  assert.ok(
    store.audit.every((e) => !/\b48\b|\b49\b/.test(JSON.stringify(e.detail ?? {}))),
  );
  assert.equal(view.status, 'succeeded');
});

test('ask_clarification pauses with the question in needs_you for Chat', async () => {
  const site = new MockSite({ start: 'form' });
  const store = new MemoryComputerStore();
  const provider = new MockComputerProvider({ site });
  let paused: { reason: string; message: string } | null = null;
  let turn = 0;
  const model: ComputerModel = {
    async create(): Promise<ComputerModelResponse> {
      turn += 1;
      if (turn === 1) {
        return {
          model: 'claude-sonnet-5',
          content: [tool('ask_clarification', { question: 'Which claim number should I use on this form?' })],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return {
        model: 'claude-sonnet-5',
        content: [tool('finish', { title: 'Draft saved', fields: [], submitted: false })],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    model,
    meteringClient: { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient,
    isPaused: async () => false,
    sleep: async () => {
      const t = [...store.tasks.values()][0];
      if (t?.status === 'needs_you' && !t.resume_requested_at) {
        paused = { reason: t.needs_you!.reason, message: t.needs_you!.message };
        await resumeTask(ORG, t.id, USER);
      }
    },
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000 },
  });
  const task = await startComputerTask({
    orgId: ORG,
    userId: USER,
    jobId: JOB,
    instructions: 'Fill the claim form on portal.example-carrier.test.',
  });
  await runComputerTask(task.id);
  assert.equal(paused?.reason, 'clarification');
  assert.equal(paused?.message, 'Which claim number should I use on this form?');
});
