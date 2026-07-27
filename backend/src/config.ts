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

  /**
   * Model providers and the learning loop (see docs/reinforcement-learning.md).
   *
   * Every API key is a server-only secret and none are required: an unset key
   * simply removes that vendor's arms from the routing pool. Base URLs are
   * configurable so the same code can point at a gateway, a regional endpoint,
   * or a local open-weights server.
   */
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      baseUrl: process.env.GOOGLE_BASE_URL ?? 'https://generativelanguage.googleapis.com',
    },
    xai: {
      apiKey: process.env.XAI_API_KEY ?? '',
      baseUrl: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
    },
    // Open-weights server. No key required for a local vLLM/Ollama instance.
    oss: {
      apiKey: process.env.OSS_API_KEY ?? '',
      baseUrl: process.env.OSS_BASE_URL ?? '',
      // Which open model the `oss` arms address. Left configurable because the
      // point of this arm is that it can be swapped for a fine-tune of our own.
      model: process.env.OSS_MODEL ?? 'llama-3.3-70b-instruct',
    },

    // Hard ceiling on a single model call, so one hung vendor cannot pin a
    // request open. Failing over to another arm is cheaper than waiting.
    requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 60_000),

    learning: {
      /**
       * Master switch. Off means: always serve the champion arm, still record
       * episodes and rewards. That is the safe way to run in a new environment
       * — you accumulate the data that makes exploration informed before you
       * let exploration touch real users.
       */
      explorationEnabled: (process.env.AI_EXPLORATION_ENABLED ?? 'true') !== 'false',
      /**
       * Share of traffic reserved for arms that have not yet earned a verdict.
       * Small on purpose: exploration is paid for in real work quality, and 10%
       * is enough to resolve a clearly better arm within days at our volume.
       */
      candidateTrafficShare: Number(process.env.AI_CANDIDATE_TRAFFIC_SHARE ?? 0.1),
      /** Observations before a context bucket is trusted over its parent. */
      minTrialsPerArm: Number(process.env.AI_MIN_TRIALS_PER_ARM ?? 30),
      /** Mined exemplars injected as few-shot examples per prompt. */
      maxExemplars: Number(process.env.AI_MAX_EXEMPLARS ?? 3),
    },
  },
} as const;

export type AppConfig = typeof config;
