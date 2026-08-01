import type { SupabaseClient } from '@supabase/supabase-js';
import { totalCashCents } from './jobCost.js';
import { finishRun, startRun, step } from './ledger.js';
import { evaluateRules } from './rules.js';
import { loadOrgSnapshot } from './snapshot.js';
import { clearAlerts, upsertAlerts } from './store.js';
import type { EngineResult } from './types.js';

/**
 * One automation pass over the books: load the snapshot, run every enabled
 * rule, reconcile alerts. Idempotent via fingerprint uniqueness.
 */

export interface RunEngineOptions {
  jobId?: string;
  actorType?: 'user' | 'system' | 'schedule';
  actorUserId?: string | null;
  actorLabel?: string | null;
  now?: Date;
}

export async function runEngine(
  supabase: SupabaseClient,
  orgId: string,
  options: RunEngineOptions = {},
): Promise<EngineResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();

  const run = await startRun(supabase, {
    orgId,
    title: options.jobId ? 'Job financial check' : 'Financial health pass',
    actorType: options.actorType ?? 'user',
    actorUserId: options.actorUserId ?? null,
    actorLabel: options.actorLabel ?? null,
    sourceTable: options.jobId ? 'crm_jobs' : null,
    sourceId: options.jobId ?? null,
    input: { jobId: options.jobId ?? null },
  });

  const warnings: string[] = [];

  try {
    const snapshot = await loadOrgSnapshot(supabase, orgId, {
      jobId: options.jobId,
      now,
    });

    await step(supabase, run, {
      type: 'observation',
      action: 'load_snapshot',
      detail: `${snapshot.jobs.length} job(s), ${snapshot.connections.length} connection(s), ${snapshot.accounts.length} account(s).`,
      payload: {
        jobs: snapshot.jobs.length,
        connections: snapshot.connections.length,
      },
    });

    if (!snapshot.settings.enabled) {
      await step(supabase, run, {
        type: 'decision',
        action: 'skipped',
        detail: 'Financial automation is switched off for this organization.',
      });
      const result = emptyResult(orgId, now, startedAt, run.id, ['automation_disabled'], snapshot);
      await finishRun(supabase, run, {
        status: 'succeeded',
        summary: 'Financial automation disabled; nothing evaluated.',
        result: result as unknown as Record<string, unknown>,
        startedAt,
      });
      return result;
    }

    const { findings, rulesEvaluated, rulesSkipped } = evaluateRules(snapshot);

    await step(supabase, run, {
      type: 'decision',
      action: 'evaluate_rules',
      detail: `${rulesEvaluated} rule(s) produced ${findings.length} finding(s).${
        rulesSkipped.length ? ` Skipped: ${rulesSkipped.join(', ')}.` : ''
      }`,
      payload: { findings: findings.length, skipped: rulesSkipped },
    });

    const { opened, updated } = await upsertAlerts(supabase, orgId, findings, now);
    const openFingerprints = new Set(findings.map((f) => f.fingerprint));
    const cleared = await clearAlerts(
      supabase,
      orgId,
      openFingerprints,
      now,
      options.actorUserId,
    );

    await step(supabase, run, {
      type: 'artifact',
      action: 'reconcile_alerts',
      detail: `Opened ${opened}, updated ${updated}, cleared ${cleared}.`,
    });

    const cashCents = totalCashCents(snapshot.accounts);
    const openArCents = snapshot.rollups.reduce((s, r) => s + r.openArCents, 0);
    const totalCostCents = snapshot.rollups.reduce((s, r) => s + r.costCents, 0);

    const result: EngineResult = {
      orgId,
      ranAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      jobsEvaluated: snapshot.jobs.length,
      rulesEvaluated,
      findings: findings.length,
      alertsOpened: opened,
      alertsUpdated: updated,
      alertsCleared: cleared,
      rulesSkipped,
      warnings,
      runId: run.id,
      cashCents,
      openArCents,
      totalCostCents,
    };

    await finishRun(supabase, run, {
      status: 'succeeded',
      summary: `${findings.length} finding(s) across ${snapshot.jobs.length} job(s). Cash ${cashCents}, open AR ${openArCents}.`,
      result: result as unknown as Record<string, unknown>,
      startedAt,
    });

    return result;
  } catch (err) {
    await finishRun(supabase, run, {
      status: 'failed',
      error: (err as Error).message,
      startedAt,
    });
    throw err;
  }
}

function emptyResult(
  orgId: string,
  now: Date,
  startedAt: number,
  runId: string | null,
  warnings: string[],
  snapshot?: Awaited<ReturnType<typeof loadOrgSnapshot>>,
): EngineResult {
  return {
    orgId,
    ranAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
    jobsEvaluated: snapshot?.jobs.length ?? 0,
    rulesEvaluated: 0,
    findings: 0,
    alertsOpened: 0,
    alertsUpdated: 0,
    alertsCleared: 0,
    rulesSkipped: [],
    warnings,
    runId,
    cashCents: snapshot ? totalCashCents(snapshot.accounts) : 0,
    openArCents: snapshot?.rollups.reduce((s, r) => s + r.openArCents, 0) ?? 0,
    totalCostCents: snapshot?.rollups.reduce((s, r) => s + r.costCents, 0) ?? 0,
  };
}
