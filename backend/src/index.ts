import { createApp } from './app.js';
import { config } from './config.js';
import { connections } from './estimator/xactimate/index.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Xactimate driver: ${config.xactimate.driver}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );
});

// Graceful shutdown.
//
// Xactimate sessions are closed first and deliberately: a browser-driver session
// owns a real Chromium process, and an in-memory credential should not outlive
// the request it was for. Both are torn down before the process exits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    void connections
      .closeAll()
      .catch(() => undefined)
      .finally(() => server.close(() => process.exit(0)));
  });
}
