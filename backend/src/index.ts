import { createApp } from './app.js';
import { listenHost } from './bootFlags.js';
import { config } from './config.js';
import { startScheduler, stopScheduler } from './pm/scheduler.js';
import { startProofAnalysisSweep, stopProofAnalysisSweep } from './shared/proofAnalysisSweep.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';
import { startCyberScheduler, stopCyberScheduler } from './cyber/index.js';
import { agentHub } from './computer/agentHub.js';
import { assertProductionReady } from './lib/productionGuards.js';
import { logger } from './lib/logger.js';

try {
  assertProductionReady();
} catch (err) {
  logger.error('boot_aborted', {
    detail: err instanceof Error ? err.message : String(err),
  });
  throw err;
}

const app = createApp();

const host = listenHost();
const server = app.listen(config.port, host, () => {
  logger.info('listening', {
    host,
    port: config.port,
    supabaseUrl: config.supabase.url,
    origins: config.frontendOrigins,
    mediaBackend: config.media.backend,
    computerUse: config.computerUse.enabled,
    cyber: config.cyber.enabled,
    mode: config.isProduction ? 'production' : 'development',
  });

  // Opt-in background automation. No-ops unless PM_SCHEDULER_ENABLED is set and
  // a service-role key is configured — see backend/src/pm/scheduler.ts for why
  // it takes two decisions rather than one.
  startScheduler();

  // Filed videos that never got a reading — including clips uploaded before
  // the analysis queues existed — get vision + speech so Ask has a record.
  startProofAnalysisSweep();

  // Started after the listener so a backup can never delay readiness.
  startBackupScheduler();

  // Rotates honeypot credentials and re-audits hardening on a timer. Safe to
  // start without the service role — the agent keeps state in-process.
  startCyberScheduler();
});

// Computer-use agents connect over WebSocket on the same port, so they inherit
// the deployment's TLS and hostname instead of needing a second exposed
// service. The hub only claims the upgrade for its own path.
if (config.computerUse.enabled) {
  agentHub.attach(server);
}

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    stopScheduler();
    stopProofAnalysisSweep();
    stopBackupScheduler();
    stopCyberScheduler();
    agentHub.close();
    server.close(() => process.exit(0));
  });
}
