/**
 * Staff-only views for Computer IQ (internal analytics site): the practice
 * success dashboard, one practice run's detail, and the playbook draft
 * review queue. Dollar amounts appear here only; customer screens never show
 * AI cost.
 */
import { assertNoPii } from '../sitePlaybooks.js';
import { PRACTICE_TASKS, type PracticeTask } from './practice/catalog.js';
import { CATEGORY_LABELS, EXCLUDED_SITES, SITE_CATALOG } from '../catalog/sites.js';
import { describeStep, sanitizeSteps } from './playbookSteps.js';
import type { IqStore, PlaybookDraftRow, PracticeRunRow } from './store.js';

const ATTEMPTED = new Set(['succeeded', 'failed']);

function rate(succeeded: number, attempted: number): number | null {
  return attempted ? Math.round((succeeded / attempted) * 1000) / 10 : null;
}

function dateList(today: string, days: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export interface PracticeSummaryInput {
  iq: IqStore;
  orgId: string | null;
  days: number;
  today: string;
  schedule: { enabled: boolean; hourUtc: number };
  tasks?: PracticeTask[];
}

export async function practiceSummary(input: PracticeSummaryInput) {
  const tasks = input.tasks ?? PRACTICE_TASKS;
  const dates = dateList(input.today, input.days);
  const since = dates[0];
  const runs = (await input.iq.listPracticeRuns(since)).filter((r) => !input.orgId || r.org_id === input.orgId);
  const playbooks = await input.iq.listPlaybooks();
  const drafts = await input.iq.listDrafts('pending', 200);

  const byTask = tasks.map((t) => {
    const mine = runs.filter((r) => r.task_key === t.key).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const attempted = mine.filter((r) => ATTEMPTED.has(r.status));
    const succeeded = mine.filter((r) => r.status === 'succeeded').length;
    const last = mine[0] ?? null;
    return {
      key: t.key,
      site: t.site,
      label: t.label,
      mode: t.mode,
      loginHost: t.loginHost,
      runs: mine.length,
      attempted: attempted.length,
      succeeded,
      failed: mine.filter((r) => r.status === 'failed').length,
      needsLogin: mine.filter((r) => r.status === 'needs_login').length,
      successRate: rate(succeeded, attempted.length),
      lastStatus: last?.status ?? null,
      lastRunAt: last?.started_at ?? null,
      lastRunId: last?.id ?? null,
      lastFailure: last && last.status !== 'succeeded' ? last.failure_reason : null,
      days: dates.map((d) => ({ date: d, status: mine.find((r) => r.run_date === d)?.status ?? null, runId: mine.find((r) => r.run_date === d)?.id ?? null })),
    };
  });

  const daily = dates.map((d) => {
    const day = runs.filter((r) => r.run_date === d);
    const attempted = day.filter((r) => ATTEMPTED.has(r.status)).length;
    const succeeded = day.filter((r) => r.status === 'succeeded').length;
    return { date: d, attempted, succeeded, needsLogin: day.filter((r) => r.status === 'needs_login').length, successRate: rate(succeeded, attempted) };
  });

  const siteNames = [...new Set(tasks.map((t) => t.site))];
  const sites = siteNames.map((s) => {
    const mine = runs.filter((r) => r.site === s);
    const attempted = mine.filter((r) => ATTEMPTED.has(r.status)).length;
    const succeeded = mine.filter((r) => r.status === 'succeeded').length;
    return { site: s, attempted, succeeded, needsLogin: mine.filter((r) => r.status === 'needs_login').length, successRate: rate(succeeded, attempted) };
  });

  const attempted = runs.filter((r) => ATTEMPTED.has(r.status));
  const succeeded = runs.filter((r) => r.status === 'succeeded').length;
  const costNanos = runs.reduce((s, r) => s + (Number(r.cost_nanos) || 0), 0);
  const durations = runs.map((r) => r.duration_ms).filter((d): d is number => typeof d === 'number');
  const practiceSites = new Set(tasks.map((t) => t.site));

  return {
    generatedAt: new Date().toISOString(),
    days: input.days,
    today: input.today,
    orgConfigured: Boolean(input.orgId),
    schedule: input.schedule,
    totals: {
      runs: runs.length,
      attempted: attempted.length,
      succeeded,
      failed: runs.filter((r) => r.status === 'failed').length,
      needsLogin: runs.filter((r) => r.status === 'needs_login').length,
      successRate: rate(succeeded, attempted.length),
      costUsd: Math.round((costNanos / 1e9) * 100) / 100,
      modelCalls: runs.reduce((s, r) => s + (Number(r.model_calls) || 0), 0),
      playbookRuns: runs.filter((r) => r.used_playbook).length,
      avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : null,
    },
    tasks: byTask,
    daily,
    sites,
    needsLogin: byTask.filter((t) => t.lastStatus === 'needs_login').map((t) => ({ key: t.key, label: t.label, loginHost: t.loginHost })),
    recent: runs.slice(0, 25).map(runListItem),
    playbooks: playbooks
      .filter((p) => practiceSites.has(p.site) || p.steps.length)
      .map((p) => ({
        id: p.id,
        site: p.site,
        taskType: p.task_type,
        version: p.version,
        source: p.source,
        status: p.status,
        steps: p.steps.length,
        successCount: p.success_count,
        replaySuccessCount: p.replay_success_count,
        failureCount: p.failure_count,
        lastSuccessAt: p.last_success_at,
        updatedAt: p.updated_at,
      })),
    pendingDrafts: drafts.length,
    coverage: siteCoverage(tasks, byTask),
  };
}

/** Every catalog site with its terms verdict, picker visibility and practice status (staff view). */
function siteCoverage(tasks: PracticeTask[], byTask: Array<{ key: string; lastStatus: string | null }>) {
  const last = new Map(byTask.map((t) => [t.key, t.lastStatus]));
  return {
    sites: SITE_CATALOG.map((s) => {
      const mine = tasks.filter((t) => t.catalogId === s.id);
      return {
        id: s.id,
        name: s.name,
        category: CATEGORY_LABELS[s.category],
        terms: s.terms.status,
        termsNote: s.terms.note,
        termsUrl: s.terms.url,
        inPicker: s.terms.status !== 'flagged' && !s.publicTestSite && !s.notInPicker,
        signIn: s.signIn ? { flow: s.signIn.flow, checked: s.signIn.checked } : null,
        twoStep: s.twoStep,
        sso: s.sso,
        practiceTasks: mine.map((t) => t.key),
        needsTestLogin: mine.some((t) => t.loginHost) && mine.every((t) => !t.loginHost || last.get(t.key) !== 'succeeded'),
      };
    }),
    excluded: EXCLUDED_SITES.map((e) => ({ name: e.name, reason: e.reason })),
  };
}

function runListItem(r: PracticeRunRow) {
  return {
    id: r.id,
    date: r.run_date,
    taskKey: r.task_key,
    site: r.site,
    mode: r.mode,
    status: r.status,
    failedStep: r.failed_step,
    failureReason: r.failure_reason,
    usedPlaybook: r.used_playbook,
    playbookVersion: r.playbook_version,
    modelCalls: r.model_calls,
    costUsd: Math.round(((Number(r.cost_nanos) || 0) / 1e9) * 1000) / 1000,
    durationSec: r.duration_ms != null ? Math.round(r.duration_ms / 1000) : null,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export async function practiceRunDetail(iq: IqStore, runId: string) {
  const run = await iq.getPracticeRun(runId);
  if (!run) return null;
  const [screens, routes] = await Promise.all([iq.listPracticeScreens(run.id), run.task_id ? iq.listRoutes(run.task_id) : Promise.resolve([])]);
  const task = PRACTICE_TASKS.find((t) => t.key === run.task_key) ?? null;
  return {
    ...runListItem(run),
    label: task?.label ?? run.task_key,
    instructions: task?.instructions ?? null,
    taskType: run.task_type,
    taskId: run.task_id,
    steps: run.steps ?? [],
    screens: screens.map((s) => ({ index: s.step_index, label: s.label, src: `data:image/jpeg;base64,${s.jpeg_b64}` })),
    routes: routes.map((r) => ({ step: r.step, route: r.route, model: r.model, reason: r.reason })),
  };
}

export function draftView(d: PlaybookDraftRow) {
  return {
    id: d.id,
    site: d.site,
    taskType: d.task_type,
    source: d.source,
    status: d.status,
    stepCount: d.step_count,
    steps: d.steps.map((s, i) => ({ index: i, kind: s.kind, text: describeStep(s), slot: s.kind === 'type' ? s.slot : null })),
    reviewNote: d.review_note,
    reviewedAt: d.reviewed_at,
    playbookId: d.playbook_id,
    createdAt: d.created_at,
  };
}

export class DraftReviewError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'conflict' | 'invalid') {
    super(message);
  }
}

/**
 * Approve a draft: re-scrub, drop any steps the reviewer removed, and publish
 * it to the shared playbook (a new version when the steps differ).
 */
export async function approveDraft(
  iq: IqStore,
  draftId: string,
  input: { reviewerId: string | null; taskType?: string | null; removeSteps?: number[]; note?: string | null },
) {
  const draft = await iq.getDraft(draftId);
  if (!draft) throw new DraftReviewError('Draft not found.', 'not_found');
  if (draft.status !== 'pending') throw new DraftReviewError('This draft was already reviewed.', 'conflict');
  const taskType = (input.taskType ?? draft.task_type).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,59}$/.test(taskType) || taskType === 'demonstration') {
    throw new DraftReviewError('Name the task type (lowercase letters, digits and underscores), for example "claim_status".', 'invalid');
  }
  const drop = new Set(input.removeSteps ?? []);
  const steps = sanitizeSteps(draft.steps.filter((_, i) => !drop.has(i)));
  if (!steps.some((s) => s.kind !== 'explore')) throw new DraftReviewError('A playbook needs at least one click or typed step.', 'invalid');
  assertNoPii(steps, 'steps');
  const saved = await iq.savePlaybookSteps({ site: draft.site, taskType, steps, source: draft.source });
  const ok = await iq.decideDraft(draft.id, { status: 'approved', reviewed_by: input.reviewerId, review_note: input.note?.slice(0, 500) ?? null, playbook_id: saved.id });
  if (!ok) throw new DraftReviewError('This draft was already reviewed.', 'conflict');
  return { draft: draftView((await iq.getDraft(draft.id))!), playbook: { id: saved.id, version: saved.version, changed: saved.changed } };
}

export async function rejectDraft(iq: IqStore, draftId: string, input: { reviewerId: string | null; note?: string | null }) {
  const draft = await iq.getDraft(draftId);
  if (!draft) throw new DraftReviewError('Draft not found.', 'not_found');
  const ok = await iq.decideDraft(draft.id, { status: 'rejected', reviewed_by: input.reviewerId, review_note: input.note?.slice(0, 500) ?? null, playbook_id: null });
  if (!ok) throw new DraftReviewError('This draft was already reviewed.', 'conflict');
  return { draft: draftView((await iq.getDraft(draft.id))!) };
}
