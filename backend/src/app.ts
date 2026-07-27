import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { pmRouter } from './routes/pm.js';
import { aiRouter } from './routes/ai.js';
import { crmRouter } from './routes/crm.js';
import { backupRouter } from './routes/backups.js';
import { integrationsRouter } from './routes/integrations.js';
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

  // Body + cookie parsing.
  //
  // CRM writes are bigger than an auth payload but still small, so the cap
  // stays tight everywhere except the one route that takes a whole spreadsheet.
  // The parser is CHOSEN here rather than stacked on that route: the first
  // json() to run consumes the stream, so a route-level raise would never be
  // reached — the global cap would already have rejected the upload with 413.
  const csvImportPath = /^\/api\/integrations\/sources\/[^/]+\/import\/?$/;
  const standardJson = express.json({ limit: '256kb' });
  const csvImportJson = express.json({ limit: '12mb' });

  app.use((req, res, next) => {
    const parse = csvImportPath.test(req.path) ? csvImportJson : standardJson;
    parse(req, res, next);
  });

  app.use(cookieParser());

  // Routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  // The PM router parses its own bodies with a larger limit — a full moisture
  // log for one visit does not fit in the 10kb global cap.
  app.use('/api/pm', pmRouter);
  // Task execution carries whole job files and documents, so it needs a much
  // larger body limit than the auth routes. Mounted with its own parser rather
  // than raising the global cap, which would widen the DoS surface on every
  // unauthenticated endpoint.
  app.use('/api/ai', express.json({ limit: '2mb' }), aiRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/backups', backupRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/computer', computerRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
