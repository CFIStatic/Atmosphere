import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { profileRouter } from './routes/profile.js';
import { auditRouter } from './routes/audit.js';
import { jobsRouter } from './routes/jobs.js';
import { memoryRouter } from './routes/memory.js';
import { technicianRouter } from './routes/technician.js';
import { billingRouter } from './routes/billing.js';
import { usageRouter } from './routes/usage.js';
import { pmRouter } from './routes/pm.js';
import { portalRouter } from './portal/routes.js';
import { webAccessRouter } from './routes/webAccess.js';
import { verifierRouter } from './routes/verifier.js';
import { aiRouter } from './routes/ai.js';
import { modelGatewayRouter } from './routes/modelGateway.js';
import { webhookRouter } from './routes/webhooks.js';
import { crmRouter } from './routes/crm.js';
import { backupRouter } from './routes/backups.js';
import { integrationsRouter } from './routes/integrations.js';
import { computerRouter } from './routes/computer.js';
import { estimatorRouter } from './routes/estimator.js';
import { healthRouter } from './routes/health.js';
import { mitigationRouter } from './routes/mitigation.js';
import { xactimateRouter } from './routes/xactimate.js';
import { salesRouter } from './routes/sales.js';
import { emailMarketingRouter } from './routes/emailMarketing.js';
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

  // Stripe signs the exact bytes it sent, so this route must see the raw body.
  // Mounted before any JSON parser — once a parser has consumed the stream the
  // signature can no longer be verified. (The chooser below then skips it:
  // body-parser leaves an already-parsed request alone.)
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }));
  // Same posture for @atmosphere mention bridges (iMessage / WhatsApp / Signal).
  app.use(
    '/api/webhooks/atmosphere-mention',
    express.raw({ type: 'application/json', limit: '1mb' }),
  );

  // Body + cookie parsing.
  //
  // CRM writes are bigger than an auth payload but still small, so the cap
  // stays tight everywhere except the routes that legitimately carry more: a
  // whole spreadsheet on CSV import, a model prompt on /api/ai or /api/model, a
  // pasted mitigation estimate (a whole-house Xactimate export) on the
  // construction estimator, and a DocuSketch scan plus a MICA drying log on
  // /api/mitigation.
  //
  // The parser is CHOSEN here rather than stacked on those routes: the first
  // json() to run consumes the stream, so a route-level raise would never be
  // reached — the global cap would already have rejected the upload with 413.
  // Every raised limit therefore has to be declared in this one place.
  //
  // A Web Access data-entry run carries the rows to be entered, which is more
  // than a login form's worth of JSON but comfortably inside the 256kb
  // standard, so it needs no exception of its own.
  const csvImportPath = /^\/api\/integrations\/sources\/[^/]+\/import\/?$/;
  const bulkTextPath = /^\/api\/(ai|model|estimator)(\/|$)/;
  const mitigationPath = /^\/api\/mitigation(\/|$)/;
  const standardJson = express.json({ limit: '256kb' });
  const csvImportJson = express.json({ limit: '12mb' });
  const bulkTextJson = express.json({ limit: '2mb' });
  // The mitigation estimator takes raw vendor exports rather than pasted text,
  // so its ceiling is an order of magnitude above the others'.
  const mitigationJson = express.json({ limit: '8mb' });

  app.use((req, res, next) => {
    const parse = csvImportPath.test(req.path)
      ? csvImportJson
      : mitigationPath.test(req.path)
        ? mitigationJson
        : bulkTextPath.test(req.path)
          ? bulkTextJson
          : standardJson;
    parse(req, res, next);
  });

  app.use(cookieParser());

  // Routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/mitigation', mitigationRouter);
  app.use('/api/xactimate', xactimateRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/memory', memoryRouter);
  app.use('/api/technician', technicianRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/usage', usageRouter);
  // Two different subsystems, two namespaces: /api/ai is the learning layer's
  // task execution, /api/model is the metered gateway that bills a raw model
  // call. Co-mounting them would run requireAuth twice on every metered call.
  // Neither takes a route-level json() — the chooser above already parsed the
  // body, so one here would never run.
  app.use('/api/ai', aiRouter);
  app.use('/api/model', modelGatewayRouter);
  // Server-to-server: no session cookie, authenticated by Stripe's signature.
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/pm', pmRouter);
  // HomeOwner Report: staff management + tokenized guest access.
  app.use('/api/portal', portalRouter);
  app.use('/api/web-access', webAccessRouter);
  app.use('/api/verifier', verifierRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/backups', backupRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/computer', computerRouter);
  app.use('/api/estimator', estimatorRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/email-marketing', emailMarketingRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
