import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { analyticsRouter } from './routes/analytics.js';
import { telemetryRouter } from './routes/telemetry.js';
import { profileRouter } from './routes/profile.js';
import { auditRouter } from './routes/audit.js';
import { jobsRouter } from './routes/jobs.js';
import { memoryRouter } from './routes/memory.js';
import { billingRouter } from './routes/billing.js';
import { usageRouter } from './routes/usage.js';
import { meteringRouter } from './routes/metering.js';
import { portalRouter } from './portal/routes.js';
import { webhookRouter } from './routes/webhooks.js';
import { sharedJobsRouter, jobShareRouter } from './routes/sharedJobs.js';
import { placesRouter } from './routes/places.js';
import { episodesRouter } from './routes/episodes.js';
import { evidencePortalRouter, evidenceShareRouter } from './routes/evidencePortal.js';
import { verificationRouter } from './verification/routes.js';
import { progressShareRouter } from './routes/progressShare.js';
import { unsubscribeRouter } from './routes/unsubscribe.js';
import { healthRouter } from './routes/health.js';
import { careersRouter } from './routes/careers.js';
import { contactRouter } from './routes/contact.js';
import { scopeDocsRouter } from './routes/scopeDocs.js';
import { jobIntakeRouter } from './routes/jobIntake.js';
import { fieldIdentityRouter } from './routes/fieldIdentity.js';
import { fieldAppRouter } from './routes/fieldApp.js';
import { mediaVideoRouter } from './routes/mediaVideo.js';
import { mediaCatalogRouter } from './routes/mediaCatalog.js';
import { geometryRouter } from './routes/geometry.js';
import { legalRouter } from './routes/legal.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestLog } from './middleware/requestLog.js';
import { userActivityMonitor } from './middleware/userActivityMonitor.js';
import { forbidden } from './lib/errors.js';
import {
  isAtmosphereCustomAppOrigin,
  isAtmosphereCustomFieldCaptureOrigin,
  isAtmosphereRailwayFieldCaptureOrigin,
  isAtmosphereRailwayInternalOrigin,
  isAtmosphereRailwayWebOrigin,
  isCloudflareQuickTunnelOrigin,
} from './lib/previewOrigins.js';

/**
 * Match a browser Origin against FRONTEND_ORIGIN.
 * In development, treat localhost and 127.0.0.1 as interchangeable — Cursor's
 * preview and some OS stacks use one while .env lists the other.
 * Production also allows the live custom office host
 * (platform.atmosphereteam.com), Field Capture (app.atmosphereteam.com),
 * plus the Atmosphere-web, Atmosphere-internal, and Field Capture Railway
 * hostnames so those SPAs can call /api before FRONTEND_ORIGIN is updated.
 */
function isAllowedFrontendOrigin(origin: string): boolean {
  if (config.frontendOrigins.includes(origin)) return true;
  if (isAtmosphereCustomAppOrigin(origin)) return true;
  if (isAtmosphereCustomFieldCaptureOrigin(origin)) return true;
  if (isAtmosphereRailwayWebOrigin(origin)) return true;
  if (isAtmosphereRailwayInternalOrigin(origin)) return true;
  if (isAtmosphereRailwayFieldCaptureOrigin(origin)) return true;
  if (config.isProduction) return false;

  let alt: string | null = null;
  if (origin.includes('://localhost')) {
    alt = origin.replace('://localhost', '://127.0.0.1');
  } else if (origin.includes('://127.0.0.1')) {
    alt = origin.replace('://127.0.0.1', '://localhost');
  }
  return Boolean(alt && config.frontendOrigins.includes(alt));
}

export function createApp(): Express {
  const app = express();

  // Behind a proxy/load balancer (needed for correct secure-cookie + rate-limit IP).
  app.set('trust proxy', 1);

  // Security headers.
  app.use(helmet());

  // Structured access logs + request ids (before routers so every path is covered).
  app.use(requestLog);
  // Legal monitor: one append-only row per signed-in action. After requestLog
  // so it inherits requestId; before routers so every /api path is watched.
  app.use(userActivityMonitor);

  // Liveness/readiness before CORS and parsers so a platform probe cannot be
  // failed by an Origin check.
  app.use(healthRouter);
  app.use('/api', healthRouter);

  // CORS — allow the configured frontend origins with credentials (cookies).
  // In development, also accept Cloudflare quick-tunnel hosts so cloud-agent /
  // shareable preview URLs can sign in without editing FRONTEND_ORIGIN each time.
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / server-to-server / curl (no Origin header).
        if (!origin || isAllowedFrontendOrigin(origin)) {
          callback(null, true);
          return;
        }
        if (!config.isProduction && isCloudflareQuickTunnelOrigin(origin)) {
          callback(null, true);
          return;
        }
        // Reject the request (do not callback(null, false) — cors would still
        // run the handler). Use HttpError so this is a 403, not a 500.
        callback(forbidden('Origin not allowed', 'cors_origin_denied'));
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
  // The cap stays tight everywhere except the one route that legitimately
  // carries more: a raw phone photo on the way to becoming an avatar.
  //
  // The parser is CHOSEN here rather than stacked on that route: the first
  // json() to run consumes the stream, so a route-level raise would never be
  // reached — the global cap would already have rejected the upload with 413.
  // Every raised limit therefore has to be declared in this one place.
  const avatarPath = /^\/api\/profile\/avatar\/?$/;
  const standardJson = express.json({ limit: '256kb' });
  // A profile photo is small after the client squares it, but a raw phone
  // picture still has to fit the request before that resize is trusted.
  const avatarJson = express.json({ limit: '3mb' });

  app.use((req, res, next) => {
    const parse = avatarPath.test(req.path) ? avatarJson : standardJson;
    parse(req, res, next);
  });

  app.use(cookieParser());

  // Routes. Work Verification and Field Capture only — the office console
  // ships nothing else, and the sales / PM / estimator / CRM / finance /
  // web-access products that used to sit beside these have been removed.
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/legal', legalRouter);
  app.use('/api/telemetry', telemetryRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/memory', memoryRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/usage', usageRouter);
  app.use('/api/metering', meteringRouter);
  // Server-to-server: no session cookie, authenticated by Stripe's signature.
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/operations', scopeDocsRouter);
  app.use('/api/operations', jobIntakeRouter);
  app.use('/api/operations', sharedJobsRouter);
  app.use('/api/operations', placesRouter);
  app.use('/api/episodes', episodesRouter);
  app.use('/api/evidence-portal', evidencePortalRouter);
  // Video work-verification pipeline (extends proof-of-work; async stages).
  app.use('/api/verification', verificationRouter);
  // Outside auth like the job-share routes, and for the same reason: the
  // person holding a Verifier link is an adjuster who never had an account.
  app.use('/api/verifier-share', evidenceShareRouter);
  // Read-only job progress for homeowners, counsel, banks and adjusters — no login.
  app.use('/api/progress-share', progressShareRouter);
  // Outside every auth middleware, like the unsubscribe route and for the same
  // reason: the person clicking is a subcontractor who never had an account,
  // and a shared job record that requires signing in is not shared.
  app.use('/api/job-share', jobShareRouter);
  // HomeOwner Report: staff management + tokenized guest access.
  app.use('/api/portal', portalRouter);
  // Also outside auth, and for a sharper version of the same reason: this is
  // where a subcontractor turns a pile of per-job links from several general
  // contractors into one list. They hold a session of their own, not a seat
  // in anybody's org, so no org middleware could apply.
  app.use('/api/field', fieldIdentityRouter);
  // App Store Field Capture signed in as the same org account as the dashboard.
  app.use('/api/field-app', fieldAppRouter);
  // Any inbound video (proof, field capture, upload) can share one
  // sparse+diversity+dictation pipeline without a job_proofs row.
  app.use('/api/media/video', mediaVideoRouter);
  // Fleet catalog: many ≤24h objects in object storage (hot/warm/cold).
  app.use('/api/media/catalog', mediaCatalogRouter);
  // App Store Field Capture: RoomPlan/ARKit/LiDAR rooms + video → property twin.
  app.use('/api/geometry', geometryRouter);
  // Deliberately outside every auth middleware: the person clicking is a
  // recipient who never had an account, and an unsubscribe link that requires
  // signing in is not one. An old mail still has to work (CAN-SPAM).
  app.use('/api/unsubscribe', unsubscribeRouter);
  app.use('/api/careers', careersRouter);
  app.use('/api/contact', contactRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
