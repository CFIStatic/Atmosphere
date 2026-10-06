/**
 * Daily practice schedule, inside the APIs service (no new Railway service):
 * a 10-minute tick that starts the day's practice suite once the UTC hour
 * reaches COMPUTER_PRACTICE_HOUR_UTC. One row per task per day (a unique
 * claim) keeps it single-run even with more than one replica.
 *
 * Off unless COMPUTER_PRACTICE_ENABLED=1 and COMPUTER_PRACTICE_ORG_ID is set.
 */
import { logger } from '../../../lib/logger.js';
import { computerIqStore } from '../../worker.js';
import { PRACTICE_TASKS } from './catalog.js';
import { failStalePracticeRuns, practiceOrgId, runPracticeSuite, utcDate } from './runner.js';

export function practiceSchedule(): { enabled: boolean; orgId: string | null; hourUtc: number } {
  const hour = Number.parseInt(process.env.COMPUTER_PRACTICE_HOUR_UTC ?? '10', 10);
  const orgId = practiceOrgId();
  return {
    enabled: (process.env.COMPUTER_PRACTICE_ENABLED ?? '').trim() === '1' && Boolean(orgId),
    orgId,
    hourUtc: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 10,
  };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** One scheduler tick. Exported for tests. */
export async function practiceTick(now = Date.now()): Promise<'off' | 'early' | 'busy' | 'done' | 'ran'> {
  const cfg = practiceSchedule();
  if (!cfg.enabled || !cfg.orgId) return 'off';
  if (new Date(now).getUTCHours() < cfg.hourUtc) return 'early';
  if (running) return 'busy';
  const iq = computerIqStore();
  if (!iq) return 'off';
  running = true;
  try {
    await failStalePracticeRuns(iq, now).catch(() => 0);
    const today = utcDate(now);
    const done = new Set((await iq.listPracticeRuns(today)).filter((r) => r.org_id === cfg.orgId && r.run_date === today).map((r) => r.task_key));
    const todo = PRACTICE_TASKS.filter((t) => !done.has(t.key)).map((t) => t.key);
    if (!todo.length) return 'done';
    logger.info('computer practice run starting', { tasks: todo.length });
    await runPracticeSuite({ orgId: cfg.orgId, runDate: today, keys: todo });
    return 'ran';
  } finally {
    running = false;
  }
}

export function startPracticeScheduler(intervalMs = 10 * 60_000): () => void {
  if (timer) return stopPracticeScheduler;
  const tick = () => {
    void practiceTick().catch((err) => logger.warn('computer practice tick failed', { error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 60_000).unref?.();
  return stopPracticeScheduler;
}

export function stopPracticeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
