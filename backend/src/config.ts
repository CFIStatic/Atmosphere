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

  symbility: {
    // CoreLogic Symbility (Claims Connect) — the other estimating platform a
    // restoration org lives in, and for many carrier programs the required
    // one. Same posture as Xactimate: 'mock' by default so the whole connect
    // flow is exercisable without real credentials, and which driver runs is a
    // deployment decision, never a per-request one.
    driver: (process.env.SYMBILITY_DRIVER === 'web' ? 'web' : 'mock') as 'mock' | 'web',

    // There is no partner API wired here yet, so web login is the live path —
    // and like Xactimate it is off unless explicitly enabled, because whether
    // automating a Claims Connect account is permitted is between the account
    // holder and CoreLogic.
    webAutomationEnabled: process.env.SYMBILITY_WEB_AUTOMATION === 'true',
    headless: process.env.SYMBILITY_HEADLESS !== 'false',
    webSelectors: parseJsonRecord(process.env.SYMBILITY_WEB_SELECTORS),

    // Sealed with its own key; falls back to the Xactimate vault key so a
    // server configured for one estimating vault covers both.
    encryptionKey: process.env.SYMBILITY_ENC_KEY ?? process.env.XACTIMATE_ENC_KEY ?? '',
  },

  verification: {
    // Above this duration a clip is a workday, not a walkthrough, and the
    // analysis goes hierarchical: windows on the cheap model, synthesis on
    // the strong one. 15 minutes is where a single-look read stops being
    // honest about its own coverage.
    longFormSeconds: Number(process.env.LONG_FORM_SECONDS ?? 900),
    windowMaxFrames: Number(process.env.LONG_FORM_WINDOW_FRAMES ?? 12),
    // One hour per window keeps a 24h sparse sample (~144 frames at 10 min)
    // near ~24 cheap reads + one synthesis, not dozens of tiny windows.
    windowMaxSeconds: Number(process.env.LONG_FORM_WINDOW_SECONDS ?? 3600),
    // The synthesis reads no pixels — it composes a day report out of window
    // summaries that were already written, and the verdict caps that matter
    // are applied in code afterward, not asked of the model. That is a
    // mid-tier job. It gets its own knob rather than borrowing the
    // assistant's flagship, so the expensive leg of the pipeline stays the
    // one that actually looks at frames.
    synthesisModel: process.env.LONG_FORM_SYNTHESIS_MODEL ?? 'claude-sonnet-5',
    // Day-length / overnight recordings. The phone may leave the camera
    // running for a whole shift (and sometimes longer); intake accepts up to
    // this many seconds, then the server sparsely extracts stills rather
    // than trusting the device to ship hundreds of base64 frames.
    maxDurationSeconds: Number(process.env.PROOF_MAX_DURATION_SECONDS ?? 24 * 60 * 60),
    // Final keep budget after diversity filtering (distinct scenes, not
    // clock ticks). A static camera collapses; an active day keeps more.
    sparseMaxFrames: Number(process.env.PROOF_SPARSE_MAX_FRAMES ?? 180),
    // Candidate spacing before diversity (denser than the keep budget).
    sparseCandidateIntervalSeconds: Number(
      process.env.PROOF_SPARSE_CANDIDATE_INTERVAL_SECONDS ?? 120,
    ),
    // Perceptual-hash Hamming distance at or below this = "same frame".
    sparseDiversityHamming: Number(process.env.PROOF_SPARSE_DIVERSITY_HAMMING ?? 8),
    // Even when nothing changes, keep one temporal anchor this often.
    sparseCoverageIntervalSeconds: Number(
      process.env.PROOF_SPARSE_COVERAGE_INTERVAL_SECONDS ?? 3600,
    ),
    // Legacy alias used by older docs/tests — treated as candidate spacing
    // when the dedicated candidate knob is unset above.
    sparseFrameIntervalSeconds: Number(
      process.env.PROOF_SPARSE_FRAME_INTERVAL_SECONDS ??
        process.env.PROOF_SPARSE_CANDIDATE_INTERVAL_SECONDS ??
        120,
    ),
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  },

  /**
   * Fleet media: many ≤24h objects in object storage.
   * Postgres catalogs identity; bytes never live in the API or DB.
   */
  media: {
    // supabase = today's hot bucket; s3 = multipart/lifecycle-ready stub;
    // memory = unit tests only.
    backend: (process.env.MEDIA_BACKEND === 's3'
      ? 's3'
      : process.env.MEDIA_BACKEND === 'memory'
        ? 'memory'
        : 'supabase') as 'supabase' | 's3' | 'memory',
    hotBucket: process.env.MEDIA_HOT_BUCKET ?? 'job-proofs',
    archiveBucket: process.env.MEDIA_ARCHIVE_BUCKET ?? '',
    // Above this expected size, prefer multipart when the driver supports it.
    multipartThresholdBytes: Number(
      process.env.MEDIA_MULTIPART_THRESHOLD_BYTES ?? 64 * 1024 * 1024,
    ),
    multipartPartBytes: Number(process.env.MEDIA_MULTIPART_PART_BYTES ?? 16 * 1024 * 1024),
    // Soft defaults when an org has no row in org_media_quotas (null = unlimited).
    defaultMaxHotBytes: optionalPositiveInt(process.env.MEDIA_DEFAULT_MAX_HOT_BYTES),
    defaultMaxTotalBytes: optionalPositiveInt(process.env.MEDIA_DEFAULT_MAX_TOTAL_BYTES),
    defaultMaxIngestSecondsPerDay: optionalPositiveInt(
      process.env.MEDIA_DEFAULT_MAX_INGEST_SECONDS_PER_DAY,
    ),
    // ~3 GB/hour × 24h ≈ 72 GB — generous single-object ceiling for a day file.
    defaultMaxObjectBytes: Number(
      process.env.MEDIA_DEFAULT_MAX_OBJECT_BYTES ?? 80 * 1024 * 1024 * 1024,
    ),
  },

  crmSync: {
    // Job files from the customer's own CRM. 'mock' by default so the whole
    // connect-and-sync pipeline is exercisable without vendor credentials;
    // 'api' turns on the per-vendor clients once a deployment configures
    // them. Which driver runs is a deployment decision, never per-request.
    driver: (process.env.CRM_SYNC_DRIVER === 'api' ? 'api' : 'mock') as 'mock' | 'api',
  },

  sla: {
    // Where carrier program agreements come from. 'manual' is the default and
    // the only source guaranteed to match what the franchise actually signed —
    // someone reads the contract and enters its terms. 'portal' pulls from a
    // franchisor endpoint speaking the documented JSON contract; 'mock' serves
    // representative demo terms.
    source: parseSlaSource(process.env.SLA_SOURCE),
    portalBaseUrl: process.env.SLA_PORTAL_BASE_URL ?? '',
    portalApiKey: process.env.SLA_PORTAL_API_KEY ?? '',
  },

  technician: {
    // The voice assistant. Without an Anthropic key the backend still answers —
    // it falls back to a deterministic rule-based reply — so the technician app
    // is usable out of the box and only gets smarter once a key is configured.
    assistant: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
      // The live capture loop is a five-way classification of a single still,
      // forty times per walkthrough. That is the cheapest tier's job, and
      // putting the flagship on it would multiply the pipeline's whole cost
      // for no visible gain. Narration and the day comparison stay on the
      // stronger model — they write records people act on.
      liveModel: process.env.LIVE_OBSERVE_MODEL ?? 'claude-haiku-4-5-20251001',
      // Per-org, per-day ceiling on live observations. At the default cadence
      // one walkthrough is ~40 calls, so 2000 is roughly fifty walkthroughs a
      // day — genuinely heavy use — while capping the worst case (a camera
      // left recording overnight) at pocket change instead of a surprise.
      liveDailyCapPerOrg: Number(process.env.LIVE_OBSERVE_DAILY_CAP ?? 2000),
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

  anthropic: {
    // Upstream model provider key. Server-only: the browser never calls the
    // provider directly, because token counts have to come back through us to
    // be metered. Leave unset and /api/ai/* returns 503 while the rest of the
    // app — including billing — keeps working.
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-opus-5',
  },

  contact: {
    // Where messages from the corporate site's contact form land. Falls back
    // to the careers inbox so one configured address serves both forms.
    toEmail:
      process.env.CONTACT_TO_EMAIL ??
      process.env.CAREERS_TO_EMAIL ??
      'jackcyganiak@yahoo.com',
  },

  careers: {
    // Where job applications from the corporate site's careers page land.
    toEmail: process.env.CAREERS_TO_EMAIL ?? 'jackcyganiak@yahoo.com',
    // Envelope sender for the application emails. Many SMTP providers require
    // this to be an address the account is allowed to send as.
    fromEmail: process.env.CAREERS_FROM_EMAIL ?? process.env.SMTP_USER ?? '',
    // SMTP transport. Leave unset and /api/careers/apply still accepts and
    // logs applications in development, but refuses in production so a deploy
    // that forgot to configure mail fails loudly instead of eating applicants.
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
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
    //   stripe — selected automatically whenever STRIPE_SECRET_KEY is present.
    //            Credits are minted by the Stripe webhook, never by the browser.
    //   dev    — a billing manager can settle their own purchase through the
    //            API so the credit flow is exercisable without a processor.
    //            Refused in production: it would let anyone mint credits.
    //   manual — purchases stay `pending` until something holding the
    //            service-role key completes them.
    paymentProvider: ((): 'stripe' | 'dev' | 'manual' => {
      if (process.env.STRIPE_SECRET_KEY) return 'stripe';

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

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    // Signing secret for POST /api/webhooks/stripe. Without it we cannot tell a
    // genuine Stripe callback from anyone who can reach the URL, so the webhook
    // refuses every request rather than trusting an unverified payload.
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    // Where Stripe returns the customer after checkout or the billing portal.
    successUrl: process.env.STRIPE_SUCCESS_URL ?? `${frontendOrigins[0]}/billing?checkout=success`,
    cancelUrl: process.env.STRIPE_CANCEL_URL ?? `${frontendOrigins[0]}/billing?checkout=cancelled`,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL ?? `${frontendOrigins[0]}/billing`,
  },

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

    // Sealing key for OAuth grants against customers' own CRMs. Absent from
    // the database on purpose: a database leak alone must not yield a usable
    // refresh token, which is the same separation the device pepper relies on.
    oauthKey: process.env.INTEGRATIONS_OAUTH_KEY ?? '',

    salesforce: {
      // A Connected App in Salesforce. Without these the connector refuses to
      // run rather than falling back to asking for a password — the fallback
      // is the thing OAuth exists to avoid.
      clientId: process.env.SALESFORCE_CLIENT_ID ?? '',
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET ?? '',
      // Sandboxes live at test.salesforce.com; this is how a customer points
      // us at one without a code change.
      loginUrl: process.env.SALESFORCE_LOGIN_URL ?? 'https://login.salesforce.com',
      apiVersion: process.env.SALESFORCE_API_VERSION ?? 'v60.0',
    },

    // Reading a CRM through a signed-in browser. Off unless switched on: it
    // necessarily involves holding a customer's password, and that should take
    // a deliberate act rather than being available by default.
    browserCrmEnabled: process.env.INTEGRATIONS_BROWSER_CRM === 'true',
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
  campaigns: {
    // Public map and weather data. Both are free and open, and both ask for a
    // contactable User-Agent as a condition of use rather than a suggestion —
    // getting blocked would break the feature for every customer at once.
    userAgent: process.env.CAMPAIGNS_USER_AGENT ?? 'AtmosphereBot/1.0 (+https://atmosphere.build/bot)',

    // OpenStreetMap. Chosen over Google Places deliberately: Places charges per
    // call and forbids storing results, which makes building a territory list
    // out of it both expensive and against the terms. OSM is ODbL — free to
    // query, free to cache, attribution the only obligation.
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
    overpassBaseUrl: process.env.OVERPASS_BASE_URL ?? 'https://overpass-api.de/api/interpreter',
    maxPlacesPerSearch: Number(process.env.CAMPAIGNS_MAX_PLACES ?? 300),

    // The National Weather Service. Free, no key, and authoritative — these are
    // the alerts that drive the warnings on the radio.
    weatherBaseUrl: process.env.WEATHER_BASE_URL ?? 'https://api.weather.gov',

    // Forecasts, behind a port so any vendor drops in. NWS is the default and
    // works with nothing configured.
    forecastProvider: (process.env.FORECAST_PROVIDER ?? 'auto') as 'auto' | 'nws' | 'openweather',
    openWeatherApiKey: process.env.OPENWEATHER_API_KEY ?? '',
    openWeatherBaseUrl: process.env.OPENWEATHER_BASE_URL ?? 'https://api.openweathermap.org',

    // Sending as the customer, from their own mailbox.
    //
    // Sending is send-only where it can be. gmail.send and Mail.Send grant no
    // ability to read mail; the extra scopes alongside them exist only to learn
    // which account is connected, because neither send scope can answer that:
    //
    //   Google      + openid email profile   (non-sensitive)
    //   Microsoft   + User.Read              (required for /v1.0/me)
    //
    // Without those the OAuth callback 403s and the connection appears to
    // succeed while nothing ever sends.
    //
    // Before launch: gmail.send needs Google app verification past ~100 users,
    // and that 100 is a lifetime cap rather than a concurrent one. Sources
    // disagree on whether it is "sensitive" (verification only) or "restricted"
    // (verification plus a paid annual security assessment) — confirm against
    // Google's OAuth API Verification FAQ before committing a budget.
    //
    // Not ambiguous, and it decides the schedule: while the consent screen is
    // in Testing, Google expires every refresh token after seven days. A
    // campaign that fires next month has nothing to refresh with, so
    // verification blocks scheduled sending rather than following it.
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    gmailBaseUrl: process.env.GMAIL_BASE_URL ?? 'https://gmail.googleapis.com',
    googleAuthUrl: process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    googleTokenUrl: process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
    // Identity comes from here, not from Gmail: gmail.send grants no read
    // access, so the Gmail profile endpoint cannot be relied on to answer.
    googleUserinfoUrl:
      process.env.GOOGLE_USERINFO_URL ?? 'https://openidconnect.googleapis.com/v1/userinfo',

    microsoftClientId: process.env.MICROSOFT_CLIENT_ID ?? '',
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    graphBaseUrl: process.env.GRAPH_BASE_URL ?? 'https://graph.microsoft.com',
    microsoftAuthUrl:
      process.env.MICROSOFT_AUTH_URL ?? 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    microsoftTokenUrl:
      process.env.MICROSOFT_TOKEN_URL ?? 'https://login.microsoftonline.com/common/oauth2/v2.0/token',

    // Where the unsubscribe link in every email points.
    //
    // This must resolve to the BACKEND handler, not the app. The link is
    // clicked from a mail client by somebody who has no account and never
    // will, and the first version of this pointed at the SPA — which has no
    // such route, so every message shipped carried an opt-out that went
    // nowhere. That is a CAN-SPAM violation per message, not a broken link.
    //
    // Defaulted from the API's own public origin so a deployment that sets
    // nothing still produces a working link.
    unsubscribeBaseUrl:
      process.env.UNSUBSCRIBE_BASE_URL ??
      `${process.env.PUBLIC_API_ORIGIN ?? `http://localhost:${process.env.PORT ?? 4000}`}/api/unsubscribe`,

    // Gap between messages in a send run. Exchange Online hard-caps a mailbox
    // at 30 a minute and will not raise it; two seconds sits comfortably
    // inside that and inside Gmail's far looser limit.
    sendSpacingMs: Number(process.env.CAMPAIGNS_SEND_SPACING_MS ?? 2_000),

    countryCode: process.env.CAMPAIGNS_COUNTRY ?? 'us',
    requestTimeoutMs: Number(process.env.CAMPAIGNS_TIMEOUT_MS ?? 25_000),
  },

  prospecting: {
    // Finding contact details is a licensed-data problem: the records are
    // bought from a vendor per match, not computed. 'sandbox' serves invented
    // people so the whole feature works before a data contract exists;
    // 'live' talks to the configured vendor. Production still falls back to
    // sandbox when no key is present, because billing a customer for a
    // provider we cannot call would be worse than showing obvious fixtures.
    mode: (process.env.PROSPECTING_MODE ?? (isProduction ? 'live' : 'sandbox')) as
      | 'live'
      | 'sandbox',

    provider: (process.env.PROSPECTING_PROVIDER ?? 'people_data_labs') as
      | 'people_data_labs'
      | 'hunter',

    peopleDataLabsApiKey: process.env.PEOPLE_DATA_LABS_API_KEY ?? '',
    peopleDataLabsBaseUrl:
      process.env.PEOPLE_DATA_LABS_BASE_URL ?? 'https://api.peopledatalabs.com',

    // Hunter sits second in the waterfall. It is a domain crawler rather than
    // a people database, so it holds the small-company people PDL has never
    // heard of — and its domain search is what supplies pattern-inference
    // evidence to an org whose own CRM is still empty.
    hunterApiKey: process.env.HUNTER_API_KEY ?? '',
    hunterBaseUrl: process.env.HUNTER_BASE_URL ?? 'https://api.hunter.io',
    hunterCostNanos: Number(process.env.PROSPECTING_HUNTER_COST_NANOS ?? 10_000_000),

    // What one revealed contact costs the customer, in nanodollars.
    // 1 credit = 1 USD = 1_000_000_000 nanos, so this default is $0.25 a
    // reveal. It is charged through the same credit lots as token usage.
    revealPriceNanos: Number(process.env.PROSPECTING_REVEAL_PRICE_NANOS ?? 250_000_000),

    // What the vendor charges us per match, recorded against the usage event
    // so the margin on a reveal is as visible as the margin on a model call.
    revealCostNanos: Number(process.env.PROSPECTING_REVEAL_COST_NANOS ?? 20_000_000),

    requestTimeoutMs: Number(process.env.PROSPECTING_TIMEOUT_MS ?? 15_000),

    // Verification. An unverified address is a guess, and selling guesses
    // burns the customer's sending reputation — so nothing is returned until
    // the ladder in verification.ts has had its say.
    //
    // The SMTP probe opens a connection to the recipient's mail exchanger and
    // asks whether a mailbox exists (RCPT TO, then QUIT — no message is ever
    // sent). Some hosts block outbound port 25; turn this off there and every
    // address falls back to a DNS-only 'unknown'.
    // OFF unless explicitly enabled. Probing opens connections to strangers'
    // mail servers from your IP; done with a forged envelope sender, or from a
    // host whose reputation you have not thought about, it is a fast way onto
    // a blocklist. Turn it on deliberately, with a real sending domain below.
    smtpProbeEnabled:
      process.env.PROSPECTING_SMTP_PROBE === 'true' &&
      Boolean(process.env.PROSPECTING_VERIFY_FROM) &&
      !/\.invalid$/.test(process.env.PROSPECTING_VERIFY_FROM ?? ''),
    verifyTimeoutMs: Number(process.env.PROSPECTING_VERIFY_TIMEOUT_MS ?? 6_000),

    // Phone verification. Carrier lookup is the only authority on whether a
    // number is assigned and what kind of line it rings — and since number
    // portability, an area code tells you where a number was issued and
    // nothing about whether it reaches a desk or a pocket.
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    twilioLookupBaseUrl: process.env.TWILIO_LOOKUP_BASE_URL ?? 'https://lookups.twilio.com',
    numverifyApiKey: process.env.NUMVERIFY_API_KEY ?? '',
    numverifyBaseUrl: process.env.NUMVERIFY_BASE_URL ?? 'https://apilayer.net/api',
    phoneTimeoutMs: Number(process.env.PROSPECTING_PHONE_TIMEOUT_MS ?? 6_000),

    // Which verifier answers "does this mailbox exist?".
    //
    // 'auto' takes the best configured option: a paid HTTPS verifier first,
    // then our own SMTP probe. Pin a specific one when an operator wants a
    // particular vendor despite another key being present in the environment.
    verifier: (process.env.PROSPECTING_VERIFIER ?? 'auto') as
      | 'auto'
      | 'zerobounce'
      | 'neverbounce'
      | 'smtp',

    // HTTPS verification vendors. These are what make the feature accurate on
    // a host with port 25 blocked — which is AWS, GCP, Azure and most PaaS by
    // default. Roughly half a cent a check against a $0.25 reveal.
    zeroBounceApiKey: process.env.ZEROBOUNCE_API_KEY ?? '',
    zeroBounceBaseUrl: process.env.ZEROBOUNCE_BASE_URL ?? 'https://api.zerobounce.net',
    neverBounceApiKey: process.env.NEVERBOUNCE_API_KEY ?? '',
    neverBounceBaseUrl: process.env.NEVERBOUNCE_BASE_URL ?? 'https://api.neverbounce.com',

    // May an address nothing could confirm still be sold?
    //
    // This defaults to false, and the default is the point. With no verifier
    // configured every address comes back 'unknown', and the permissive
    // reading of that — "well, the domain has an MX record" — means billing a
    // customer for a string a vendor asserted and nobody checked. That is
    // precisely the product this feature is not supposed to be.
    //
    // Set true only for a deployment that has deliberately accepted vendor
    // data at face value. The UI says which mode it is in either way.
    sellUnverified: process.env.PROSPECTING_SELL_UNVERIFIED === 'true',
    // The envelope sender used when probing. Must be an address at a domain we
    // control: mail servers check it, and a forged one gets us blocklisted.
    verifyFromAddress: process.env.PROSPECTING_VERIFY_FROM ?? 'verify@atmosphere.invalid',
    verifyHeloDomain: process.env.PROSPECTING_VERIFY_HELO ?? 'atmosphere.invalid',

    // Free sources, asked before any vendor is billed.
    //
    // A free answer and a paid answer are worth the same to the customer and
    // very different to us, so the waterfall spends nothing until these have
    // had their turn. They also feed pattern inference the domain evidence it
    // refuses to guess without — which is what makes the engine work for a
    // customer whose own CRM is still empty.
    webCrawlEnabled: (process.env.PROSPECTING_WEB_CRAWL ?? 'true') !== 'false',
    crawlTimeoutMs: Number(process.env.PROSPECTING_CRAWL_TIMEOUT_MS ?? 6_000),
    crawlMaxPages: Number(process.env.PROSPECTING_CRAWL_MAX_PAGES ?? 4),

    commonCrawlEnabled: (process.env.PROSPECTING_COMMON_CRAWL ?? 'true') !== 'false',
    commonCrawlBaseUrl: process.env.COMMON_CRAWL_BASE_URL ?? 'https://index.commoncrawl.org',
    commonCrawlDataUrl: process.env.COMMON_CRAWL_DATA_URL ?? 'https://data.commoncrawl.org',
    // Pinned rather than discovered: listing available crawls is itself a
    // network call, and a stale-but-working index beats a reveal that fails
    // because discovery timed out.
    commonCrawlIndex: process.env.COMMON_CRAWL_INDEX ?? 'CC-MAIN-2026-22',
    commonCrawlLimit: Number(process.env.COMMON_CRAWL_LIMIT ?? 60),
    commonCrawlMaxRecords: Number(process.env.COMMON_CRAWL_MAX_RECORDS ?? 3),

    // The Profiler reads a company's own public pages for professional
    // context before a sales call. Capped tightly: this is a handful of pages
    // once, not a spider.
    profilerEnabled: (process.env.PROSPECTING_PROFILER ?? 'true') !== 'false',
    profilerMaxPages: Number(process.env.PROSPECTING_PROFILER_MAX_PAGES ?? 6),

    // The contributory network. Reading the pool is on by default; writing to
    // it is per-org opt-in and enforced in SQL, not here.
    networkEnabled: (process.env.PROSPECTING_NETWORK ?? 'true') !== 'false',

    // Pattern inference finds the people no vendor has: learn a company's
    // convention from addresses the org already holds, apply it, verify it.
    // Nothing is sold unless a mail server confirms the mailbox.
    // Inference only produces candidates; verification decides. With probing
    // off there is nothing to confirm a guess, so this follows it.
    patternInferenceEnabled: (process.env.PROSPECTING_PATTERNS ?? 'true') !== 'false',
    maxPatternCandidates: Number(process.env.PROSPECTING_MAX_CANDIDATES ?? 5),
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

/** Positive int from env, or null when unset / invalid (means “unlimited”). */
function optionalPositiveInt(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseSlaSource(value: string | undefined): 'manual' | 'portal' | 'mock' {
  return value === 'portal' || value === 'mock' ? value : 'manual';
}

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
