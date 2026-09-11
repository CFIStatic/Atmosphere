import { createApp } from './app.js';
import { listenHost, resolveWorkerRole, shouldRunSoldPathWorkers } from './bootFlags.js';
import { config } from './config.js';
import { startProofAnalysisSweep, stopProofAnalysisSweep } from './shared/proofAnalysisSweep.js';
import { startProofPurgeSweep, stopProofPurgeSweep } from './shared/proofPurgeSweep.js';
import { startSoldPathOutboxWorkers, stopSoldPathOutboxWorkers } from './shared/soldPathOutbox.js';
import { assertProductionReady } from './lib/productionGuards.js';
import { initSentry } from './lib/sentry.js';
import { startVerificationLeaseSweep, stopVerificationLeaseSweep } from './verification/reclaim.js';
import { askProviderLabel } from './lib/askModel.js';
import { visionProviderLabel } from './lib/visionProvider.js';
import { logger } from './lib/logger.js';

try {
  assertProductionReady();
} catch (err) {
  logger.error('boot_aborted', {
    detail: err instanceof Error ? err.message : String(err),
  });
  throw err;
}

initSentry();

const workerRole = resolveWorkerRole();
const runSoldPathWorkers = shouldRunSoldPathWorkers(workerRole);
const app = createApp();

const host = listenHost();
const server = app.listen(config.port, host, () => {
  logger.info('listening', {
    host,
    port: config.port,
    supabaseUrl: config.supabase.url,
    origins: config.frontendOrigins,
    mediaBackend: config.media.backend,
    ask: askProviderLabel(),
    vision: visionProviderLabel(),
    workerRole,
    mode: config.isProduction ? 'production' : 'development',
  });

  // Sold-path outbox. Default (WORKER_ROLE=all) runs in this process.
  // WORKER_ROLE=http skips claiming so a dedicated queue replica can drain.
  if (runSoldPathWorkers) {
    startProofAnalysisSweep();
    startProofPurgeSweep();
    startVerificationLeaseSweep();
    startSoldPathOutboxWorkers();
  }
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    // Subsystems that hold resources the process should not simply drop.
    stopVerificationLeaseSweep();
    stopProofAnalysisSweep();
    stopProofPurgeSweep();
    stopSoldPathOutboxWorkers();
    server.close(() => process.exit(0));
  });
}
