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

  technician: {
    // The voice assistant. Without an Anthropic key the backend still answers —
    // it falls back to a deterministic rule-based reply — so the technician app
    // is usable out of the box and only gets smarter once a key is configured.
    assistant: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
      // Voice replies are spoken aloud, so they must stay short. This caps the
      // response; the system prompt asks for brevity as well.
      maxTokens: Number(process.env.ASSISTANT_MAX_TOKENS ?? 512),
    },

    // Speech-to-text. Optional: the browser's own SpeechRecognition handles
    // dictation where available, and this is the fallback for everyone else
    // (notably iOS Safari and Firefox). Any OpenAI-compatible /audio/transcriptions
    // endpoint works — Whisper, Groq, a self-hosted whisper.cpp server.
    transcription: {
      url: process.env.TRANSCRIPTION_URL ?? '',
      apiKey: process.env.TRANSCRIPTION_API_KEY ?? '',
      model: process.env.TRANSCRIPTION_MODEL ?? 'whisper-1',
    },

    // Cap on an uploaded audio clip. Opus at the recorder's bitrate runs about
    // 1 MB/minute, so this is roughly a 25-minute dictation.
    maxAudioUploadBytes: Number(process.env.MAX_AUDIO_UPLOAD_BYTES ?? 25 * 1024 * 1024),
  },
} as const;

export type AppConfig = typeof config;
