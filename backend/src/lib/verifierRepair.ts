import { config } from '../config.js';
import { runWebTask } from './webAgent.js';
import { openSignedInSession, type ConnectionRecord } from './webRunner.js';
import type {
  EscalationReason,
  Expectation,
  Finding,
  VerifierStep,
} from './verifierTypes.js';

/**
 * What the verifier is allowed to put right on its own, and what it must ask
 * about first.
 *
 * An agent that finds a problem and fixes it is useful. An agent that finds
 * something it has misread and "fixes" it is a second outage, on a system the
 * customer's business runs on and that we do not own. So the licence to act is
 * drawn narrowly and structurally rather than left to the model's confidence:
 *
 * - **Additive fixes only.** Creating a record the task asked for, or
 *   correcting a field the task itself specified, completes work that was
 *   already authorised. Nothing else is.
 * - **Never destructive.** Deleting, voiding, de-duplicating, or reconciling
 *   two conflicting records destroys something a person may be relying on, and
 *   no confidence score makes that reversible. It goes to a human every time.
 * - **All or nothing.** If any violation needs a person, the whole thing waits
 *   for them. Half-fixing and then asking leaves the site in a state nobody
 *   described, and the human now has to work out what changed under them.
 * - **Bounded.** A fixed number of attempts, each followed by a fresh check.
 *   A verifier that can retry indefinitely is a verifier that can hammer
 *   somebody else's portal indefinitely.
 */

export type RepairDecision =
  /** Nothing violated, or nothing violated that a repair would address. */
  | { kind: 'nothing_to_do' }
  /** Safe to attempt unattended. */
  | { kind: 'repair'; instruction: string; targets: Finding[] }
  /** A person has to decide. */
  | { kind: 'needs_human'; reason: EscalationReason; blocking: Finding[] };

/**
 * The preamble on every repair instruction.
 *
 * The first line is the one that matters. The most likely way a repair does
 * damage is not a bad edit — it is re-entering a record that was there all
 * along because the check could not see it, leaving the customer with two.
 * Duplicates are the failure this system would produce at scale if it were
 * naive, so every repair is told to look before it writes, and told that
 * finding nothing to do is a perfectly good outcome.
 */
const REPAIR_PREAMBLE = [
  'You are correcting one specific problem found when a check was made of earlier work on this site. This is not the original task and you must not redo it.',
  '',
  'Before you enter anything, search for a record matching the identifiers below. If a matching record already exists, STOP — do not create a second one, and say in your summary that it was already there. A duplicate is worse than the problem you were sent to fix, because someone has to notice it and unpick it by hand.',
  '',
  'Do only what is listed. Do not delete anything, do not void or cancel anything, and do not tidy up anything else you notice along the way.',
].join('\n');

/**
 * Wraps a correction in the guards every repair needs.
 *
 * Applied by `attemptRepair` rather than by whoever composed the instruction,
 * so it covers repairs the verifier planned AND repairs a person approved from
 * the escalation queue. The approved ones need it at least as much: they go
 * straight to a writable browser without the verifier having re-derived
 * anything, and a human clicking "make the correction" is authorising the fix,
 * not waiving the duplicate check.
 */
export function withRepairGuards(instruction: string): string {
  return [REPAIR_PREAMBLE, '', 'What to correct:', '', instruction].join('\n');
}

/** Decides whether the violations found can be repaired without asking. */
export function planRepair(findings: Finding[], expectations: Expectation[]): RepairDecision {
  const violations = findings.filter((finding) => finding.verdict === 'violated');
  if (violations.length === 0) return { kind: 'nothing_to_do' };

  const byId = new Map(expectations.map((exp) => [exp.id, exp]));

  const blocking = violations.filter((finding) => {
    if (!finding.repair || finding.repair.repairClass === 'needs_human') return true;
    // The safety class is a field the observing model filled in, so it cannot
    // be the only thing standing between us and a destructive edit. Where the
    // expectation itself says what kind of fix is needed, that wins: a
    // violated "this should NOT be there" means something exists that has to
    // be removed, and removal is never ours to do however the model labelled
    // it.
    const expectation = byId.get(finding.expectationId);
    return expectation?.kind === 'record_absent';
  });

  if (blocking.length > 0) {
    return { kind: 'needs_human', reason: 'unsafe_repair', blocking };
  }
  const items = violations.map((finding, position) => {
    const expectation = byId.get(finding.expectationId);
    const identifiers = Object.entries(expectation?.identifiers ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    const expected = Object.entries(expectation?.expected ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');

    return [
      `${position + 1}. ${finding.repair?.instruction ?? ''}`,
      identifiers ? `   find the record by: ${identifiers}` : '',
      expected ? `   it must end up reading: ${expected}` : '',
      finding.evidence ? `   what the check saw instead: ${finding.evidence.slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  // Just the items. The guards are added by attemptRepair, which is the one
  // door every repair goes through.
  return { kind: 'repair', instruction: items.join('\n\n'), targets: violations };
}

export interface RepairAttemptOptions {
  accessToken: string;
  connection: ConnectionRecord;
  instruction: string;
  siteLabel: string;
  deadline: number;
  startIndex: number;
  onStep?: (step: VerifierStep) => void;
}

export interface RepairAttemptResult {
  ok: boolean;
  summary: string;
  steps: VerifierStep[];
}

/**
 * Carries out one repair.
 *
 * Deliberately opens a WRITABLE session — the read-only guard that protects
 * observation would block the fix. Crossing that line is a separate, explicit
 * act rather than a mode flag on the observing session, so there is no state
 * in which the checking agent is holding a browser that can write.
 */
export async function attemptRepair(options: RepairAttemptOptions): Promise<RepairAttemptResult> {
  const { accessToken, connection, instruction, siteLabel, deadline, onStep } = options;
  const steps: VerifierStep[] = [];
  let index = options.startIndex;

  const record = (action: string, detail: string, error?: string) => {
    index += 1;
    const step: VerifierStep = { index, action, detail, url: '', phase: 'repair', error };
    steps.push(step);
    onStep?.(step);
  };

  const signedIn = await openSignedInSession(accessToken, connection, { readOnly: false });
  if (!signedIn.ok) {
    record('repair', 'Could not sign in to make the correction', signedIn.reason);
    return { ok: false, summary: `Sign-in failed during repair. ${signedIn.reason}`, steps };
  }

  try {
    const outcome = await runWebTask({
      session: signedIn.session,
      kind: 'push',
      instruction: withRepairGuards(instruction),
      siteLabel,
      deadline,
      onStep: (step) => record(step.action, step.detail, step.error),
    });

    return { ok: outcome.completed, summary: outcome.summary, steps };
  } finally {
    await signedIn.session.close();
  }
}

/** Whether another repair may be attempted. */
export function repairsRemaining(attempts: number): boolean {
  return attempts < config.verifier.maxRepairAttempts;
}
