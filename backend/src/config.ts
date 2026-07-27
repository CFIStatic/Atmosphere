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

  pm: {
    // Server-only secret for the writing layer (morning briefs, drafted
    // customer and adjuster updates). Optional: without it the briefs are
    // assembled from the same facts using a deterministic template, and every
    // other part of the Project Manager Agent — the rules, the alerts, the
    // generated work — behaves identically. Never expose this to the browser.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

    // Which model writes. Prices are NOT set here — `public.model_rate_card` in
    // the database is the source of truth for what a token costs, and metering
    // goes through `record_usage`, so nothing in application code can disagree
    // with the invoice.
    model: process.env.PM_MODEL ?? 'claude-opus-5',

    // The background automation pass. Off by default, and deliberately so: a
    // timer has no user session, so it runs with the service-role key and
    // bypasses RLS — the one place in this feature that does. On-demand runs
    // (every page load, and the "run now" button) need no such privilege.
    // See backend/src/pm/scheduler.ts.
    schedulerEnabled:
      (process.env.PM_SCHEDULER_ENABLED ?? 'false').toLowerCase() === 'true',
    schedulerIntervalMinutes: Math.max(
      5,
      Number(process.env.PM_SCHEDULER_INTERVAL_MINUTES ?? 30),
    ),
  },

  computerUse: {
    // Feature flag. Computer use hands an AI model the mouse and keyboard of a
    // real machine, so a deployment that does not want it can switch the whole
    // surface off rather than relying on nobody finding the page.
    enabled: (process.env.COMPUTER_USE_ENABLED ?? 'true') !== 'false',

    // Optional server-wide Anthropic key. When set, the product works with no
    // setup at all; the per-organisation key entered in the UI takes priority.
    fallbackApiKey: process.env.ANTHROPIC_API_KEY ?? '',

    // Encrypts organisation Anthropic keys at rest. Server-only, and rotating
    // it invalidates every stored key (organisations simply re-enter theirs).
    credentialKey: required(
      'AI_CREDENTIALS_KEY',
      devOnly('atmosphere-dev-credentials-key-do-not-use-in-production'),
    ),
    // Where those encrypted keys live. Ciphertext only — never plaintext.
    credentialStorePath: process.env.AI_CREDENTIALS_PATH ?? '.data/ai-credentials.json',

    // Signs the long-lived tokens agents reconnect with. Rotating it unpairs
    // every computer, which is the correct response to a leaked secret.
    agentTokenSecret: required(
      'AGENT_TOKEN_SECRET',
      devOnly('atmosphere-dev-agent-token-secret-do-not-use-in-production'),
    ),

    defaultModel: process.env.COMPUTER_USE_MODEL ?? 'claude-opus-5',
    defaultQuality: (process.env.COMPUTER_USE_QUALITY ?? 'balanced') as
      | 'economical'
      | 'balanced'
      | 'detailed',

    // Guard rails. A model driving a computer can loop indefinitely — clicking
    // a dialog that keeps reappearing, retrying a login that will never work —
    // so every run is bounded in both steps and wall-clock time.
    maxIterations: Number(process.env.COMPUTER_USE_MAX_STEPS ?? 60),
    runTimeoutMs: Number(process.env.COMPUTER_USE_RUN_TIMEOUT_MS ?? 15 * 60 * 1000),
    // A single action should be near-instant; anything slower means the agent
    // is wedged and the model should be told so rather than left waiting.
    actionTimeoutMs: Number(process.env.COMPUTER_USE_ACTION_TIMEOUT_MS ?? 45 * 1000),
    maxTokens: Number(process.env.COMPUTER_USE_MAX_TOKENS ?? 16000),
  },
} as const;

export type AppConfig = typeof config;
