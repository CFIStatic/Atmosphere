import { config } from '../../../config.js';
import { createAdminClient } from '../../../lib/supabase.js';
import { runCaptureAgentPass } from './agent.js';

/**
 * Background capture agent.
 *
 * Mirrors the PM scheduler posture: a timer has no user session, so it runs
 * with the service-role key. On an agent platform this pass is *on by default*
 * — drying reports arrive in MICA Dash and Outlook whether or not someone is
 * staring at the estimator UI, and the estimate must move with them.
 *
 * Disable with CAPTURE_AGENT_ENABLED=false. Without SUPABASE_SERVICE_ROLE_KEY
 * the agent will not start (same dual gate as PM).
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function sweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const admin = createAdminClient();
    if (!admin) return;

    const pass = await runCaptureAgentPass(admin);
    if (pass.jobsUpdated || pass.visitsImported || pass.errors.length) {
      console.log(
        `[capture-agent] pass: ${pass.jobsConsidered} job(s), ` +
          `${pass.visitsImported} visit(s) imported, ` +
          `${pass.jobsUpdated} estimate(s) updated, ` +
          `${pass.errors.length} error(s)`,
      );
    }
  } catch (err) {
    console.warn('[capture-agent] scheduled pass failed:', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startCaptureAgent(): void {
  if (!config.estimator.captureAgent.enabled) {
    console.log('[capture-agent] disabled (CAPTURE_AGENT_ENABLED=false)');
    return;
  }

  const admin = createAdminClient();
  if (!admin) {
    console.warn(
      '[capture-agent] enabled but SUPABASE_SERVICE_ROLE_KEY is not set — ' +
        'the background agent will not run. Webhook / on-demand capture still works under a user session.',
    );
    return;
  }

  const intervalMs = config.estimator.captureAgent.intervalMinutes * 60_000;
  console.log(
    `[capture-agent] watching open mitigation jobs every ${config.estimator.captureAgent.intervalMinutes} min ` +
      `(sources: ${config.estimator.captureAgent.sources.join(', ')}; service-role)`,
  );

  // Delay the first sweep so boot does not pile on while the process warms up.
  timer = setTimeout(() => {
    void sweep();
    timer = setInterval(() => void sweep(), intervalMs);
    timer.unref?.();
  }, 20_000);
  timer.unref?.();
}

export function stopCaptureAgent(): void {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}

/** Exposed for tests / operator "run now" without waiting for the interval. */
export async function runCaptureAgentNow(): Promise<void> {
  await sweep();
}
