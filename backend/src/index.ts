import http from 'node:http';
import {
  createLivenessListener,
  listenHost,
  listenPort,
} from './bootFlags.js';
import { logger } from './lib/logger.js';

/**
 * Bind GET /api/health before importing config or createApp(). Those modules
 * throw when production secrets are missing or a mailbox looks personal.
 * Railway's deploy probe is liveness only — if we abort first, the replica
 * is "service unavailable" for the full healthcheckTimeout (5 minutes) on
 * every Atmosphere APIs deploy.
 */
const host = listenHost();
const port = listenPort();
const liveness = createLivenessListener();
const server = http.createServer(liveness);

let stopBackground = (): void => undefined;

function bind(bindHost: string): void {
  server.removeAllListeners('error');
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (
      bindHost === '::' &&
      (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL')
    ) {
      logger.warn('listen_fallback_ipv4', { detail: err.message });
      bind('0.0.0.0');
      return;
    }
    logger.error('listen_failed', {
      host: bindHost,
      port,
      detail: err.message,
    });
    process.exit(1);
  });
  server.listen({ port, host: bindHost, ipv6Only: false }, () => {
    logger.info('listening', {
      host: bindHost,
      port,
      health: '/api/health',
    });
    void loadApplication();
  });
}

bind(host);

async function loadApplication(): Promise<void> {
  try {
    const { createApp } = await import('./app.js');
    const { config } = await import('./config.js');
    const { connections } = await import('./estimator/mitigation/xactimate/index.js');
    const { startScheduler, stopScheduler } = await import('./pm/scheduler.js');
    const { startBackupScheduler, stopBackupScheduler } = await import(
      './lib/backup/scheduler.js'
    );
    const { startCaptureAgent, stopCaptureAgent } = await import(
      './estimator/mitigation/capture/scheduler.js'
    );
    const { startCyberScheduler, stopCyberScheduler } = await import('./cyber/index.js');
    const { agentHub } = await import('./computer/agentHub.js');
    const { assertProductionReady } = await import('./lib/productionGuards.js');

    const app = createApp();
    server.removeListener('request', liveness);
    server.on('request', app);

    try {
      assertProductionReady();
    } catch (err) {
      logger.error('production_guard_deferred', {
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('application_ready', {
      host,
      port,
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

    // Computer-use agents connect over WebSocket on the same port, so they inherit
    // the deployment's TLS and hostname instead of needing a second exposed
    // service. The hub only claims the upgrade for its own path.
    if (config.computerUse.enabled) {
      agentHub.attach(server);
    }

    stopBackground = () => {
      stopScheduler();
      stopCaptureAgent();
      stopBackupScheduler();
      stopCyberScheduler();
      agentHub.close();
      void connections.closeAll().catch(() => undefined);
    };
  } catch (err) {
    logger.error('boot_app_failed', {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    stopBackground();
    server.close(() => process.exit(0));
  });
}
