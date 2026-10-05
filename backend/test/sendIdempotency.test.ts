import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_SENT_APPROVAL_MESSAGE,
  actionFingerprint,
  findConsumedMatchingApproval,
  isSendLikeApproval,
} from '../src/computer/sendIdempotency.js';
import type { ComputerApprovalRow } from '../src/computer/store.js';

const fields = [
  { label: 'To', value: 'jack@example.com', source: 'Your message in Chat', verified: true },
  { label: 'Subject', value: 'Update: Project Tiffany & Co.', source: 'Your message in Chat', verified: true },
  { label: 'Body', value: 'Hello — quick update on the job.', source: 'Your message in Chat', verified: true },
];

test('isSendLikeApproval matches Send labels', () => {
  assert.equal(isSendLikeApproval('Send'), true);
  assert.equal(isSendLikeApproval('Send email'), true);
  assert.equal(isSendLikeApproval('Save draft', 'submit'), false);
  assert.equal(isSendLikeApproval('OK', 'send'), true);
});

test('actionFingerprint is stable for same To/Subject/Body', () => {
  const a = actionFingerprint({
    kind: 'send',
    origin: 'https://outlook.live.com',
    buttonLabel: 'Send',
    fields,
  });
  const b = actionFingerprint({
    kind: 'send',
    origin: 'https://outlook.live.com',
    buttonLabel: 'Send',
    fields: fields.map((f) => ({ ...f, value: `  ${f.value}  ` })),
  });
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('findConsumedMatchingApproval blocks a second Send for the same message', () => {
  const fingerprint = actionFingerprint({
    kind: 'send',
    origin: 'https://outlook.live.com',
    buttonLabel: 'Send',
    fields,
  });
  const prior: ComputerApprovalRow = {
    id: 'a1',
    org_id: 'o',
    task_id: 't',
    status: 'consumed',
    action_kind: 'send',
    button_label: 'Send',
    summary: 'Send the email',
    page_url: 'https://outlook.live.com/mail/',
    page_origin: 'https://outlook.live.com',
    fields,
    screenshot_jpeg_b64: 'x',
    token_hash: 'h',
    requested_at: '2026-10-05T18:20:00Z',
    expires_at: '2026-10-05T19:20:00Z',
    decided_by: 'u',
    decided_at: '2026-10-05T18:20:30Z',
    consumed_at: '2026-10-05T18:20:52Z',
  };
  assert.equal(findConsumedMatchingApproval([prior], fingerprint)?.id, 'a1');
  const other = actionFingerprint({
    kind: 'send',
    origin: 'https://outlook.live.com',
    buttonLabel: 'Send',
    fields: [
      ...fields.slice(0, 2),
      { label: 'Body', value: 'Different body entirely.', source: 'Your message in Chat', verified: true },
    ],
  });
  assert.equal(findConsumedMatchingApproval([prior], other), null);
  assert.match(ALREADY_SENT_APPROVAL_MESSAGE, /Sent Items/);
});
