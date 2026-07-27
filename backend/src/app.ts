import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { billingRouter } from './routes/billing.js';
import { usageRouter } from './routes/usage.js';
import { aiRouter } from './routes/ai.js';
import { webhookRouter } from './routes/webhooks.js';
import { computerRouter } from './routes/computer.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Behind a proxy/load balancer (needed for correct secure-cookie + rate-limit IP).
  app.set('trust proxy', 1);

  // Security headers.
  app.use(helmet());

  // CORS — allow the configured frontend origins with credentials (cookies).
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / server-to-server / curl (no Origin header).
        if (!origin || config.frontendOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // Stripe signs the exact bytes it sent, so this route must see the raw body.
  // Mounted before any JSON parser — once express.json() has consumed the
  // stream, the signature can no longer be verified.
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }));

  // Model prompts are far larger than any other payload here, so /api/ai gets
  // its own cap. Mounted first: body-parser skips a request whose body is
  // already parsed, so the 10kb default below never truncates a prompt.
  app.use('/api/ai', express.json({ limit: '2mb' }));

  // Body + cookie parsing (with a small JSON size cap).
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // Routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/usage', usageRouter);
  app.use('/api/ai', aiRouter);
  // Server-to-server: no session cookie, authenticated by Stripe's signature.
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/computer', computerRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
