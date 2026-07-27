import { createApp } from './app.js';
import { config } from './config.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';
import { agentHub } from './computer/agentHub.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Computer use: ${config.computerUse.enabled ? `on (${config.computerUse.defaultModel})` : 'off'}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );

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
    stopBackupScheduler();
    agentHub.close();
    server.close(() => process.exit(0));
  });
}
