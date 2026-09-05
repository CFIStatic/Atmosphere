import { createApp } from './app.js';
import { listenHost } from './bootFlags.js';
import { config } from './config.js';
import { connections } from './estimator/mitigation/xactimate/index.js';
import { startScheduler, stopScheduler } from './pm/scheduler.js';
import { startProofAnalysisSweep, stopProofAnalysisSweep } from './shared/proofAnalysisSweep.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';
import {
  startCaptureAgent,
  stopCaptureAgent,
} from './estimator/mitigation/capture/scheduler.js';
import { startCyberScheduler, stopCyberScheduler } from './cyber/index.js';
import { agentHub } from './computer/agentHub.js';
import { assertProductionReady } from './lib/productionGuards.js';
import { leftoverSurfaceSummary, resolveLeftoverSurfaces } from './lib/platformSurfaces.js';
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

const leftover = resolveLeftoverSurfaces();
const app = createApp({ leftoverSurfaces: leftover });

const host = listenHost();
const server = app.listen(config.port, host, () => {
  logger.info('listening', {
    host,
    port: config.port,
    supabaseUrl: config.supabase.url,
    origins: config.frontendOrigins,
    xactimateDriver: config.xactimate.driver,
    mediaBackend: config.media.backend,
    computerUse: leftover.computer && config.computerUse.enabled,
    captureAgent: leftover.estimator && config.estimator.captureAgent.enabled,
    cyber: leftover.cyber && config.cyber.enabled,
    leftoverSurfaces: leftoverSurfaceSummary(leftover),
    ask: askProviderLabel(),
    vision: visionProviderLabel(),
    mode: config.isProduction ? 'production' : 'development',
  });

  // Opt-in leftover automation. Production keeps these off unless
  // ENABLE_PLATFORM_APIS / ENABLE_<SURFACE> is set — see platformSurfaces.ts.
  if (leftover.pm) startScheduler();

  // Filed videos that never got a reading — including clips uploaded before
  // the analysis queues existed — get vision + speech so Ask has a record.
  startProofAnalysisSweep();

  if (leftover.estimator) startCaptureAgent();

  if (leftover.backups) startBackupScheduler();

  if (leftover.cyber) startCyberScheduler();

  startVerificationLeaseSweep();
});

// Computer-use agents connect over WebSocket on the same port, so they inherit
// the deployment's TLS and hostname instead of needing a second exposed
// service. The hub only claims the upgrade for its own path.
if (leftover.computer && config.computerUse.enabled) {
  agentHub.attach(server);
}

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    // Subsystems that hold resources the process should not simply drop.
    stopScheduler();
    stopVerificationLeaseSweep();
    stopProofAnalysisSweep();
    stopCaptureAgent();
    stopBackupScheduler();
    stopCyberScheduler();
    agentHub.close();
    void connections
      .closeAll()
      .catch(() => undefined)
      .finally(() => server.close(() => process.exit(0)));
  });
}
