import type { SupabaseClient } from '@supabase/supabase-js';
import { finishRun, startRun, step, type RunHandle } from './ledger.js';
import { expectedTasksUpTo } from './playbooks.js';
import { RULES } from './rules.js';
import { loadOrgSnapshot } from './snapshot.js';
import {
  clearAlerts,
  createTasksIfAbsent,
  listAlertsForReconcile,
  upsertAlerts,
} from './store.js';
import type { Alert, EngineResult, Finding, OrgSnapshot } from './types.js';

/**
 * The automation engine.
 *
 * One pass: load the org's working set, run every enabled rule over it,
 * reconcile the resulting findings against the alerts already on record, and
 * optionally create the work the findings imply.
 *
 * The design constraint that matters is **idempotence**. This runs on every page
 * load and on a timer, so a pass that is not idempotent produces either
 * duplicate alerts or duplicate tasks, and either one teaches a project manager
 * to stop reading the panel. Two mechanisms enforce it, both in the database
 * rather than in this file:
 *
 *   * alerts are unique on `(org_id, fingerprint)`, so a repeat finding updates
 *     one row;
 *   * generated tasks are unique on `(project_id, origin_key)`, so re-proposing
 *     work that already exists inserts nothing.
 *
 * The engine runs under the caller's own JWT. It is not a privileged process —
 * it sees exactly what the person who triggered it can see.
 */

export interface RunEngineOptions {
  /** Limit the pass to one project (the "re-check this job" button). */
  projectId?: string;
  /** Who or what asked. Recorded on the run so the trace is attributable. */
  actorType?: 'user' | 'system' | 'schedule';
  actorUserId?: string | null;
  actorLabel?: string | null;
  /** Fixed clock, for tests. */
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
    title: options.projectId
      ? 'Project check'
      : 'Automation pass over every open project',
    actorType: options.actorType ?? 'user',
    actorUserId: options.actorUserId ?? null,
    actorLabel: options.actorLabel ?? null,
    sourceTable: options.projectId ? 'pm_projects' : null,
    sourceId: options.projectId ?? null,
    input: { projectId: options.projectId ?? null },
  });

  const warnings: string[] = [];

  try {
    const snapshot = await loadOrgSnapshot(supabase, orgId, {
      projectId: options.projectId,
      now,
    });

    await step(supabase, run, {
      type: 'observation',
      action: 'load_snapshot',
      detail: `${snapshot.projects.length} open project(s), ${snapshot.equipment.length} asset(s), ${snapshot.members.length} member(s).`,
      payload: { projects: snapshot.projects.length },
    });

    // An org can switch the whole thing off. Do it after the snapshot so the
    // trace still records that a pass was requested and why it did nothing.
    if (!snapshot.settings.enabled) {
      await step(supabase, run, {
        type: 'decision',
        action: 'skipped',
        detail: 'Automation is switched off for this organization.',
      });
      const result = emptyResult(orgId, now, startedAt, run.id, ['automation_disabled']);
      await finishRun(supabase, run, {
        status: 'succeeded',
        summary: 'Automation disabled for this organization; nothing evaluated.',
        result: result as unknown as Record<string, unknown>,
        startedAt,
      });
      return result;
    }

    const { findings, rulesEvaluated, rulesSkipped, ruleWarnings } = evaluateRules(snapshot);
    warnings.push(...ruleWarnings);

    await step(supabase, run, {
      type: 'decision',
      action: 'evaluate_rules',
      detail: `${rulesEvaluated} rule(s) produced ${findings.length} finding(s).${
        rulesSkipped.length ? ` Skipped (disabled): ${rulesSkipped.join(', ')}.` : ''
      }`,
      payload: { findings: findings.length, skipped: rulesSkipped },
    });

    const reconciliation = await reconcileAlerts(supabase, orgId, findings, run, now);
    const tasksCreated = snapshot.settings.autoCreateTasks
      ? await createProposedTasks(supabase, snapshot, findings, run)
      : 0;

    const result: EngineResult = {
      orgId,
      ranAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      projectsEvaluated: snapshot.projects.length,
      rulesEvaluated,
      findings: findings.length,
      alertsOpened: reconciliation.opened,
      alertsUpdated: reconciliation.updated,
      alertsCleared: reconciliation.cleared,
      tasksCreated,
      rulesSkipped,
      agentRunId: run.id,
      warnings,
    };

    await finishRun(supabase, run, {
      status: 'succeeded',
      summary: summarise(result),
      result: result as unknown as Record<string, unknown>,
      startedAt,
    });

    return result;
  } catch (err) {
    const message = (err as Error).message;
    await step(supabase, run, { type: 'error', action: 'engine_failed', detail: message, status: 'error' });
    await finishRun(supabase, run, { status: 'failed', error: message, startedAt });
    throw err;
  }
}

function emptyResult(
  orgId: string,
  now: Date,
  startedAt: number,
  agentRunId: string | null,
  rulesSkipped: string[],
): EngineResult {
  return {
    orgId,
    ranAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
    projectsEvaluated: 0,
    rulesEvaluated: 0,
    findings: 0,
    alertsOpened: 0,
    alertsUpdated: 0,
    alertsCleared: 0,
    tasksCreated: 0,
    rulesSkipped,
    agentRunId,
    warnings: [],
  };
}

function summarise(r: EngineResult): string {
  const parts = [
    `${r.projectsEvaluated} project(s)`,
    `${r.findings} finding(s)`,
    `${r.alertsOpened} new`,
    `${r.alertsCleared} cleared`,
  ];
  if (r.tasksCreated) parts.push(`${r.tasksCreated} task(s) created`);
  return parts.join(', ');
}

/* ------------------------------------------------------------------ *
 * Rule evaluation
 * ------------------------------------------------------------------ */

function evaluateRules(snapshot: OrgSnapshot): {
  findings: Finding[];
  rulesEvaluated: number;
  rulesSkipped: string[];
  ruleWarnings: string[];
} {
  const disabled = new Set(snapshot.settings.disabledRules);
  const findings: Finding[] = [];
  const rulesSkipped: string[] = [];
  const ruleWarnings: string[] = [];
  let rulesEvaluated = 0;

  for (const rule of RULES) {
    if (disabled.has(rule.key)) {
      rulesSkipped.push(rule.key);
      continue;
    }
    rulesEvaluated += 1;

    // One rule throwing must not lose the other eighteen. A rule fed a project
    // with a null it did not expect should cost that rule's findings, not the
    // whole pass.
    try {
      if (rule.scope === 'org') {
        findings.push(...rule.evaluate({ snapshot }));
      } else {
        for (const ctx of snapshot.projects) {
          try {
            findings.push(...rule.evaluate({ snapshot, ctx }));
          } catch (err) {
            ruleWarnings.push(
              `rule ${rule.key} failed on ${ctx.project.projectNumber}: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      ruleWarnings.push(`rule ${rule.key} failed: ${(err as Error).message}`);
    }
  }

  return { findings, rulesEvaluated, rulesSkipped, ruleWarnings };
}

/* ------------------------------------------------------------------ *
 * Alert reconciliation
 * ------------------------------------------------------------------ */

interface Reconciliation {
  opened: number;
  updated: number;
  cleared: number;
  /** Findings suppressed because a human dismissed that fingerprint. */
  suppressed: number;
}

/** Alert states that are still on somebody's list. */
const LIVE_STATUSES = new Set(['open', 'acknowledged', 'snoozed']);

/**
 * Turn this pass's findings into the alert list.
 *
 * Four cases, keyed off the fingerprint's existing row in **any** status —
 * fingerprints are unique per org, so every write lands on that row whether the
 * engine plans for it or not:
 *
 *   * **New** — no row with that fingerprint at all. Insert one.
 *   * **Still true** — a live row. Bump `occurrences`, refresh
 *     severity/title/detail, move `last_seen_at`. Deliberately does *not* reset
 *     an `acknowledged` alert back to `open`: a PM who acknowledged something
 *     does not want it shouting again fifteen minutes later. A snoozed alert
 *     wakes on its own when the snooze expires.
 *   * **Recurring** — a *resolved* row whose condition is back. Reopened, with
 *     `occurrences` continuing upward from where it left off. Counting from 1
 *     again would be refused by the guard trigger (counters only climb) and take
 *     the whole pass down with it — and this is the commonest lifecycle an alert
 *     has, not an edge case.
 *   * **Gone** — a live row whose finding did not recur. Resolved with
 *     `resolution='cleared'`, which the migration's trigger records as having no
 *     human behind it. Auto-clearing is what keeps the panel trustworthy; without
 *     it the list only ever grows and stops meaning "what is wrong right now".
 *
 * Dismissed rows are left strictly alone. Dismissing means "stop telling me
 * about this", and quietly reopening it on the next pass would make the button a
 * lie — so a finding whose fingerprint was dismissed is suppressed, not written.
 */
async function reconcileAlerts(
  supabase: SupabaseClient,
  orgId: string,
  findings: Finding[],
  run: RunHandle,
  now: Date,
): Promise<Reconciliation> {
  const existing = await listAlertsForReconcile(supabase, orgId);
  const byFingerprint = new Map<string, Alert>(existing.map((a) => [a.fingerprint, a]));

  // A rule can legitimately produce the same fingerprint twice in one pass
  // (two areas, one project-level finding). Last one wins rather than the
  // upsert failing on a duplicate key within its own payload.
  const deduped = new Map<string, Finding>();
  for (const f of findings) deduped.set(f.fingerprint, f);

  const rows: Record<string, unknown>[] = [];
  let opened = 0;
  let updated = 0;
  let suppressed = 0;

  for (const finding of deduped.values()) {
    const prior = byFingerprint.get(finding.fingerprint);
    const nowIso = now.toISOString();

    if (prior?.status === 'dismissed') {
      suppressed += 1;
      continue;
    }

    if (prior) {
      // Live rows keep their status; a resolved one comes back as open.
      const reopening = !LIVE_STATUSES.has(prior.status);
      if (reopening) opened += 1;
      else updated += 1;

      rows.push({
        // The identity columns are immutable per the guard trigger; they are
        // included because upsert needs the full row, and they are unchanged.
        id: prior.id,
        org_id: orgId,
        project_id: prior.projectId,
        rule_key: prior.ruleKey,
        fingerprint: prior.fingerprint,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        detail: finding.detail ?? null,
        suggested_action: finding.suggestedAction ?? null,
        entity_type: finding.entityType ?? null,
        entity_id: finding.entityId ?? null,
        facts: finding.facts ?? {},
        // Continues upward from where it left off. The guard trigger refuses a
        // decrease, so this must never restart at 1 — see the note above.
        occurrences: prior.occurrences + 1,
        last_seen_at: nowIso,
        first_seen_at: prior.firstSeenAt,
        // A resolved alert whose condition is back reopens. A snooze that has
        // expired returns to open. An unexpired snooze and an acknowledgement
        // are both left exactly as the human left them.
        status: reopening
          ? 'open'
          : prior.status === 'snoozed' &&
              prior.snoozeUntil &&
              new Date(prior.snoozeUntil) <= now
            ? 'open'
            : prior.status,
        // Reopening clears the previous outcome; the guard also nulls the
        // resolved_at/by pair when it sees the status go back to 'open'.
        ...(reopening ? { resolution: null, snooze_until: null } : {}),
        agent_run_id: run.id,
      });
    } else {
      opened += 1;
      rows.push({
        org_id: orgId,
        project_id: finding.projectId,
        rule_key: finding.ruleKey,
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        detail: finding.detail ?? null,
        suggested_action: finding.suggestedAction ?? null,
        entity_type: finding.entityType ?? null,
        entity_id: finding.entityId ?? null,
        facts: finding.facts ?? {},
        status: 'open',
        occurrences: 1,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        agent_run_id: run.id,
      });
    }
  }

  if (rows.length) await upsertAlerts(supabase, rows);

  const stillTrue = new Set(deduped.keys());
  // Only live rows can go away. Already-resolved and dismissed rows are not
  // "cleared" again on every pass — that would rewrite their resolution and
  // spam the trace forever.
  const goneIds = existing
    .filter((a) => LIVE_STATUSES.has(a.status) && !stillTrue.has(a.fingerprint))
    .map((a) => a.id);
  const cleared = await clearAlerts(supabase, goneIds);

  await step(supabase, run, {
    type: 'artifact',
    action: 'reconcile_alerts',
    detail:
      `${opened} opened, ${updated} still true, ${cleared} cleared` +
      (suppressed ? `, ${suppressed} suppressed as dismissed.` : '.'),
    payload: { opened, updated, cleared, suppressed },
  });

  return { opened, updated, cleared, suppressed };
}

/* ------------------------------------------------------------------ *
 * Task generation
 * ------------------------------------------------------------------ */

/**
 * Create the work the findings imply, plus the standard playbook work for each
 * project's phase.
 *
 * Both go through the same `(project_id, origin_key)` unique index, so a task a
 * PM has already cancelled does not grow back and a task that already exists is
 * not duplicated. That means this can run every fifteen minutes without turning
 * anyone's list into noise.
 */
async function createProposedTasks(
  supabase: SupabaseClient,
  snapshot: OrgSnapshot,
  findings: Finding[],
  run: RunHandle,
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const push = (projectId: string, originKey: string, row: Record<string, unknown>) => {
    const dedupeKey = `${projectId}:${originKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push(row);
  };

  // 1. Work implied by findings.
  for (const finding of findings) {
    if (!finding.task || !finding.projectId) continue;
    const t = finding.task;
    push(finding.projectId, t.originKey, {
      project_id: finding.projectId,
      title: t.title,
      details: t.details ?? null,
      category: t.category,
      priority: t.priority,
      source: 'agent',
      origin_key: t.originKey,
      agent_run_id: run.id,
      assigned_to: t.assignTo ?? null,
      due_at: t.dueInHours
        ? new Date(snapshot.now.getTime() + t.dueInHours * 3_600_000).toISOString()
        : null,
    });
  }

  // 2. Standard playbook work for the phase each project has reached.
  for (const ctx of snapshot.projects) {
    if (ctx.project.status !== 'active') continue;
    // Only generate work that has *never* existed on this project. Using the
    // full key set rather than the open tasks is what stops a completed
    // playbook task from being recreated the moment the crew finishes it.
    const existingKeys = new Set(ctx.usedOriginKeys);
    for (const template of expectedTasksUpTo(ctx.project.workType, ctx.project.phase)) {
      if (existingKeys.has(template.key)) continue;
      push(ctx.project.id, template.key, {
        project_id: ctx.project.id,
        title: template.title,
        details: template.details ?? null,
        category: template.category,
        priority: template.priority,
        source: 'playbook',
        origin_key: template.key,
        agent_run_id: run.id,
        due_at: template.dueInHours
          ? new Date(snapshot.now.getTime() + template.dueInHours * 3_600_000).toISOString()
          : null,
      });
    }
  }

  if (!rows.length) return 0;

  const created = await createTasksIfAbsent(supabase, rows);
  await step(supabase, run, {
    type: 'artifact',
    action: 'create_tasks',
    detail: `${created.length} task(s) created from ${rows.length} candidate(s); the rest already existed.`,
    payload: { created: created.length, candidates: rows.length },
  });

  return created.length;
}
