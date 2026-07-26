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
   * Backups. The archive bytes deliberately live OUTSIDE the database being
   * backed up — a copy stored inside the thing it protects is not a copy.
   *
   * The runner reads every org's rows, so it needs the service role key. Like
   * PIN sign-in, the feature simply stays off when that key is absent rather
   * than failing the boot: a deploy without it still serves the app.
   */
  backups: {
    // Explicit opt-out for environments that back up at the infrastructure
    // layer instead (managed PITR, volume snapshots).
    enabled: (process.env.BACKUP_ENABLED ?? 'true') !== 'false',

    // 'local' writes to BACKUP_DIR; 'supabase' uploads to a private Storage
    // bucket. Local is the default because it needs no setup, but it only
    // protects you if that volume outlives the database host.
    driver: (process.env.BACKUP_DRIVER as 'local' | 'supabase') ?? 'local',
    dir: process.env.BACKUP_DIR ?? './backups',
    bucket: process.env.BACKUP_BUCKET ?? 'atmosphere-backups',

    // How often the scheduler runs, and how long finished archives are kept.
    intervalMinutes: Number(process.env.BACKUP_INTERVAL_MINUTES ?? 24 * 60),
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 30),

    // Run a snapshot shortly after boot. Off by default so a crash-loop cannot
    // turn into a storm of half-written archives.
    runOnBoot: process.env.BACKUP_RUN_ON_BOOT === 'true',

    /**
     * Base64 32-byte key for AES-256-GCM. Archives contain every customer
     * record we hold, so at rest they are exactly as sensitive as the database
     * — and unlike the database they get copied to laptops and object stores.
     * Unset means archives are written in the clear, which is refused outright
     * in production. Generate with:  openssl rand -base64 32
     */
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY ?? '',
    // Label recorded alongside each archive so a rotated key can still be
    // matched to the archives it opens. Never the key itself.
    encryptionKeyId: process.env.BACKUP_ENCRYPTION_KEY_ID ?? 'primary',
  },

  /**
   * Mirroring of external applications. Vendor credentials are never stored in
   * the database — a source row names a secret, and the name is resolved here
   * against `ATM_INTEGRATION_<REF>` in the server environment.
   */
  integrations: {
    enabled: (process.env.INTEGRATIONS_ENABLED ?? 'true') !== 'false',
    credentialEnvPrefix: 'ATM_INTEGRATION_',
    // Ceiling on a single sync run, so a vendor paginating forever cannot fill
    // the disk before anyone notices.
    maxRecordsPerRun: Number(process.env.INTEGRATION_MAX_RECORDS ?? 50_000),
    requestTimeoutMs: Number(process.env.INTEGRATION_TIMEOUT_MS ?? 30_000),
  },
} as const;

// A production deploy that writes unencrypted customer archives to disk is a
// breach waiting for someone to find the volume. Fail at boot instead — either
// supply a key or turn backups off deliberately.
if (config.isProduction && config.backups.enabled && !config.backups.encryptionKey) {
  throw new Error(
    'BACKUP_ENCRYPTION_KEY is required in production. ' +
      'Generate one with `openssl rand -base64 32`, or set BACKUP_ENABLED=false ' +
      'if backups are handled at the infrastructure layer.',
  );
}

export type AppConfig = typeof config;
