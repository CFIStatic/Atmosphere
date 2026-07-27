import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { runEngine } from './engine.js';

/**
 * The background pass.
 *
 * **This is the one place in the Project Manager Agent where the service-role
 * key touches data, and it is off by default.**
 *
 * Everywhere else the engine runs inside somebody's session, under their JWT,
 * seeing exactly what they can see — that is the security posture the rest of
 * this codebase holds to, and it is why the on-demand path needs no special
 * privileges. A timer has no session, so a background pass necessarily runs as
 * a privileged client with RLS bypassed.
 *
 * That trade is worth making only deliberately, so it takes two explicit
 * decisions to switch on: `PM_SCHEDULER_ENABLED=true` *and* a configured
 * `SUPABASE_SERVICE_ROLE_KEY`. With either missing the scheduler simply does
 * not start, and the agent still works — it evaluates whenever a project
 * manager opens the app, which for most shops is every morning anyway.
 *
 * What the background pass buys you is the case the on-demand path cannot
 * cover: catching a missed reading on a day nobody happened to log in.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Orgs to sweep. Read under the admin client, which is the point of the mode. */
async function listOrgIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from('pm_automation_settings')
    .select('org_id')
    .eq('enabled', true)
    .limit(1000);
  if (error) {
    console.warn('[pm] scheduler could not list organizations:', error.message);
    return [];
  }
  return (data ?? []).map((r) => r.org_id as string);
}

async function sweep(admin: SupabaseClient): Promise<void> {
  // Overlapping sweeps would double-count alert occurrences and waste work.
  if (running) return;
  running = true;

  try {
    const orgIds = await listOrgIds(admin);
    if (!orgIds.length) return;

    for (const orgId of orgIds) {
      try {
        const result = await runEngine(admin, orgId, {
          actorType: 'schedule',
          actorLabel: 'Scheduled automation pass',
        });
        if (result.alertsOpened || result.alertsCleared || result.tasksCreated) {
          console.log(
            `[pm] ${orgId}: ${result.alertsOpened} new alert(s), ${result.alertsCleared} cleared, ${result.tasksCreated} task(s) created`,
          );
        }
      } catch (err) {
        // One org's bad data must not stop the sweep for everyone else.
        console.warn(`[pm] scheduled pass failed for org ${orgId}:`, (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (!config.pm.schedulerEnabled) return;

  const admin = createAdminClient();
  if (!admin) {
    console.warn(
      '[pm] PM_SCHEDULER_ENABLED is set but SUPABASE_SERVICE_ROLE_KEY is not — the background pass will not run. The agent still evaluates on demand.',
    );
    return;
  }

  const intervalMs = config.pm.schedulerIntervalMinutes * 60_000;
  console.log(
    `[pm] background automation pass every ${config.pm.schedulerIntervalMinutes} minutes (service-role; RLS bypassed)`,
  );

  // Delay the first sweep so a boot or a deploy restart does not immediately
  // hammer the database while the rest of the process is still warming up.
  timer = setTimeout(() => {
    void sweep(admin);
    timer = setInterval(() => void sweep(admin), intervalMs);
    timer.unref?.();
  }, 30_000);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}
