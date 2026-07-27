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

  verifier: {
    // The second agent, which re-opens the site after a run reports success and
    // checks the work is actually there. On by default: a check nobody
    // remembers to ask for is a check that does not happen, and the failure it
    // catches — a run that reported success without doing anything — is by
    // definition one nobody knew to look for.
    enabled: (process.env.VERIFIER_ENABLED ?? 'true') !== 'false',
    // Turn this off to keep the feature available on demand without a browser
    // opening after every run.
    autoVerify: (process.env.VERIFIER_AUTO_VERIFY ?? 'true') !== 'false',
    // Checking a data pull re-reads the site to confirm the reported rows are
    // real. Cheaper to skip than a push check and less costly to get wrong,
    // since a pull changes nothing at the far end.
    verifyPulls: (process.env.VERIFIER_CHECK_PULLS ?? 'true') !== 'false',

    model: process.env.VERIFIER_MODEL ?? 'claude-opus-5',
    // Judging "is this actually here" from a page of someone else's markup is
    // the hard half of this system. Underspending here produces confident
    // wrong verdicts, which are worse than no verifier at all.
    effort: (process.env.VERIFIER_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',

    // Looking costs less than doing, so the step budget is tighter than a run's.
    maxSteps: Number(process.env.VERIFIER_MAX_STEPS ?? 24),
    timeoutMs: Number(process.env.VERIFIER_TIMEOUT_MS ?? 8 * 60 * 1000),

    // How many times the verifier may correct the same run before it stops and
    // asks. One is the right default: if a fix did not take the first time, the
    // verifier has misunderstood something, and repeating it just writes the
    // same misunderstanding into the customer's system again.
    maxRepairAttempts: Number(process.env.VERIFIER_MAX_REPAIR_ATTEMPTS ?? 1),
  },

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
  estimator: {
    // Server-only key that encrypts third-party credentials (DocuSketch, Dash,
    // Xactimate) before they are written to Postgres. Deliberately NOT in the
    // database: RLS decides who may read a row, this key decides whether the
    // bytes in that row mean anything. A database leak alone yields ciphertext.
    // Generate with:  openssl rand -base64 32
    credentialKey: process.env.ESTIMATOR_CREDENTIAL_KEY ?? '',

    // Reads damage off field photos and scope directions out of CRM job notes,
    // sharing the key the other model-backed features use. Without it the
    // estimator still runs — the vision stages are skipped and scope is built
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

/**
 * Web Access needs a key to seal credentials with and a model to drive the
 * browser. Missing either one, the routes stay reachable but report the
 * feature as unavailable instead of failing mid-run.
 */
export const webAccessEnabled = Boolean(
  config.webAccess.encryptionKey && config.webAccess.anthropicApiKey,
);

/**
 * The verifier drives the same browser and the same model as Web Access, so it
 * can never be available where Web Access is not.
 */
export const verifierEnabled = webAccessEnabled && config.verifier.enabled;

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
