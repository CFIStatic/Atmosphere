import type { SupabaseClient } from '@supabase/supabase-js';
import { milestonesFor, requirementsFor } from './requirements.js';
import { expectedTasksUpTo } from './playbooks.js';
import {
  createDocumentsIfAbsent,
  createMilestonesIfAbsent,
  createTasksIfAbsent,
  listOriginKeys,
} from './store.js';
import type { Project } from './types.js';

/**
 * Set a project up so it is actionable the moment it exists.
 *
 * A new job arrives with its documentation checklist, its dated commitments and
 * its first phase of work already on it. This is most of what "automating as
 * much as possible" means in practice — not clever inference, but never making
 * somebody type the same fifteen things they type on every job.
 *
 * Every write is idempotent (`ignoreDuplicates` against the unique constraints),
 * so this is safe to call again when a project changes phase or work type, and
 * calling it twice concurrently cannot double-seed.
 */

export interface SeedResult {
  documents: number;
  milestones: number;
  tasks: number;
}

export async function seedProject(
  supabase: SupabaseClient,
  project: Project,
  options: { agentRunId?: string | null; now?: Date } = {},
): Promise<SeedResult> {
  const now = options.now ?? new Date();
  const shape = {
    workType: project.workType,
    lossType: project.lossType,
    isInsurance: Boolean(project.claimNumber || project.carrier),
  };

  const documents = await createDocumentsIfAbsent(
    supabase,
    requirementsFor(shape).map((r) => ({
      project_id: project.id,
      requirement_key: r.key,
      label: r.label,
      kind: r.kind,
      is_blocking: r.blocking,
      required_by_phase: r.requiredByPhase,
      status: 'missing',
      note: r.why ?? null,
    })),
  );

  // Carrier clocks run from the loss, not from when we heard about it — a job
  // reported on day three has already used three days of its reporting window.
  const anchor = project.lossAt ? new Date(project.lossAt) : new Date(project.createdAt);
  const milestones = await createMilestonesIfAbsent(
    supabase,
    milestonesFor(shape).map((m) => ({
      project_id: project.id,
      milestone_key: m.key,
      label: m.label,
      kind: m.kind,
      due_at: new Date(anchor.getTime() + m.dueInHours * 3_600_000).toISOString(),
      note: m.why ?? null,
    })),
  );

  const used = await listOriginKeys(supabase, project.orgId);
  const existing = new Set(used.get(project.id) ?? []);
  const tasks = await createTasksIfAbsent(
    supabase,
    expectedTasksUpTo(project.workType, project.phase)
      .filter((t) => !existing.has(t.key))
      .map((t) => ({
        project_id: project.id,
        title: t.title,
        details: t.details ?? null,
        category: t.category,
        priority: t.priority,
        source: 'playbook',
        origin_key: t.key,
        agent_run_id: options.agentRunId ?? null,
        due_at: t.dueInHours
          ? new Date(now.getTime() + t.dueInHours * 3_600_000).toISOString()
          : null,
      })),
  );

  return { documents: documents.length, milestones: milestones.length, tasks: tasks.length };
}
