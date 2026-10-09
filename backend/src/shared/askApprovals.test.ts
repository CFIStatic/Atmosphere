import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePendingAction, createPendingAction, denyPendingAction, getPendingAction } from './askApprovals.js';

type Rec = Record<string, unknown>;

/** In-memory ask_pending_actions supporting the calls askApprovals makes. */
function memoryDb(seed: Rec[] = []) {
  const rows: Rec[] = seed.map((r) => ({ ...r }));
  let n = 0;
  const table = () => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let values: Rec = {};
    const filters: Array<(r: Rec) => boolean> = [];
    const run = () => {
      if (op === 'insert') {
        const row = {
          id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
          status: 'pending',
          result: null,
          decided_at: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          ...values,
        };
        rows.push(row);
        return [row];
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, values));
      return hit.map((r) => ({ ...r }));
    };
    const chain: Rec = {
      insert: (v: Rec) => ((op = 'insert'), (values = v), chain),
      update: (v: Rec) => ((op = 'update'), (values = v), chain),
      select: () => chain,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), chain),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
    };
    return chain;
  };
  return { db: { from: () => table() }, rows };
}

const ORG = 'org-1';
const JOB = 'job-1';
const ids = { orgId: ORG, jobId: JOB };

test('a proposed text waits on the card; only Approve sends it, once, with the edit', async () => {
  const { db } = memoryDb();
  const sent: Array<{ to: string; body: string }> = [];
  const sendSms = async (m: { to: string; body: string }) => {
    sent.push({ to: m.to, body: m.body });
    return { ok: true as const, provider: 'twilio', id: 'SM1' };
  };
  const id = await createPendingAction(db, { ...ids, userId: 'u1', kind: 'send_job_sms', payload: { to: '972-555-0142', body: 'Crew is back Tuesday.', recipient: 'Dana (adjuster)' } });
  const card = await getPendingAction(db, { ...ids, id });
  assert.equal(card.status, 'pending');
  assert.equal(card.title, 'Send a text to Dana (adjuster)');
  assert.equal(card.editable, true);
  assert.equal(sent.length, 0, 'proposing never sends');

  const approved = await approvePendingAction(db, { ...ids, id, userId: 'u1', editedBody: 'Crew is back Tuesday at 9.' }, { sendSms: sendSms as never });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.result, 'Text sent to Dana (adjuster).');
  assert.deepEqual(sent, [{ to: '+19725550142', body: 'Crew is back Tuesday at 9.' }], 'the edited text is what went out');

  const again = await approvePendingAction(db, { ...ids, id, userId: 'u2' }, { sendSms: sendSms as never });
  assert.equal(again.status, 'approved');
  assert.equal(sent.length, 1, 'a second click or a second person cannot send it twice');
});

test('Deny sends nothing and the card says so; a decided card cannot be approved after', async () => {
  const { db } = memoryDb();
  let sends = 0;
  const sendSms = async () => ((sends += 1), { ok: true as const, provider: 'twilio', id: 'x' });
  const id = await createPendingAction(db, { ...ids, userId: 'u1', kind: 'send_job_sms', payload: { to: '9725550142', body: 'Hi' } });
  const denied = await denyPendingAction(db, { ...ids, id, userId: 'u1' });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.result, 'Not sent.');
  assert.equal((await approvePendingAction(db, { ...ids, id, userId: 'u1' }, { sendSms: sendSms as never })).status, 'denied');
  assert.equal(sends, 0);
});

test('a failed send is shown on the card, not retried', async () => {
  const { db } = memoryDb();
  const id = await createPendingAction(db, { ...ids, userId: 'u1', kind: 'send_job_sms', payload: { to: '9725550142', body: 'Hi' } });
  const out = await approvePendingAction(db, { ...ids, id, userId: 'u1' }, {
    sendSms: (async () => ({ ok: false, reason: 'not_configured', message: 'SMS is not connected yet.' })) as never,
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.result, 'SMS is not connected yet. Nothing was sent.');
});

test('removing access runs only on approval, through the roster revoke', async () => {
  const { db } = memoryDb();
  const revoked: string[] = [];
  const id = await createPendingAction(db, { ...ids, userId: 'u1', kind: 'revoke_access', payload: { personId: 'grant:g1', name: 'Pat Homeowner', email: 'pat@test.invalid' } });
  const card = await getPendingAction(db, { ...ids, id });
  assert.equal(card.title, "Remove Pat Homeowner's access to this job");
  assert.equal(card.editable, false);
  assert.deepEqual(revoked, []);
  const out = await approvePendingAction(db, { ...ids, id, userId: 'u1', editedBody: 'ignored' }, { revoke: async (p) => revoked.push(p) });
  assert.deepEqual(revoked, ['grant:g1']);
  assert.equal(out.result, 'Pat Homeowner no longer has access to this job.');
});

test('an expired request does nothing; another job or org cannot see it', async () => {
  const { db, rows } = memoryDb();
  let sends = 0;
  const id = await createPendingAction(db, { ...ids, userId: 'u1', kind: 'send_job_sms', payload: { to: '9725550142', body: 'Hi' } });
  rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const out = await approvePendingAction(db, { ...ids, id, userId: 'u1' }, { sendSms: (async () => ((sends += 1), { ok: true })) as never });
  assert.equal(out.status, 'expired');
  assert.equal(sends, 0);
  await assert.rejects(getPendingAction(db, { orgId: 'other-org', jobId: JOB, id }), /not on this job/);
  await assert.rejects(getPendingAction(db, { orgId: ORG, jobId: 'other-job', id }), /not on this job/);
});
