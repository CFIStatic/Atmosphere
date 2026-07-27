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

  anthropic: {
    // Upstream model provider key. Server-only: the browser never calls the
    // provider directly, because token counts have to come back through us to
    // be metered. Leave unset and /api/ai/* returns 503 while the rest of the
    // app — including billing — keeps working.
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-opus-5',
  },

  billing: {
    // Whether a client may report its own token counts to /api/usage/record.
    //
    // Off in production by design. Token counts decide what a customer is
    // charged, so they must come from the provider's response via /api/ai/*,
    // not from the caller — a client that under-reports would be spending our
    // margin. Enable only for trusted server-to-server metering of work done
    // outside this process.
    allowClientMetering:
      process.env.ALLOW_CLIENT_METERING === 'true' ||
      (process.env.ALLOW_CLIENT_METERING === undefined && !isProduction),

    // Which payment processor settles credit purchases.
    //
    //   dev    — a billing manager can settle their own purchase through the
    //            API so the credit flow is exercisable without a processor.
    //            Refused in production: it would let anyone mint credits.
    //   manual — purchases stay `pending` until something holding the
    //            service-role key completes them (a processor webhook, or an
    //            operator). This is the safe default once real money is involved.
    //
    // Wiring a real processor means creating its charge in
    // POST /api/billing/purchases and calling `complete_credit_purchase` from
    // its webhook with the service-role key.
    paymentProvider: ((): 'dev' | 'manual' => {
      const configured = process.env.PAYMENT_PROVIDER;
      if (configured === 'dev' || configured === 'manual') {
        if (configured === 'dev' && isProduction) {
          throw new Error(
            'PAYMENT_PROVIDER=dev cannot be used in production: it would let any billing manager grant themselves credits.',
          );
        }
        return configured;
      }
      return isProduction ? 'manual' : 'dev';
    })(),
  },
} as const;

export type AppConfig = typeof config;
