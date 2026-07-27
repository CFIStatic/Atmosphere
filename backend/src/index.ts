import { createApp } from './app.js';
import { config } from './config.js';
import { connections } from './estimator/mitigation/xactimate/index.js';
import { startScheduler, stopScheduler } from './pm/scheduler.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';
import { agentHub } from './computer/agentHub.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Xactimate driver: ${config.xactimate.driver}\n` +
      `  → Computer use: ${config.computerUse.enabled ? `on (${config.computerUse.defaultModel})` : 'off'}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );

  // Opt-in background automation. No-ops unless PM_SCHEDULER_ENABLED is set and
  // a service-role key is configured — see backend/src/pm/scheduler.ts for why
  // it takes two decisions rather than one.
  startScheduler();

  // Started after the listener so a backup can never delay readiness.
  startBackupScheduler();
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
    // eslint-disable-next-line no-console
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    // Three subsystems hold resources the process should not simply drop. The
    // scheduler and the agent hub stop synchronously; the Xactimate teardown is
    // asynchronous — a browser-driver session owns a real Chromium process and
    // an in-memory credential — so the port is closed only once it settles.
    stopScheduler();
    stopBackupScheduler();
    agentHub.close();
    void connections
      .closeAll()
      .catch(() => undefined)
      .finally(() => server.close(() => process.exit(0)));
  });
}
