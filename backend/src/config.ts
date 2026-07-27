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

  estimator: {
    // Server-only key that encrypts third-party credentials (DocuSketch, Dash,
    // Xactimate) before they are written to Postgres. Deliberately NOT in the
    // database: RLS decides who may read a row, this key decides whether the
    // bytes in that row mean anything. A database leak alone yields ciphertext.
    // Generate with:  openssl rand -base64 32
    credentialKey: process.env.ESTIMATOR_CREDENTIAL_KEY ?? '',

    // Anthropic API key for photo analysis and note reading. Without it the
    // estimator still runs — vision stages are skipped and the scope is built
    // from DocuSketch measurements and the mitigation estimate alone.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ESTIMATOR_MODEL ?? 'claude-opus-5',
    // `low` | `medium` | `high` | `xhigh` | `max`. Photo analysis is a
    // perception task with a fixed output shape, so `medium` is the balance
    // point; raise it if observations come back under-specified.
    effort: (process.env.ESTIMATOR_EFFORT ?? 'medium') as
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | 'max',

    // Vendor API roots. Every integrator's tenant lives somewhere different
    // (regional hosts, on-prem Dash, Xactimate vs XactAnalysis), so these are
    // configuration rather than constants. Leave one unset and that connector
    // reports itself unconfigured instead of guessing at a URL.
    docusketchBaseUrl: process.env.DOCUSKETCH_BASE_URL ?? '',
    dashBaseUrl: process.env.DASH_BASE_URL ?? '',
    xactimateBaseUrl: process.env.XACTIMATE_BASE_URL ?? '',

    // `live` talks to the vendors; `sandbox` serves deterministic fixtures so
    // the whole pipeline can be exercised end-to-end without credentials.
    connectorMode: (process.env.ESTIMATOR_CONNECTOR_MODE ??
      (isProduction ? 'live' : 'sandbox')) as 'live' | 'sandbox',

    // Cap on photos sent to the vision model per run. Each full-resolution
    // photo can cost ~4.8k input tokens, so this is the main cost lever.
    maxPhotosPerRun: Number(process.env.ESTIMATOR_MAX_PHOTOS ?? 40),
    // Photos are analysed in small concurrent batches — large enough to keep
    // latency down, small enough to stay inside per-minute token limits.
    photoConcurrency: Number(process.env.ESTIMATOR_PHOTO_CONCURRENCY ?? 4),

    // Outbound HTTP budget for a single vendor call, and how many times a
    // transient failure is retried before the stage gives up.
    requestTimeoutMs: Number(process.env.ESTIMATOR_REQUEST_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(process.env.ESTIMATOR_MAX_RETRIES ?? 3),
  },
} as const;

export type AppConfig = typeof config;
