import 'dotenv/config';
import { resolveStripeSecretKey } from './lib/stripeSecret.js';
import { usageCustomerMarkup } from './metering/customerMarkup.js';

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

// Dev default matches .env.example: app (:5174), marketing site (:5173),
// internal staff site (:5175), and both localhost / 127.0.0.1 Host headers
// Cursor and browsers swap between.
const frontendOriginRaw = isProduction
  ? required('FRONTEND_ORIGIN')
  : (process.env.FRONTEND_ORIGIN ??
    'http://localhost:5174,http://localhost:5173,http://localhost:5175,http://127.0.0.1:5174,http://127.0.0.1:5173,http://127.0.0.1:5175');

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

  // Google Maps / Places (address autocomplete on job intake). Server-only —
  // distinct from GOOGLE_API_KEY used by the Gemini model arms.
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? '',
  },

  cookies: {
    accessTokenName: 'atm_access_token',
    refreshTokenName: 'atm_refresh_token',
    // Access token lives ~1h (matches Supabase JWT); refresh token much longer.
    accessMaxAgeMs: 60 * 60 * 1000, // 1 hour
    refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    // Prefer explicit COOKIE_SECURE; otherwise require HTTPS in production.
    // Preview tunnels (trycloudflare.com) are HTTPS even in development — set
    // COOKIE_SECURE=true in .env so browsers accept the session cookies.
    secure:
      process.env.COOKIE_SECURE === 'true'
        ? true
        : process.env.COOKIE_SECURE === 'false'
          ? false
          : isProduction,
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

  // Where the password-reset email sends the user back to when Atmosphere
  // mail is unavailable and we fall through to Supabase's mailer. Prefer
  // passwordResetRedirectUrl() (publicAppOrigin + /reset-password) — do not
  // stamp FRONTEND_ORIGIN[0], which is often localhost or the unmapped
  // custom domain. Override with PASSWORD_RESET_REDIRECT_URL.
  passwordResetRedirectUrl: process.env.PASSWORD_RESET_REDIRECT_URL ?? '',

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
    // Production refuses consumer personal inboxes — see productionGuards.ts.
    toEmail:
      process.env.CONTACT_TO_EMAIL ??
      process.env.CAREERS_TO_EMAIL ??
      'hello@atmosphereteam.com',
  },

  careers: {
    // Where job applications from the corporate site's careers page land.
    toEmail: process.env.CAREERS_TO_EMAIL ?? 'hello@atmosphereteam.com',
    // Reply-To for transactional mail + legacy SMTP envelope hint.
    // Transactional From is hello@invites.atmosphereteam.com via RESEND_FROM_EMAIL.
    fromEmail:
      process.env.CAREERS_FROM_EMAIL ?? process.env.SMTP_USER ?? 'hello@atmosphereteam.com',
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

    // Token-usage customer markup. Provider COGS stays on cost_nanos;
    // price_nanos (Settings → Billing → Token spend) is cost × this factor.
    // Default 10× (~90% gross margin). Does not touch the $849 seat / Stripe
    // subscription. Override with USAGE_CUSTOMER_MARKUP or TOKEN_BILLABLE_MARKUP.
    usageCustomerMarkup: usageCustomerMarkup(),

    // Which payment processor settles credit purchases.
    //
    //   stripe — selected automatically whenever a Stripe secret is present
    //            (`STRIPE_SECRET_KEY`, or Railway alias `Stripe_Secret_Key`).
    //            Credits are minted by the Stripe webhook, never by the browser.
    //   dev    — a billing manager can settle their own purchase through the
    //            API so the credit flow is exercisable without a processor.
    //            Refused in production: it would let anyone mint credits.
    //   manual — purchases stay `pending` until something holding the
    //            service-role key completes them.
    paymentProvider: ((): 'stripe' | 'dev' | 'manual' => {
      if (resolveStripeSecretKey()) return 'stripe';

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

    // Comma-separated emails that skip Stripe Checkout / subscription gating.
    // Case-insensitive. Empty (default) means every creator must pay.
    exemptEmails: parseEmailList(process.env.BILLING_EXEMPT_EMAILS, []),
  },

  stripe: {
    secretKey: resolveStripeSecretKey(),
    // Signing secret for POST /api/webhooks/stripe. Without it we cannot tell a
    // genuine Stripe callback from anyone who can reach the URL, so the webhook
    // refuses every request rather than trusting an unverified payload.
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    // Where Stripe returns the customer after checkout or the billing portal.
    successUrl:
      process.env.STRIPE_SUCCESS_URL ??
      `${frontendOrigins[0]}/settings?section=billing&checkout=success`,
    cancelUrl:
      process.env.STRIPE_CANCEL_URL ??
      `${frontendOrigins[0]}/settings?section=billing&checkout=cancelled`,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL ?? `${frontendOrigins[0]}/settings?section=billing`,
    /** Fallback Stripe price when metering_plan_versions.stripe_price_id is unset. Work Verification default. */
    onboardingPriceId: process.env.STRIPE_ONBOARDING_PRICE_ID ?? '',
    /** Starter $399/mo (1 included Field Capture seat). Falls back to the live catalog id. */
    starterPriceId: process.env.STRIPE_STARTER_PRICE_ID ?? '',
    /** Scale $1,999/mo (10 included Field Capture seats). Falls back to the live catalog id. */
    scalePriceId: process.env.STRIPE_SCALE_PRICE_ID ?? '',
    /** Extra Field Capture seat $125/mo. Defaults to the live Jettx catalog id. */
    extraSeatPriceId: process.env.STRIPE_EXTRA_SEAT_PRICE_ID ?? '',
    /** Base path for signup billing return URLs (step 2 + checkout query params appended). */
    onboardingReturnBase:
      process.env.STRIPE_ONBOARDING_RETURN_URL ?? `${frontendOrigins[0]}/signup`,
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
   * Atmosphere corporate staff who get /analytics without a manual SQL grant.
   * On sign-in / access probe the BFF upserts analytics_staff for these emails
   * (requires SUPABASE_SERVICE_ROLE_KEY). Defaults include jack@jettx.ai so
   * preview just works.
   */
  analytics: {
    internalEmails: parseEmailList(
      process.env.ANALYTICS_INTERNAL_EMAILS,
      ['jack@jettx.ai'],
    ),
    investorEmails: parseEmailList(process.env.ANALYTICS_INVESTOR_EMAILS, []),
  },
} as const;

/** Positive int from env, or null when unset / invalid (means “unlimited”). */
function optionalPositiveInt(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseEmailList(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim() ? value : fallback.join(',');
  return [
    ...new Set(
      raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}


export type AppConfig = typeof config;
