/**
 * Sentry error tracking for the BFF (@sentry/node).
 *
 * No-op unless SENTRY_DSN is set. Initialised from src/instrument.ts, which
 * index.ts imports first so the SDK is up before Express and the rest load.
 *
 * Privacy: sendDefaultPii is off, and beforeSend / beforeSendTransaction strip
 * auth headers, cookies, query strings and anything that looks like a token
 * before an event leaves the process.
 */

import * as Sentry from '@sentry/node';
import { logger } from './logger.js';

export type ParsedSentryDsn = {
  publicKey: string;
  host: string;
  projectId: string;
};

export function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  const raw = dsn?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const publicKey = decodeURIComponent(url.username || url.password);
    const projectId = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    if (!publicKey || !projectId || !url.host) return null;
    return { publicKey, host: url.host, projectId };
  } catch {
    return null;
  }
}

export function sentryEnabled(env: NodeJS.Dict<string> = process.env): boolean {
  return parseSentryDsn(env.SENTRY_DSN) !== null;
}

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|x-auth-token|x-supabase-auth|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|client[-_]?secret|password|passwd|code|otp|session|stripe-signature|x-twilio-signature|svix-signature)$/i;
const SENSITIVE_SUBSTR = /(token|secret|password|authorization|cookie|signature|api[-_]?key|session)/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const FILTERED = '[Filtered]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_SUBSTR.test(key);
}

export function scrubString(value: string): string {
  return value.replace(BEARER, '$1 [Filtered]').replace(JWT, FILTERED);
}

/** Deep-copy `value`, replacing sensitive keys and token-looking strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return FILTERED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? FILTERED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

type ScrubbableEvent = {
  request?: object;
  user?: unknown;
  extra?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
};

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    const req = event.request as Record<string, unknown>;
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (typeof req.url === 'string') req.url = req.url.split('?')[0];
    if (req.headers) req.headers = scrubValue(req.headers);
  }
  delete event.user;
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  if (event.breadcrumbs) event.breadcrumbs = scrubValue(event.breadcrumbs);
  if (typeof event.message === 'string') event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  }
  return event;
}

let initialised = false;

export function initSentry(env: NodeJS.Dict<string> = process.env): boolean {
  const parsed = parseSentryDsn(env.SENTRY_DSN);
  if (!parsed) return false;
  if (initialised) return true;
  initialised = true;

  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE);
  Sentry.init({
    dsn: env.SENTRY_DSN!.trim(),
    environment: env.SENTRY_ENVIRONMENT ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? 'development',
    release: env.SENTRY_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA ?? undefined,
    serverName: env.RAILWAY_SERVICE_NAME ?? env.HOSTNAME ?? 'atmosphere-bff',
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.1,
    // The default OnUncaughtException / OnUnhandledRejection integrations
    // capture both, flush, and (for uncaught exceptions) exit like Node does.
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => {
      if (crumb.data) crumb.data = scrubValue(crumb.data) as typeof crumb.data;
      if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message);
      return crumb;
    },
  });

  logger.info('sentry_enabled', { host: parsed.host, projectId: parsed.projectId });
  return true;
}

type CaptureOpts = {
  requestId?: string;
  path?: string;
  method?: string;
  level?: 'error' | 'warning' | 'info';
};

/** Report an error. Returns false (and does nothing) when Sentry is off. */
export function captureException(err: unknown, opts: CaptureOpts = {}): boolean {
  if (!initialised) return false;
  Sentry.withScope((scope) => {
    scope.setLevel(opts.level ?? 'error');
    if (opts.requestId) scope.setTag('requestId', opts.requestId);
    if (opts.path) scope.setTag('path', opts.path);
    if (opts.method) scope.setTag('method', opts.method);
    Sentry.captureException(err);
  });
  return true;
}

export { Sentry };
