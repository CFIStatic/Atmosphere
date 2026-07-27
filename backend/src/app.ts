import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { estimatorRouter } from './routes/estimator.js';
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

  // Body + cookie parsing (with a small JSON size cap).
  //
  // The estimator is the one exception: a pasted mitigation estimate is a
  // whole-house Xactimate export, far past 10 kB. It is skipped here and parses
  // its own bodies at a higher limit, so raising the cap for one feature does
  // not widen the request surface everywhere else.
  const jsonParser = express.json({ limit: '10kb' });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/estimator')) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });
  app.use(cookieParser());

  // Routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  // The estimator parses its own bodies — a pasted mitigation estimate is far
  // larger than the 10 kB the rest of the API needs.
  app.use('/api/estimator', estimatorRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
