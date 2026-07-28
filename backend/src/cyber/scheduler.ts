import { config } from '../config.js';
import { runAutoPatch } from './autoPatch.js';
import { cyberStore } from './store.js';

/**
 * Background pass for the Cyber Defense Agent.
 *
 * Rotates decoy credentials, expires blocks, audits config, and elevates
 * posture when under attack. Same shape as the backup / PM schedulers: an
 * interval inside the API process, unref'd so it never holds shutdown open.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function cycle(reason: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!config.cyber.enabled || !config.cyber.autoPatch) return;
    const results = runAutoPatch(reason);
    const applied = results.filter((r) => r.applied).length;
    console.log(`[cyber] auto-patch ${reason}: ${applied}/${results.length} applied`);
  } catch (err) {
    console.error('[cyber] auto-patch failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startCyberScheduler(): void {
  if (!config.cyber.enabled) {
    console.log('[cyber] disabled (CYBER_DEFENSE_ENABLED=false)');
    return;
  }

  console.log(
    `[cyber] defense agent on — monitoring=${config.cyber.monitoring} ` +
      `deception=${config.cyber.deception} autoBlock=${config.cyber.autoBlock} ` +
      `autoPatch=${config.cyber.autoPatch}`,
  );

  if (!config.cyber.autoPatch) {
    console.log('[cyber] auto-patch scheduler off (CYBER_AUTO_PATCH=false)');
    return;
  }

  const intervalMs = Math.max(1, config.cyber.patchIntervalMinutes) * 60 * 1000;
  timer = setInterval(() => void cycle('scheduled'), intervalMs);
  timer.unref();

  console.log(`[cyber] auto-patch every ${config.cyber.patchIntervalMinutes} min`);

  // First pass shortly after boot so decoy tokens are not the process-start defaults forever.
  setTimeout(() => void cycle('boot'), 5_000).unref();
}

export function stopCyberScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Manual trigger used by the API "patch now" control. */
export function triggerCyberPatch(reason = 'manual'): ReturnType<typeof runAutoPatch> {
  return runAutoPatch(reason);
}

export function cyberSnapshot() {
  return cyberStore.status({
    enabled: config.cyber.enabled,
    monitoring: config.cyber.monitoring,
    deception: config.cyber.deception,
    autoPatch: config.cyber.autoPatch,
    autoBlock: config.cyber.autoBlock,
  });
}
