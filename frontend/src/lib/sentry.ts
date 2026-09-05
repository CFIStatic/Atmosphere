/**
 * Optional Sentry (or compatible) error sink for the office app.
 *
 * No SDK and no invented secrets. When VITE_SENTRY_DSN is unset this module
 * is a no-op. When it is set, window errors POST to Sentry's store endpoint
 * using the public DSN key.
 *
 * DSN shape: https://<public_key>@<host>/<project_id>
 */

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

export async function reportOfficeException(
  err: unknown,
  dsn = import.meta.env.VITE_SENTRY_DSN,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return false;

  const error = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env.MODE,
    message: error.message,
    exception: {
      values: [{ type: error.name, value: error.message }],
    },
    tags: { surface: 'office' },
  };

  try {
    const res = await fetchImpl(parsed.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          'sentry_client=atmosphere-office/1.0',
          `sentry_key=${parsed.publicKey}`,
        ].join(', '),
      },
      body: JSON.stringify(event),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let hooked = false;

export function initOfficeSentry(dsn = import.meta.env.VITE_SENTRY_DSN): boolean {
  if (!parseSentryDsn(dsn) || hooked) return Boolean(parseSentryDsn(dsn));
  hooked = true;
  window.addEventListener('error', (event) => {
    void reportOfficeException(event.error ?? event.message, dsn);
  });
  window.addEventListener('unhandledrejection', (event) => {
    void reportOfficeException(event.reason, dsn);
  });
  return true;
}
