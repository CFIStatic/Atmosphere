/**
 * Optional Sentry (or compatible) error sink.
 *
 * No SDK dependency and no invented secrets. When SENTRY_DSN is unset this
 * module is a no-op. When it is set, 5xx / unhandled errors are POSTed to
 * Sentry's store endpoint using the public DSN key.
 *
 * DSN shape: https://<public_key>@<host>/<project_id>
 * Set SENTRY_DSN on the BFF. Set VITE_SENTRY_DSN on the office app.
 */

import { logger } from './logger.js';

export type ParsedSentryDsn = {
  publicKey: string;
  host: string;
  projectId: string;
  storeUrl: string;
};

export function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  const raw = dsn?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const publicKey = decodeURIComponent(url.username || url.password);
    const projectId = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    if (!publicKey || !projectId || !url.host) return null;
    return {
      publicKey,
      host: url.host,
      projectId,
      storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

export function sentryEnabled(env: NodeJS.Dict<string> = process.env): boolean {
  return parseSentryDsn(env.SENTRY_DSN) !== null;
}

type CaptureOpts = {
  requestId?: string;
  path?: string;
  method?: string;
  level?: 'error' | 'warning' | 'info';
};

export async function captureException(
  err: unknown,
  opts: CaptureOpts = {},
  env: NodeJS.Dict<string> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const parsed = parseSentryDsn(env.SENTRY_DSN);
  if (!parsed) return false;

  const error = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: opts.level ?? 'error',
    server_name: env.RAILWAY_SERVICE ?? env.HOSTNAME ?? 'atmosphere-bff',
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? 'development',
    release: env.SENTRY_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA ?? undefined,
    message: error.message,
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: { frames: framesFromStack(error.stack) },
        },
      ],
    },
    tags: {
      requestId: opts.requestId,
      path: opts.path,
      method: opts.method,
    },
  };

  try {
    const res = await fetchImpl(parsed.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          `sentry_client=atmosphere-bff/1.0`,
          `sentry_key=${parsed.publicKey}`,
        ].join(', '),
      },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      logger.warn('sentry_post_failed', { status: res.status, host: parsed.host });
      return false;
    }
    return true;
  } catch (postErr) {
    logger.warn('sentry_post_failed', {
      detail: postErr instanceof Error ? postErr.message : String(postErr),
    });
    return false;
  }
}

function framesFromStack(stack: string | undefined): Array<{ filename?: string; function?: string }> {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1, 21)
    .map((line) => {
      const trimmed = line.trim();
      const match = /at\s+(.+?)\s+\((.+?)\)/.exec(trimmed);
      if (match) return { function: match[1], filename: match[2] };
      return { filename: trimmed };
    });
}

let hooked = false;

export function initSentry(env: NodeJS.Dict<string> = process.env): boolean {
  const parsed = parseSentryDsn(env.SENTRY_DSN);
  if (!parsed) return false;
  if (hooked) return true;
  hooked = true;

  process.on('unhandledRejection', (reason) => {
    void captureException(reason, { level: 'error' }, env);
  });
  process.on('uncaughtException', (err) => {
    void captureException(err, { level: 'error' }, env);
  });

  logger.info('sentry_enabled', { host: parsed.host, projectId: parsed.projectId });
  return true;
}
