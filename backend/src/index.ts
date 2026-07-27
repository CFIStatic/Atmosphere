import { createApp } from './app.js';
import { config } from './config.js';
import { startScheduler, stopScheduler } from './pm/scheduler.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );

  // Opt-in background automation. No-ops unless PM_SCHEDULER_ENABLED is set and
  // a service-role key is configured — see backend/src/pm/scheduler.ts for why
  // it takes two decisions rather than one.
  startScheduler();
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    stopScheduler();
    server.close(() => process.exit(0));
  });
}
