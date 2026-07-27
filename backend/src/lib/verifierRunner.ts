import { config, verifierEnabled } from '../config.js';
import { createUserClient } from './supabase.js';
import { HttpError } from './errors.js';
import {
  acquireRunSlot,
  releaseRunSlot,
  openSignedInSession,
  type ConnectionRecord,
} from './webRunner.js';
import { deriveExpectations } from './verifierExpectations.js';
import { observeSite } from './verifierAgent.js';
import { attemptRepair, planRepair, repairsRemaining } from './verifierRepair.js';
import type {
  EscalationOption,
  EscalationReason,
  Expectation,
  Finding,
  ObservationOutcome,
  VerifierStep,
} from './verifierTypes.js';

/**
 * The verifier's control loop: look, decide, fix or ask.
 *
 * Every pass opens its own browser and signs in again. That is more expensive
 * than reusing the session the run left behind, and it is the point — a check
 * that inherits the first agent's session inherits whatever state that session
 * had drifted into, and would confirm the run against the run's own view of
 * the world rather than against the site.
 *
 * Work happens in-process and is reported by polling, matching how runs
 * behave. A restart drops anything still in flight; a verification is
 * re-runnable by hand, and losing one is far cheaper than the machinery a
 * durable queue would need for a feature whose whole job is to be cautious.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface QueuedVerification {
  accessToken: string;
  verificationId: string;
  runId: string;
  connection: ConnectionRecord;
  /**
   * A correction a person has explicitly approved, carried over from the
   * escalation they answered.
   *
   * Without this, answering "make the correction" would only re-queue an
   * ordinary check — which would look, reach the same conclusion it escalated
   * for the first time, and ask again. The authorisation has to travel with
   * the work, or the queue loops.
   */
  authorizedRepair?: string;
}

/** Waiting verifications, drained as browser slots free up. */
const pending: QueuedVerification[] = [];
/** Past this, the host is already behind; refuse rather than grow unboundedly. */
const MAX_PENDING = 50;

export function pendingVerificationCount(): number {
  return pending.length;
}

/**
 * Starts whatever the current capacity allows.
 *
 * Called after each enqueue and again as each verification finishes, so the
 * queue drains on exactly the events that change how much room there is.
 */
export function pumpVerificationQueue(): void {
  pump();
}

function pump(): void {
  while (pending.length > 0) {
    if (!acquireRunSlot()) return;
    const next = pending.shift()!;
    void executeVerification(next)
      .catch((err) => console.error(`[verifier] verification ${next.verificationId} crashed:`, err))
      .finally(() => {
        releaseRunSlot();
        pump();
      });
  }
}

export interface EnqueueInput {
  accessToken: string;
  runId: string;
  connection: ConnectionRecord;
  /** Null when the verifier enqueued itself after a run reported success. */
  requestedBy?: string | null;
  /** Set only when a person answered an escalation by approving a correction. */
  authorizedRepair?: string;
}

/**
 * Records a verification and queues it.
 *
 * Returns null when one is already in flight for this run — the database's
 * partial unique index decides that, not a check-then-insert here, so two
 * requests racing cannot both win and send two browsers to repair the same
 * problem twice.
 */
export async function enqueueVerification(input: EnqueueInput): Promise<string | null> {
  const supabase = createUserClient(input.accessToken);

  const { data, error } = await supabase
    .from('web_verifications')
    .insert({
      org_id: input.connection.org_id,
      run_id: input.runId,
      connection_id: input.connection.id,
      requested_by: input.requestedBy ?? null,
      status: 'queued',
    })
    .select('id')
    .single();

  if (error) {
    // 23505: the one-active-per-run index. Anything else is a real problem.
    if ((error as any).code === '23505') return null;
    throw new HttpError(500, error.message, 'verifier_enqueue_failed');
  }

  if (pending.length >= MAX_PENDING) {
    const { error: releaseError } = await supabase
      .from('web_verifications')
      .update({
        status: 'failed',
        error: 'Too many checks are already waiting. Start this one again shortly.',
        finished_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    // If that write did not land the row is stuck 'queued', which the partial
    // unique index reads as a check in flight and would block this run for
    // good. Say so rather than reporting a full queue as a check in progress.
    if (releaseError) {
      console.error(`[verifier] could not release the queued row ${data.id}: ${releaseError.message}`);
    }
    throw new HttpError(
      429,
      'Too many checks are already waiting. Try again shortly.',
      'verifier_busy',
    );
  }

  pending.push({
    accessToken: input.accessToken,
    verificationId: data.id,
    runId: input.runId,
    connection: input.connection,
    authorizedRepair: input.authorizedRepair,
  });
  pump();

  return data.id as string;
}

/** The hook Web Access calls when a run claims success. */
export function verificationHook(event: {
  accessToken: string;
  runId: string;
  connection: ConnectionRecord;
  kind: 'pull' | 'push';
}): void {
  if (!verifierEnabled || !config.verifier.autoVerify) return;
  if (event.kind === 'pull' && !config.verifier.verifyPulls) return;

  void enqueueVerification({
    accessToken: event.accessToken,
    runId: event.runId,
    connection: event.connection,
    requestedBy: null,
  }).catch((err) => console.error(`[verifier] could not queue a check for run ${event.runId}:`, err));
}

async function patchVerification(
  accessToken: string,
  verificationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = createUserClient(accessToken);
  const { error } = await supabase.from('web_verifications').update(patch).eq('id', verificationId);
  if (error) {
    console.error(`[verifier] failed to update verification ${verificationId}: ${error.message}`);
  }
}

interface RunRecord {
  id: string;
  org_id: string;
  kind: 'pull' | 'push';
  instruction: string;
  input_data: unknown;
  result: { summary?: string; records?: unknown[] } | null;
  status: string;
}

async function loadRun(accessToken: string, runId: string): Promise<RunRecord | null> {
  const supabase = createUserClient(accessToken);
  const { data, error } = await supabase
    .from('web_runs')
    .select('id, org_id, kind, instruction, input_data, result, status')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'verifier_run_read_failed');
  return (data as RunRecord | null) ?? null;
}

/**
 * Builds the question a person is actually asked.
 *
 * Written from the findings rather than by another model call: the wording has
 * to be stable and has to name what was seen, and a question that varies run
 * to run is one people stop trusting. The evidence travels with it, so the
 * answer can be given without opening the site.
 */
function buildEscalation(
  reason: EscalationReason,
  expectations: Expectation[],
  findings: Finding[],
  outcome: ObservationOutcome,
  run: RunRecord,
  siteLabel: string,
  attempts: number,
): { question: string; context: Record<string, unknown>; options: EscalationOption[] } {
  const byId = new Map(expectations.map((exp) => [exp.id, exp]));
  const unsettled = findings.filter((f) => f.verdict !== 'satisfied');
  const describe = (finding: Finding) =>
    byId.get(finding.expectationId)?.description ?? finding.expectationId;

  const lead =
    unsettled.length === 1
      ? describe(unsettled[0])
      : `${unsettled.length} things from this task`;

  const question =
    reason === 'unsafe_repair'
      ? `Putting this right needs a change I will not make on my own: ${lead}. How would you like to proceed?`
      : reason === 'repair_exhausted'
        ? // The same reason code covers "I corrected it and it still is not
          // right" and "I found a problem but ran out of time to correct it".
          // Telling someone a correction was tried when none was sends them to
          // do the work by hand, when looking again would have fixed it.
          attempts > 0
          ? `I tried to correct this and it still is not right: ${lead}. How would you like to proceed?`
          : `I found a problem but ran out of time to correct it: ${lead}. How would you like to proceed?`
        : reason === 'repair_failed'
          ? `I could not carry out the correction for: ${lead}. How would you like to proceed?`
          : `I could not confirm whether this was done on ${siteLabel}: ${lead}. How would you like to proceed?`;

  // A correction may be offered only when every proposed fix is additive.
  // Where the fix needs a deletion or a judgement call, the honest options are
  // to do it yourself or to tell us how it turned out — offering "make the
  // correction" there would either be a button that quietly does nothing (the
  // repair guards forbid destruction) or a button that destroys something on
  // one click. Neither belongs in a queue people are meant to trust.
  const proposedFixes = unsettled
    .map((finding) => finding.repair)
    .filter((repair): repair is NonNullable<typeof repair> => Boolean(repair?.instruction));
  const allAdditive =
    proposedFixes.length > 0 &&
    proposedFixes.every((repair) => repair.repairClass !== 'needs_human');

  const options: EscalationOption[] = [];

  if (allAdditive) {
    options.push({
      id: 'apply_fix',
      label: 'Make the correction',
      detail: proposedFixes[0].instruction.slice(0, 500),
      action: 'repair',
    });
  }

  options.push(
    {
      id: 'recheck',
      label: 'Check it again',
      detail:
        'Look at the site again and, if what is missing is safe to add, add it. Useful once you have put something right yourself, or if the site was having a bad moment.',
      action: 'recheck',
    },
    {
      id: 'accept',
      label: "It's fine — mark as done",
      detail:
        'You have confirmed the work is there. The run is recorded as verified and nothing further happens.',
      action: 'accept',
    },
    {
      id: 'reject',
      label: "It's wrong — I'll handle it",
      detail:
        'The run is recorded as not done. Nothing is changed on the site and no further attempt is made.',
      action: 'reject',
    },
  );

  return {
    question,
    context: {
      reason,
      siteLabel,
      runInstruction: run.instruction,
      verdict: outcome.verdict,
      verifierSummary: outcome.summary,
      unsettled: unsettled.map((finding) => ({
        expectation: describe(finding),
        verdict: finding.verdict,
        evidence: finding.evidence,
        url: finding.url,
        reasoning: finding.reasoning,
        proposedFix: finding.repair?.instruction ?? null,
        fixSafety: finding.repair?.repairClass ?? null,
      })),
    },
    options,
  };
}

async function raiseEscalation(
  accessToken: string,
  verification: { id: string; orgId: string; runId: string },
  built: { question: string; context: Record<string, unknown>; options: EscalationOption[] },
  reason: EscalationReason,
): Promise<boolean> {
  const supabase = createUserClient(accessToken);
  const { error } = await supabase.from('web_escalations').insert({
    org_id: verification.orgId,
    verification_id: verification.id,
    run_id: verification.runId,
    reason,
    // The column is CHECK'd between 4 and 2000 characters; a question that
    // violated it would fail the insert and leave nobody to ask.
    question: built.question.slice(0, 2000),
    context: built.context,
    options: built.options,
  });

  // 23505 means a question is already open for this verification, which is the
  // outcome we wanted anyway.
  if (!error || (error as any).code === '23505') return true;

  console.error(`[verifier] failed to raise escalation for ${verification.id}: ${error.message}`);
  return false;
}

/** Opens a read-only session and runs one observation pass over the checklist. */
async function observePass(
  accessToken: string,
  connection: ConnectionRecord,
  expectations: Expectation[],
  deadline: number,
  startIndex: number,
): Promise<{ outcome: ObservationOutcome; blockedWrites: number } | { signInError: string }> {
  const signedIn = await openSignedInSession(accessToken, connection, { readOnly: true });
  if (!signedIn.ok) return { signInError: signedIn.reason };

  try {
    const outcome = await observeSite({
      session: signedIn.session,
      expectations,
      siteLabel: connection.label,
      deadline,
      startIndex,
    });
    return { outcome, blockedWrites: signedIn.session.blockedWrites };
  } finally {
    await signedIn.session.close();
  }
}

/**
 * Guarantees the row reaches a terminal state, whatever happens inside.
 *
 * Without this, any throw — Chromium failing to launch, a rotated
 * `WEB_ACCESS_KEY`, the model API returning 500 — would leave the row at
 * 'running'. The partial unique index treats that as a check still in flight,
 * so every later attempt to verify the same run is rejected and the run
 * becomes permanently unverifiable. A verifier that can wedge itself shut is
 * worse than one that failed loudly, because the run still reads "succeeded"
 * and now nothing will ever contradict it.
 */
async function executeVerification(job: QueuedVerification): Promise<void> {
  try {
    await runVerification(job);
  } catch (err) {
    console.error(`[verifier] verification ${job.verificationId} failed:`, err);
    await patchVerification(job.accessToken, job.verificationId, {
      status: 'failed',
      error:
        err instanceof HttpError
          ? err.message
          : 'The check stopped unexpectedly before it could reach a verdict.',
      finished_at: new Date().toISOString(),
    });
  }
}

async function runVerification(job: QueuedVerification): Promise<void> {
  const { accessToken, verificationId, runId, connection } = job;
  const deadline = Date.now() + config.verifier.timeoutMs;
  const steps: VerifierStep[] = [];

  const finish = (patch: Record<string, unknown>) =>
    patchVerification(accessToken, verificationId, {
      ...patch,
      steps,
      finished_at: new Date().toISOString(),
    });

  await patchVerification(accessToken, verificationId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });

  let run: RunRecord | null;
  try {
    run = await loadRun(accessToken, runId);
  } catch (err) {
    await finish({
      status: 'failed',
      error: err instanceof HttpError ? err.message : 'The run could not be read back.',
    });
    return;
  }

  if (!run) {
    await finish({ status: 'cancelled', summary: 'The run no longer exists.' });
    return;
  }

  // Derive the checklist. For a push this deliberately sees only the original
  // instruction and the user's data — never what the first agent said it did.
  let expectations: Expectation[];
  let truncated = false;
  try {
    const checklist = await deriveExpectations({
      kind: run.kind,
      instruction: run.instruction,
      inputData: run.kind === 'push' ? run.input_data : undefined,
      siteLabel: connection.label,
      reportedRecords: run.kind === 'pull' ? (run.result?.records ?? []) : undefined,
    });
    expectations = checklist.expectations;
    truncated = checklist.truncated;
  } catch (err) {
    await finish({
      status: 'failed',
      error: err instanceof HttpError ? err.message : 'The checklist could not be prepared.',
    });
    return;
  }

  if (expectations.length === 0) {
    // Not a pass. A task that states nothing checkable cannot be confirmed, and
    // reporting it as verified would be the exact failure this system exists to
    // prevent — a green tick nobody earned.
    await finish({
      status: 'failed',
      expectations: [],
      summary:
        'This task did not state anything that could be checked by looking at the site, so it could not be confirmed either way.',
    });
    return;
  }

  await patchVerification(accessToken, verificationId, { expectations });

  let attempts = 0;

  // A correction a person approved when they answered an escalation. It runs
  // before the first look, because the point of "make the correction" is that
  // the site is expected to be wrong right now — observing first would just
  // re-derive the finding they have already seen and ruled on.
  //
  // It counts against the repair budget, so an approved fix that does not take
  // comes back as a question rather than looping.
  if (job.authorizedRepair) {
    attempts += 1;
    await patchVerification(accessToken, verificationId, { repair_attempts: attempts });

    const approved = await attemptRepair({
      accessToken,
      connection,
      instruction: job.authorizedRepair,
      siteLabel: connection.label,
      deadline,
      startIndex: steps.length,
    });
    steps.push(...approved.steps);

    if (!approved.ok) {
      const asked = await raiseEscalation(
        accessToken,
        { id: verificationId, orgId: connection.org_id, runId },
        {
          question: `The correction you approved could not be carried out on ${connection.label}. How would you like to proceed?`,
          context: {
            reason: 'repair_failed',
            siteLabel: connection.label,
            runInstruction: run.instruction,
            attemptedRepair: job.authorizedRepair,
            verifierSummary: approved.summary,
          },
          options: [
            {
              id: 'recheck',
              label: 'Look again',
              detail: 'Check the site as it stands now.',
              action: 'recheck',
            },
            {
              id: 'reject',
              label: "I'll handle it",
              detail: 'Record the run as not done and stop trying.',
              action: 'reject',
            },
          ],
        },
        'repair_failed',
      );

      await finish({
        status: asked ? 'escalated' : 'failed',
        expectations,
        repair_attempts: attempts,
        summary: `The approved correction could not be carried out. ${approved.summary}`,
      });
      return;
    }
  }

  let pass = await observePass(accessToken, connection, expectations, deadline, steps.length);

  if ('signInError' in pass) {
    await finish({
      status: 'failed',
      expectations,
      error: `Could not sign in to check this. ${pass.signInError}`,
    });
    return;
  }

  const escalate = async (reason: EscalationReason, outcome: ObservationOutcome) => {
    const built = buildEscalation(
      reason,
      expectations,
      outcome.findings,
      outcome,
      run!,
      connection.label,
      attempts,
    );

    // Raise the question BEFORE marking the check escalated. The other order
    // can leave a verification sitting in 'escalated' with nothing in the
    // queue to answer — a state with no way out, since only answering an
    // escalation moves it on.
    const asked = await raiseEscalation(
      accessToken,
      { id: verificationId, orgId: connection.org_id, runId },
      built,
      reason,
    );

    await finish({
      status: asked ? 'escalated' : 'failed',
      verdict: outcome.verdict,
      expectations,
      findings: outcome.findings,
      repair_attempts: attempts,
      summary: outcome.summary,
      ...(asked
        ? {}
        : { error: 'The check could not be settled, and the question could not be recorded.' }),
    });
  };

  // Look, and then either accept, repair, or ask — repeating only as far as the
  // repair budget allows.
  for (;;) {
    const outcome = pass.outcome;
    steps.push(...outcome.steps);

    if (outcome.verdict === 'satisfied') {
      // A checklist that would not fit is a checklist that was only partly
      // looked at, and "verified" would then be claiming more than was
      // checked. Ask instead of overstating it.
      if (truncated) {
        await escalate('indeterminate', {
          ...outcome,
          summary: `Everything I checked was there, but this task listed more to confirm than one pass can carry, so I only checked the first ${expectations.length}. ${outcome.summary}`,
        });
        return;
      }

      await finish({
        status: attempts > 0 ? 'repaired' : 'verified',
        verdict: 'satisfied',
        expectations,
        findings: outcome.findings,
        repair_attempts: attempts,
        summary:
          attempts > 0
            ? `The work was not there, so it was corrected and re-checked. ${outcome.summary}`
            : outcome.summary,
      });
      return;
    }

    if (outcome.verdict === 'indeterminate') {
      await escalate('indeterminate', outcome);
      return;
    }

    // The guard that keeps this check honest can also blind it: a site whose
    // searches post, or whose table arrives over a socket, may have rendered
    // less than it really holds. "The record is missing" read off a page we
    // broke ourselves is not grounds to write to a customer's system — that is
    // precisely how a duplicate gets created. Ask instead.
    if (pass.blockedWrites > 0) {
      await escalate('indeterminate', {
        ...outcome,
        summary: `${outcome.summary} (This site tried to send ${pass.blockedWrites} request${pass.blockedWrites === 1 ? '' : 's'} that the read-only check refused, so parts of it may not have loaded. Nothing was changed on the strength of that.)`,
      });
      return;
    }

    const decision = planRepair(outcome.findings, expectations);

    if (decision.kind === 'needs_human') {
      await escalate('unsafe_repair', outcome);
      return;
    }
    if (decision.kind === 'nothing_to_do') {
      await escalate('indeterminate', outcome);
      return;
    }
    if (!repairsRemaining(attempts)) {
      await escalate('repair_exhausted', outcome);
      return;
    }
    if (Date.now() > deadline) {
      await escalate('repair_exhausted', outcome);
      return;
    }

    attempts += 1;
    await patchVerification(accessToken, verificationId, {
      verdict: 'violated',
      findings: outcome.findings,
      repair_attempts: attempts,
      steps,
    });

    const repair = await attemptRepair({
      accessToken,
      connection,
      instruction: decision.instruction,
      siteLabel: connection.label,
      deadline,
      startIndex: steps.length,
    });
    steps.push(...repair.steps);

    if (!repair.ok) {
      await escalate('repair_failed', { ...outcome, summary: repair.summary });
      return;
    }

    const next = await observePass(accessToken, connection, expectations, deadline, steps.length);
    if ('signInError' in next) {
      await finish({
        status: 'failed',
        expectations,
        findings: outcome.findings,
        repair_attempts: attempts,
        error: `Could not sign in to re-check after the correction. ${next.signInError}`,
      });
      return;
    }
    pass = next;
  }
}

/**
 * Applies a human's answer to an open escalation.
 *
 * `accept` and `reject` close the verification on the person's authority —
 * they looked, and their judgement outranks the agent's. `repair` and
 * `recheck` put a fresh pass back on the queue, which is what makes an
 * escalation a pause rather than a dead end.
 */
export async function resolveEscalation(input: {
  accessToken: string;
  userId: string;
  escalationId: string;
  optionId: string;
  note?: string;
}): Promise<{ status: string; verificationId: string }> {
  const supabase = createUserClient(input.accessToken);

  const { data: escalation, error } = await supabase
    .from('web_escalations')
    .select('id, org_id, verification_id, run_id, status, options, context')
    .eq('id', input.escalationId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'verifier_escalation_read_failed');
  if (!escalation) throw new HttpError(404, 'That question no longer exists.', 'verifier_not_found');
  if (escalation.status !== 'open') {
    throw new HttpError(409, 'That question has already been answered.', 'verifier_already_resolved');
  }

  const options = (escalation.options ?? []) as EscalationOption[];
  const chosen = options.find((option) => option.id === input.optionId);
  if (!chosen) {
    throw new HttpError(400, 'That is not one of the offered answers.', 'verifier_bad_option');
  }

  const { data: closed, error: closeError } = await supabase
    .from('web_escalations')
    .update({
      status: 'resolved',
      chosen_option: chosen.id,
      resolution_note: input.note ?? null,
      resolved_by: input.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', escalation.id)
    // Only close it if it is still open, so two people answering at once
    // cannot both trigger the follow-up work.
    .eq('status', 'open')
    // Selecting back is what makes that an actual lock: without it the update
    // reports success whether it matched a row or not, and both answers would
    // go on to queue their own browser against the same run.
    .select('id');

  if (closeError) throw new HttpError(500, closeError.message, 'verifier_resolve_failed');
  if (!closed || closed.length === 0) {
    throw new HttpError(409, 'Somebody else just answered this.', 'verifier_already_resolved');
  }

  const verificationId = escalation.verification_id as string;

  if (chosen.action === 'accept' || chosen.action === 'reject') {
    const accepted = chosen.action === 'accept';
    await supabase
      .from('web_verifications')
      .update({
        status: accepted ? 'verified' : 'rejected',
        summary: accepted
          ? `Confirmed by a member of the organization.${input.note ? ` ${input.note}` : ''}`
          : `Marked as not done by a member of the organization.${input.note ? ` ${input.note}` : ''}`,
        finished_at: new Date().toISOString(),
      })
      .eq('id', verificationId);
    return { status: accepted ? 'verified' : 'rejected', verificationId };
  }

  // repair / recheck — queue a fresh pass over the same run.
  const { data: verification } = await supabase
    .from('web_verifications')
    .select('run_id, connection_id')
    .eq('id', verificationId)
    .maybeSingle();

  if (!verification) {
    throw new HttpError(404, 'That check no longer exists.', 'verifier_not_found');
  }

  const { data: connection, error: connectionError } = await supabase
    .from('web_connections')
    .select('id, org_id, label, site_url, login_url, username')
    .eq('id', verification.connection_id)
    .maybeSingle();

  if (connectionError) {
    throw new HttpError(500, connectionError.message, 'verifier_connection_read_failed');
  }
  if (!connection) {
    throw new HttpError(404, 'That connection no longer exists.', 'verifier_not_found');
  }

  const queued = await enqueueVerification({
    accessToken: input.accessToken,
    runId: verification.run_id as string,
    connection: connection as ConnectionRecord,
    requestedBy: input.userId,
    authorizedRepair:
      chosen.action === 'repair'
        ? authorizedRepairFrom(escalation.context, input.note)
        : undefined,
  });

  return { status: queued ? 'queued' : 'already_running', verificationId: queued ?? verificationId };
}

/**
 * Rebuilds the correction a person approved, from the evidence shown alongside
 * the question they answered.
 *
 * Taken from the stored context rather than the option's `detail`, which is
 * truncated for display and would carry a half-sentence instruction into a
 * writable browser. Their note is appended: it is the one place a human can
 * correct the agent's reading of the site ("the invoice number is INV-1002"),
 * and it is the reason approving a fix is meaningfully different from letting
 * the verifier act alone.
 */
function authorizedRepairFrom(context: unknown, note?: string): string | undefined {
  const unsettled = (context as any)?.unsettled;
  const fixes: string[] = Array.isArray(unsettled)
    ? unsettled
        .map((item: any) => String(item?.proposedFix ?? '').trim())
        .filter((fix: string) => fix.length > 0)
    : [];

  const attempted = String((context as any)?.attemptedRepair ?? '').trim();
  if (fixes.length === 0 && attempted) fixes.push(attempted);
  if (fixes.length === 0) return undefined;

  return [
    'A member of the organization reviewed this and asked for the following correction.',
    '',
    ...fixes.map((fix, index) => `${index + 1}. ${fix}`),
    note ? `\nThey added: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
