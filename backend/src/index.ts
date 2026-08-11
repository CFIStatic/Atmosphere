import { createApp } from './app.js';
import { config } from './config.js';
import { connections } from './estimator/mitigation/xactimate/index.js';
import { startScheduler, stopScheduler } from './pm/scheduler.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';
import {
  startCaptureAgent,
  stopCaptureAgent,
} from './estimator/mitigation/capture/scheduler.js';
import { startCyberScheduler, stopCyberScheduler } from './cyber/index.js';
import { agentHub } from './computer/agentHub.js';
import { assertProductionReady } from './lib/productionGuards.js';
import { logger } from './lib/logger.js';

assertProductionReady();

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('listening', {
    port: config.port,
    supabaseUrl: config.supabase.url,
    origins: config.frontendOrigins,
    xactimateDriver: config.xactimate.driver,
    mediaBackend: config.media.backend,
    computerUse: config.computerUse.enabled,
    captureAgent: config.estimator.captureAgent.enabled,
    cyber: config.cyber.enabled,
    mode: config.isProduction ? 'production' : 'development',
  });

  // Opt-in background automation. No-ops unless PM_SCHEDULER_ENABLED is set and
  // a service-role key is configured — see backend/src/pm/scheduler.ts for why
  // it takes two decisions rather than one.
  startScheduler();

  // Mitigation capture agent — on by default. Pulls MICA Dash / Outlook and
  // rewrites open estimates without a human sync click.
  startCaptureAgent();

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
    // Subsystems that hold resources the process should not simply drop.
    stopScheduler();
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
