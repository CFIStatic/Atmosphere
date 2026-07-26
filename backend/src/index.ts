import { createApp } from './app.js';
import { config } from './config.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup/scheduler.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );

  // Started after the listener so a backup can never delay readiness.
  startBackupScheduler();
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    stopBackupScheduler();
    server.close(() => process.exit(0));
  });
}
