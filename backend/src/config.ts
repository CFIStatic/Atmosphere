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

  webAccess: {
    // Both secrets are optional. Without them the feature reports itself as
    // unavailable and every other part of the app carries on unaffected —
    // the same posture as the optional service-role key.
    //
    // The encryption key seals every stored site password (AES-256-GCM) before
    // it reaches Postgres. Keeping it out of the database is what stops a
    // database leak from yielding usable logins for other people's systems.
    encryptionKey: process.env.WEB_ACCESS_KEY ?? devOnly('atmosphere-dev-web-access-key-do-not-use-in-production') ?? '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

    model: process.env.WEB_ACCESS_MODEL ?? 'claude-opus-5',
    // Browser work is agentic and tool-heavy, where higher effort pays for
    // itself in fewer wasted round trips.
    effort: (process.env.WEB_ACCESS_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',

    // A visible browser is useful when developing a new site integration.
    headless: (process.env.WEB_ACCESS_HEADLESS ?? 'true') !== 'false',
    // Set when Chromium lives somewhere Playwright will not find on its own.
    browserExecutablePath: process.env.WEB_ACCESS_BROWSER_PATH || undefined,

    // Hard stops. A stuck run must cost a bounded amount of money and time.
    maxSteps: Number(process.env.WEB_ACCESS_MAX_STEPS ?? 30),
    runTimeoutMs: Number(process.env.WEB_ACCESS_RUN_TIMEOUT_MS ?? 5 * 60 * 1000),
    navigationTimeoutMs: Number(process.env.WEB_ACCESS_NAV_TIMEOUT_MS ?? 30 * 1000),
    // Browsers are heavy; refuse work rather than exhaust the host.
    maxConcurrentRuns: Number(process.env.WEB_ACCESS_MAX_CONCURRENT_RUNS ?? 2),

    // Escape hatch for developing against a site running on your own machine.
    // Ignored in production, where reaching a private address is the SSRF the
    // guard exists to stop.
    allowPrivateAddresses: !isProduction && process.env.WEB_ACCESS_ALLOW_PRIVATE === 'true',

    // Hosts the AI may visit in addition to the connection's own site. Sites
    // that hand off to an identity provider need it listed here.
    extraAllowedHosts: (process.env.WEB_ACCESS_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  },
} as const;

/**
 * Web Access needs a key to seal credentials with and a model to drive the
 * browser. Missing either one, the routes stay reachable but report the
 * feature as unavailable instead of failing mid-run.
 */
export const webAccessEnabled = Boolean(
  config.webAccess.encryptionKey && config.webAccess.anthropicApiKey,
);

export type AppConfig = typeof config;
