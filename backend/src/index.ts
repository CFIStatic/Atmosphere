import { createApp } from './app.js';
import { config } from './config.js';
import { connections } from './estimator/xactimate/index.js';
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
});

// Computer-use agents connect over WebSocket on the same port, so they inherit
// the deployment's TLS and hostname instead of needing a second exposed
// service. The hub only claims the upgrade for its own path.
if (config.computerUse.enabled) {
  agentHub.attach(server);
}

// Graceful shutdown.
//
// Xactimate sessions are closed first and deliberately: a browser-driver session
// owns a real Chromium process, and an in-memory credential should not outlive
// the request it was for. Both are torn down before the process exits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    // Both subsystems own resources the process should not simply drop: the
    // agent hub holds open WebSockets, and a Xactimate browser session owns a
    // real Chromium process plus an in-memory credential. The hub closes
    // synchronously; the Xactimate teardown is awaited before the port does.
    agentHub.close();
    void connections
      .closeAll()
      .catch(() => undefined)
      .finally(() => server.close(() => process.exit(0)));
  });
}
