/**
 * Keep Computer from asking Approve twice for the same outbound send.
 *
 * Tokens are single-use per approval id. That does not stop a second
 * request_approval for the same To / Subject / Body after the first click.
 * Fingerprints span logical actions so a consumed send blocks a re-prompt
 * until the agent finishes (and checks Sent Items first).
 */
import { createHash } from 'node:crypto';
import type { ApprovalField, ConsequentialKind } from './types.js';
import type { ComputerApprovalRow } from './store.js';

const SEND_LABEL =
  /\b(send|send email|send message|send now|send without|envoyer|submit and send)\b/i;

export function isSendLikeApproval(buttonLabel: string, kind?: ConsequentialKind | null): boolean {
  if (kind === 'send') return true;
  return SEND_LABEL.test(String(buttonLabel ?? ''));
}

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9@._+\-:/ ]+/g, '').trim();
}

function fieldByHints(fields: ApprovalField[], hints: RegExp[]): string {
  for (const field of fields) {
    const label = String(field.label ?? '');
    if (hints.some((re) => re.test(label))) return norm(String(field.value ?? ''));
  }
  return '';
}

/** Stable fingerprint for one irreversible send (or similar). */
export function actionFingerprint(input: {
  kind: ConsequentialKind | string;
  origin: string | null | undefined;
  buttonLabel: string;
  fields: ApprovalField[];
}): string {
  const to = fieldByHints(input.fields, [/^to\b/i, /\brecipient\b/i, /\bemail\b/i, /\baddressee\b/i]);
  const subject = fieldByHints(input.fields, [/^subject\b/i, /\btitle\b/i]);
  const body = fieldByHints(input.fields, [/^body\b/i, /\bmessage\b/i, /\bcontent\b/i, /\bcompose\b/i]);
  const payload = [
    String(input.kind || 'send'),
    norm(String(input.origin ?? '')),
    norm(String(input.buttonLabel ?? '')),
    to,
    subject,
    body.slice(0, 2000),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function fingerprintsMatch(a: string, b: string): boolean {
  return Boolean(a && b && a === b);
}

/** Prior approval on this task that already completed the same logical send. */
export function findConsumedMatchingApproval(
  approvals: ComputerApprovalRow[],
  fingerprint: string,
): ComputerApprovalRow | null {
  for (const row of approvals) {
    if (row.status !== 'consumed' && row.status !== 'approved') continue;
    if (!isSendLikeApproval(row.button_label, row.action_kind)) continue;
    const prior = actionFingerprint({
      kind: row.action_kind,
      origin: row.page_origin,
      buttonLabel: row.button_label,
      fields: Array.isArray(row.fields) ? row.fields : [],
    });
    if (fingerprintsMatch(prior, fingerprint)) return row;
  }
  return null;
}

export const ALREADY_SENT_APPROVAL_MESSAGE =
  'This To / Subject / Body already has an approved Send on this task. ' +
  'Open Sent Items (or Sent) and confirm the message is there. ' +
  'If it is, call finish with submitted=true — do not request_approval again. ' +
  'Only request a new Send approval if Sent Items shows nothing matching To and Subject.';
