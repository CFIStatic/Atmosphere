import 'dotenv/config';

/**
 * Centralised, validated configuration for the Atmosphere backend.
 *
 * The Supabase URL and the publishable ("anon") key are safe to ship — the anon
 * key is designed to be exposed to browsers and is protected by Row Level
 * Security on the database. They are provided as sensible defaults so the server
 * boots out-of-the-box against the Atmosphere project, but every value can be
 * overridden through environment variables (see .env.example).
 *
 * The SERVICE ROLE key is a server-only secret. It is optional here (the login
 * flows do not require it) and must NEVER be committed or sent to the browser.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

// Development-only convenience defaults. In production these are withheld so a
// deploy that forgets to set env vars FAILS FAST at boot instead of silently
// running against the shared demo project / a localhost CORS origin.
const devOnly = (value: string): string | undefined => (isProduction ? undefined : value);

const frontendOriginRaw = isProduction
  ? required('FRONTEND_ORIGIN')
  : (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173');

// Comma-separated list of allowed browser origins for CORS.
const frontendOrigins = frontendOriginRaw
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),

  frontendOrigins,

  supabase: {
    url: required('SUPABASE_URL', devOnly('https://ccxatzfsvzetciiwsjlj.supabase.co')),
    // Publishable / anon key — safe to expose. Used for all auth operations.
    anonKey: required('SUPABASE_ANON_KEY', devOnly('sb_publishable_4ppzqtXQPeVPuzP8Ant-pQ_MZIPMcGn')),
    // Optional server-only secret for privileged/admin operations. Never exposed.
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },

  cookies: {
    accessTokenName: 'atm_access_token',
    refreshTokenName: 'atm_refresh_token',
    // Access token lives ~1h (matches Supabase JWT); refresh token much longer.
    accessMaxAgeMs: 60 * 60 * 1000, // 1 hour
    refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: isProduction, // require HTTPS in production
    sameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') ?? 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  device: {
    // Long-lived cookie holding "<deviceId>.<secret>" for PIN unlock. It only
    // ever yields a session when combined with the correct PIN, so it can
    // outlive the refresh-token cookie without widening the blast radius.
    cookieName: 'atm_device',
    cookieMaxAgeMs: 180 * 24 * 60 * 60 * 1000, // 180 days

    // Server-only secret mixed into every PIN hash and token-sealing key. It
    // must never reach the database — that separation is what keeps a 4-digit
    // PIN safe against an offline sweep if the database is ever leaked.
    // Rotating it invalidates every enrolled device, which is the desired
    // behaviour for a compromised pepper.
    pepper: required('DEVICE_PEPPER', devOnly('atmosphere-dev-pepper-do-not-use-in-production')),
  },

  // Where the password-reset email sends the user back to. Must also be listed
  // in the Supabase dashboard under Authentication → URL Configuration.
  passwordResetRedirectUrl:
    process.env.PASSWORD_RESET_REDIRECT_URL ?? `${frontendOrigins[0]}/reset-password`,

  xactimate: {
    // Which driver reaches Xactimate. 'mock' is the default deliberately: the
    // whole estimator is exercisable — consent flow, price-list reconciliation,
    // estimate writing — without anyone typing a real Xactimate password into a
    // development machine. Switching this on is a deployment decision, never a
    // per-request one, so a caller cannot talk the server into launching a
    // browser by passing a parameter.
    driver: parseDriver(process.env.XACTIMATE_DRIVER),

    // Verisk partner API. Present only for orgs with an integration agreement;
    // when it is available it is strictly better than browser automation,
    // because it never replays a password.
    apiBaseUrl: process.env.XACTIMATE_API_BASE_URL ?? '',
    apiKey: process.env.XACTIMATE_API_KEY ?? '',

    // Browser automation is off unless explicitly enabled. Whether automating a
    // given Xactimate account is permitted depends on that account's terms with
    // Verisk, which is the account holder's call — so it takes a deliberate act
    // to turn on, not a default.
    webAutomationEnabled: process.env.XACTIMATE_WEB_AUTOMATION === 'true',
    headless: process.env.XACTIMATE_HEADLESS !== 'false',
    // Xactimate Online's DOM is not a public interface. Keeping selectors in
    // config makes a UI change a config edit instead of a redeploy.
    webSelectors: parseJsonRecord(process.env.XACTIMATE_WEB_SELECTORS),

    // Server-only key for the credential vault. Like DEVICE_PEPPER it must never
    // reach the database — that separation is the whole protection, since a
    // password that has to be replayed into a login form cannot be hashed.
    // Unset means at-rest storage is unavailable and users may only connect in
    // session-only mode, which is the safer configuration anyway.
    encryptionKey: process.env.XACTIMATE_ENC_KEY ?? '',
  },
} as const;

function parseDriver(value: string | undefined): 'mock' | 'api' | 'web' {
  return value === 'api' || value === 'web' ? value : 'mock';
}

/** Parse an optional JSON object env var, ignoring anything malformed. */
function parseJsonRecord(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string]),
    );
  } catch {
    return {};
  }
}

export type AppConfig = typeof config;
