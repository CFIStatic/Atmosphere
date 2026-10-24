/** Hourly sweep for payments held too long without release (see disputes.ts). */
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { paymentsGate } from './model.js';
import { sweepStaleHolds } from './disputes.js';

const INTERVAL_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running || !paymentsGate(config.stripe.secretKey).enabled) return;
  running = true;
  try {
    const out = await sweepStaleHolds(unscopedAdminOrNull() ?? requireAdmin());
    if (out.alerted || out.refunded) logger.info('job_payment_hold_sweep', out);
  } catch (err) {
    logger.warn('job_payment_hold_sweep_failed', { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

export function startPaymentHoldSweep(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
}
