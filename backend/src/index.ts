import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.port, () => {
   
  console.log(
    `[atmosphere-backend] listening on http://localhost:${config.port}\n` +
      `  → Supabase URL: ${config.supabase.url}\n` +
      `  → Allowed origins: ${config.frontendOrigins.join(', ')}\n` +
      `  → Mode: ${config.isProduction ? 'production' : 'development'}`,
  );
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
     
    console.log(`\n[atmosphere-backend] received ${signal}, shutting down…`);
    server.close(() => process.exit(0));
  });
}
