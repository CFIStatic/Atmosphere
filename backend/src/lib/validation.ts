import { z } from 'zod';

/**
 * Input validation schemas. Password rules mirror a sensible baseline; Supabase
 * enforces its own minimum on the server as a second line of defence.
 */

const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address');

const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters'); // bcrypt hard limit

export const credentialsSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Body of the "email me a reset link" request. */
export const forgotPasswordSchema = z.object({ email: emailField });

/**
 * Body of the reset form. Supabase delivers recovery links in one of two shapes
 * depending on the email template and flow type, so accept either and let the
 * route pick the matching exchange.
 */
export const resetPasswordSchema = z
  .object({
    // Emitted when the recovery email template uses `{{ .TokenHash }}` — the
    // preferred shape here, since it never puts a session token in the URL.
    tokenHash: z.string().trim().min(1).optional(),
    // PKCE-style links.
    code: z.string().trim().min(1).optional(),
    // Supabase's default template lands with tokens in the URL fragment. Accept
    // that pair too so password reset works before any template customisation.
    accessToken: z.string().trim().min(1).optional(),
    refreshToken: z.string().trim().min(1).optional(),
    password: passwordField,
  })
  .refine((v) => Boolean(v.tokenHash || v.code || (v.accessToken && v.refreshToken)), {
    message: 'This reset link is invalid or incomplete. Request a new one.',
    path: ['tokenHash'],
  });

/**
 * The most-guessed 4-digit PINs. With a device-bound PIN an attacker who steals
 * an unlocked-but-locked device gets 5 attempts before lockout — which is
 * harmless against a random PIN but close to a coin flip if the user picked
 * 1234. Rejecting the popular set is what keeps that attempt budget meaningless.
 */
const COMMON_PINS = new Set([
  '1234', '1111', '0000', '1212', '7777', '1004', '2000', '4444', '2222', '6969',
  '9999', '3333', '5555', '6666', '1122', '1313', '8888', '4321', '2001', '1010',
  '2580', '0852', '1230', '1984', '2011', '1112', '1379', '1999', '2020', '2468',
]);

function isSequential(pin: string): boolean {
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i += 1) {
    const delta = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

export const pinSchema = z.object({
  pin: z
    .string({ required_error: 'PIN is required' })
    .regex(/^\d{4}$/, 'Your PIN must be exactly 4 digits')
    .refine((pin) => !COMMON_PINS.has(pin), 'That PIN is too easy to guess — pick another')
    .refine((pin) => new Set(pin).size > 1, 'Your PIN cannot be the same digit four times')
    .refine((pin) => !isSequential(pin), 'Your PIN cannot be four digits in a row'),
});

/** Unlock only needs the shape to be right — no strength rules on the way in. */
export const pinUnlockSchema = z.object({
  pin: z.string({ required_error: 'PIN is required' }).regex(/^\d{4}$/, 'Enter your 4-digit PIN'),
});

/** Account types a member can hold within an organization. */
export const MEMBER_ROLES = [
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
  'sales',
] as const;

/** The kind of work a member does. */
export const WORK_TYPES = ['mitigation', 'construction'] as const;

const roleSchema = z.enum(MEMBER_ROLES, {
  errorMap: () => ({ message: 'Select a valid account type' }),
});
const workTypeSchema = z.enum(WORK_TYPES, {
  errorMap: () => ({ message: 'Select mitigation or construction' }),
});

export const createOrgSchema = z.object({
  name: z.string({ required_error: 'Organization name is required' }).trim().min(2, 'Organization name is too short').max(80, 'Organization name is too long'),
  role: roleSchema,
  workType: workTypeSchema,
});

export const joinOrgSchema = z.object({
  joinCode: z
    .string({ required_error: 'Join code is required' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, 'Enter a valid join code'),
  role: roleSchema,
  workType: workTypeSchema,
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type JoinOrgInput = z.infer<typeof joinOrgSchema>;

/* ---------------------------------------------------------------- billing -- */

/** Subscription tiers. `enterprise` is quote-only and rejected by the database. */
export const PLAN_CODES = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'enterprise'] as const;

export const setPlanSchema = z.object({
  planCode: z.enum(PLAN_CODES, { errorMap: () => ({ message: 'Select a valid plan' }) }),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
  seats: z.number().int().min(1, 'At least one seat').max(10000, 'Too many seats').default(1),
});

/**
 * Auto-reload and spend limits are money settings, so amounts are integer
 * nanodollars. `null` on the spend limit means "no cap" and is distinct from
 * omitting the field, which means "leave unchanged".
 */
const nanoAmount = z
  .number()
  .int('Amounts must be whole nanodollars')
  .min(0, 'Amount cannot be negative')
  .max(Number.MAX_SAFE_INTEGER);

export const billingSettingsSchema = z
  .object({
    autoReloadEnabled: z.boolean().optional(),
    autoReloadThresholdNanos: nanoAmount.optional(),
    autoReloadAmountNanos: nanoAmount.min(5_000_000_000, 'Auto-reload must be at least $5').optional(),
    monthlySpendLimitNanos: nanoAmount.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/**
 * A purchase is either a catalogue pack or a custom dollar amount, never both.
 * The floor mirrors the database check so the caller gets a clean 400 rather
 * than a raised exception.
 */
export const startPurchaseSchema = z
  .object({
    packCode: z.string().trim().min(1).max(64).optional(),
    amountCents: z
      .number()
      .int()
      .min(500, 'The minimum top-up is $5')
      .max(10_000_000, 'The maximum single top-up is $100,000')
      .optional(),
  })
  .refine((v) => Boolean(v.packCode) !== Boolean(v.amountCents), {
    message: 'Choose either a credit pack or a custom amount',
    path: ['packCode'],
  });

export const completePurchaseSchema = z.object({
  purchaseId: z.string().uuid('Invalid purchase id'),
});

/** Token counts reported by a completed model call. */
const tokenCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0);

export const recordUsageSchema = z.object({
  modelId: z.string().trim().min(1, 'A model is required').max(128),
  // Idempotency key. Replaying the same id returns the original charge instead
  // of billing twice, so a retried request is always safe.
  requestId: z.string().trim().min(1, 'A request id is required').max(200),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheWrite5mTokens: tokenCount,
  cacheWrite1hTokens: tokenCount,
  cacheReadTokens: tokenCount,
  isBatch: z.boolean().default(false),
  feature: z.string().trim().max(64).optional(),
});

export const quoteUsageSchema = recordUsageSchema.omit({ requestId: true, feature: true });
/**
 * Web Access — connections to outside websites the AI signs into, and the
 * tasks it is asked to perform there.
 *
 * The site address is only shape-checked here; whether it is actually reachable
 * (and not pointed at a private network address) is settled in webUrlGuard,
 * which has to resolve DNS and so cannot live in a synchronous schema.
 */
const siteUrlField = z
  .string({ required_error: 'Site address is required' })
  .trim()
  .max(2000, 'That address is too long')
  .url('Enter a full address, including https://');

export const createWebConnectionSchema = z.object({
  label: z
    .string({ required_error: 'Give this connection a name' })
    .trim()
    .min(2, 'That name is too short')
    .max(80, 'That name is too long'),
  siteUrl: siteUrlField,
  // Only needed when the sign-in form is not on the site's landing page.
  loginUrl: siteUrlField.optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  username: z
    .string({ required_error: 'Username is required' })
    .trim()
    .min(1, 'Username is required')
    .max(200, 'That username is too long'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(500, 'That password is too long'),
});

/** Everything is optional: this is the edit form, including "just rotate the password". */
export const updateWebConnectionSchema = createWebConnectionSchema.partial().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Nothing to update' },
);

export const createWebRunSchema = z.object({
  connectionId: z.string({ required_error: 'Choose a connection' }).uuid('Choose a connection'),
  kind: z.enum(['pull', 'push'], {
    errorMap: () => ({ message: 'Choose whether to pull data or enter data' }),
  }),
  instruction: z
    .string({ required_error: 'Describe the task' })
    .trim()
    .min(4, 'Describe the task in a little more detail')
    .max(4000, 'That description is too long'),
  // Rows to enter for a push. Free-form on purpose — every site wants a
  // different shape, and the agent reads it as context rather than a contract.
  data: z.unknown().optional(),
});

export type CreateWebConnectionInput = z.infer<typeof createWebConnectionSchema>;
export type CreateWebRunInput = z.infer<typeof createWebRunSchema>;

/**
 * Verifier — answering the question the second agent asks when it could not
 * settle something on its own.
 *
 * The option id is checked against the choices actually stored on that
 * escalation before anything acts on it, so this only has to establish the
 * shape. The note is free text a person types alongside their choice; it is
 * shown back to them and passed to a repair as context, never executed as an
 * instruction on its own.
 */
export const resolveEscalationSchema = z.object({
  optionId: z
    .string({ required_error: 'Choose how to proceed' })
    .trim()
    .min(1, 'Choose how to proceed')
    .max(64, 'That is not one of the offered answers'),
  note: z
    .string()
    .trim()
    .max(2000, 'That note is too long')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value : undefined)),
});

export type ResolveEscalationInput = z.infer<typeof resolveEscalationSchema>;

/* ------------------------------------------------------------------ */
/* Construction Estimator                                              */
/* ------------------------------------------------------------------ */

/** The third-party systems the estimator signs in to. */
export const ESTIMATOR_PROVIDERS = ['docusketch', 'dash', 'xactimate'] as const;

export const providerParamSchema = z.enum(ESTIMATOR_PROVIDERS, {
  errorMap: () => ({ message: 'Unknown provider' }),
});

/**
 * A stored vendor credential. Either an API key or a username/password pair is
 * required — the refinement is what stops an empty form from being saved as a
 * "connected" provider that then fails halfway through a run.
 */
export const credentialSchema = z
  .object({
    label: z.string().trim().max(80).optional(),
    username: z.string().trim().max(200).optional(),
    password: z.string().max(500).optional(),
    apiKey: z.string().trim().max(2000).optional(),
    accountId: z.string().trim().max(200).optional(),
    baseUrl: z
      .string()
      .trim()
      .url('Enter a valid https:// URL')
      .refine((url) => url.startsWith('https://'), 'The vendor URL must use https')
      .optional(),
  })
  .refine((value) => Boolean(value.apiKey) || Boolean(value.username && value.password), {
    message: 'Provide an API key, or a username and password.',
    path: ['apiKey'],
  });

/**
 * A mitigation estimate pasted in by the user. The ceiling is generous because
 * a real Xactimate CSV export of a whole-house dryout runs to a few hundred
 * lines, and truncating it would silently drop scope.
 */
const mitigationTextSchema = z.string().max(500_000).optional();

export const startRunSchema = z.object({
  scanProjectId: z.string().trim().min(1, 'Choose a scan project').max(200),
  mitigationText: mitigationTextSchema,
});

export const selectJobSchema = z.object({
  jobId: z.string().trim().min(1, 'Choose a job').max(200),
});

export type CredentialInput = z.infer<typeof credentialSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
