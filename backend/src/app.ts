import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { webAccessRouter } from './routes/webAccess.js';
import { verifierRouter } from './routes/verifier.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { setRunSucceededHook, setSlotReleasedHook } from './lib/webRunner.js';
import { verificationHook, pumpVerificationQueue } from './lib/verifierRunner.js';

export function createApp(): Express {
  const app = express();

  // Wire the second agent to the first. Web Access does not import the verifier
  // — it calls whatever hook has been registered — so this one line is the
  // whole coupling between them, and removing it leaves runs behaving exactly
  // as they did before the verifier existed.
  setRunSucceededHook(verificationHook);
  // Runs and checks share one browser budget, so a finished run is the moment
  // a waiting check can start.
  setSlotReleasedHook(pumpVerificationQueue);

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
  // Web Access is the one exception: a data-entry run carries the rows to be
  // entered, which legitimately runs to more than a login form's worth of JSON.
  // It is parsed first, with its own larger cap, so the tight limit still
  // applies everywhere else.
  app.use('/api/web-access', express.json({ limit: '256kb' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // Routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/web-access', webAccessRouter);
  app.use('/api/verifier', verifierRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
