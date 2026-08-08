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

/**
 * Body of a password change made from Settings by a signed-in user. The current
 * password is required: a live session alone must not be enough to rewrite the
 * credential, or an unattended browser becomes a full account takeover.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Enter your current password' }).min(1, 'Enter your current password'),
    newPassword: passwordField,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Your new password must be different from your current one',
    path: ['newPassword'],
  });

/** Body of a profile update. Only the display name is user-editable. */
export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .max(80, 'Name must be at most 80 characters')
    // An empty string clears the name and falls the UI back to the email.
    .transform((value) => (value === '' ? null : value))
    .nullable(),
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

/** What kind of contractor the organization is. */
export const CONTRACTOR_TYPES = [
  'restoration',
  'roofing',
  'general_contractor',
  'other',
] as const;

/** How a member plans to use Atmosphere — multi-select during onboarding. */
export const USAGE_INTENTS = [
  'mitigation_estimating',
  'construction_estimating',
  'project_management',
  'crm',
  'web_access',
  'field_work',
  'billing',
  'financial',
  'exploring',
] as const;

const roleSchema = z.enum(MEMBER_ROLES, {
  errorMap: () => ({ message: 'Select a valid account type' }),
});
const workTypeSchema = z.enum(WORK_TYPES, {
  errorMap: () => ({ message: 'Select mitigation or construction' }),
});
const contractorTypeSchema = z.enum(CONTRACTOR_TYPES, {
  errorMap: () => ({ message: 'Select what kind of contractor you are' }),
});
const usageIntentsSchema = z
  .array(z.enum(USAGE_INTENTS, { errorMap: () => ({ message: 'Select a valid use for Atmosphere' }) }))
  .min(1, 'Pick at least one way you plan to use Atmosphere')
  .max(USAGE_INTENTS.length)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Remove duplicate selections',
  });

export const createOrgSchema = z.object({
  name: z.string({ required_error: 'Organization name is required' }).trim().min(2, 'Organization name is too short').max(80, 'Organization name is too long'),
  role: roleSchema,
  workType: workTypeSchema,
  contractorType: contractorTypeSchema,
  usageIntents: usageIntentsSchema,
});

/** Body of a membership update — a member editing their own role / work type / usage. */
export const updateMembershipSchema = z.object({
  role: roleSchema,
  workType: workTypeSchema,
  usageIntents: usageIntentsSchema,
});

/** Body of an org-profile update — contractor type for the caller's organization. */
export const updateOrgProfileSchema = z.object({
  contractorType: contractorTypeSchema,
});

export const joinOrgSchema = z.object({
  joinCode: z
    .string({ required_error: 'Join code is required' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, 'Enter a valid join code'),
  role: roleSchema,
  workType: workTypeSchema,
  usageIntents: usageIntentsSchema,
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type JoinOrgInput = z.infer<typeof joinOrgSchema>;
export type UpdateOrgProfileInput = z.infer<typeof updateOrgProfileSchema>;

/* ---------------------------------------------------------------------------
 * Growth analytics
 * ------------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid date')
  .transform((value) => new Date(value));

/**
 * The reporting window. Defaults to the last 30 days; the range is clamped so a
 * hand-edited URL cannot ask the database for a decade of rows, and an inverted
 * range is rejected rather than silently returning nothing.
 */
export const analyticsRangeSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    months: z.coerce.number().int().min(1).max(60).default(24),
  })
  .transform(({ from, to, months }) => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * DAY_MS);
    return { from: start, to: end, months };
  })
  .refine(({ from, to }) => from < to, {
    message: 'The start of the range must come before the end',
    path: ['from'],
  })
  .refine(({ from, to }) => to.getTime() - from.getTime() <= 3660 * DAY_MS, {
    message: 'Ranges longer than ten years are not supported',
    path: ['to'],
  });

export const analyticsDatasetSchema = z.enum([
  'all',
  'summary',
  'monthly',
  'features',
  'plans',
  'retention',
  'accounts',
]);

/**
 * A single feature heartbeat. `deltaMs` is additionally clamped in the database,
 * which is the boundary that actually matters — this only rejects nonsense early.
 */
export const featureHeartbeatSchema = z.object({
  featureKey: z
    .string({ required_error: 'featureKey is required' })
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,48}$/, 'Unknown feature'),
  sessionId: z.string().trim().uuid().optional().nullable(),
  deltaMs: z.coerce.number().int().min(0).max(300000).default(0),
  interactions: z.coerce.number().int().min(0).max(1000).default(0),
  client: z.enum(['web', 'mobile', 'desktop', 'api']).default('web'),
});

/* -------------------------------------------------------------------------
 * Audit ledger
 *
 * These mirror the check constraints in db/audit_ledger.sql. Validating here
 * as well is not redundant: a rejected insert reaches the caller as an opaque
 * Postgres error, and an agent posting its own trace deserves to be told which
 * field it got wrong.
 * ---------------------------------------------------------------------- */

export const AGENT_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const AGENT_ACTOR_TYPES = ['user', 'system', 'schedule', 'agent'] as const;
export const AGENT_STEP_STATUSES = ['ok', 'error', 'pending'] as const;

/**
 * 'event' is the catch-all, and it is what an unrecognised type is coerced to
 * rather than rejected — losing a step is the one outcome an audit trail
 * cannot afford, so an agent ahead of this list still gets recorded.
 */
export const AGENT_STEP_TYPES = [
  'status',
  'thought',
  'message',
  'tool_call',
  'tool_result',
  'observation',
  'navigation',
  'decision',
  'artifact',
  'usage',
  'error',
  'event',
] as const;

const agentKeyField = z
  .string({ required_error: 'agentKey is required' })
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,48}$/, 'agentKey must be lower_snake_case');

/** Unknown step types degrade to 'event' instead of failing the write. */
const stepTypeField = z
  .string()
  .optional()
  .transform((value) =>
    value && (AGENT_STEP_TYPES as readonly string[]).includes(value) ? value : 'event',
  );

export const auditStepSchema = z.object({
  type: stepTypeField,
  action: z.string().trim().max(120).optional().nullable(),
  detail: z.string().max(8000).optional().nullable(),
  target: z.string().max(2000).optional().nullable(),
  payload: z.unknown().optional(),
  status: z.enum(AGENT_STEP_STATUSES).optional(),
  error: z.string().max(4000).optional().nullable(),
  seq: z.number().int().positive().optional(),
  startedAt: z.string().datetime({ offset: true }).optional().nullable(),
  finishedAt: z.string().datetime({ offset: true }).optional().nullable(),
  durationMs: z.number().int().nonnegative().optional().nullable(),
});

export const auditStepsSchema = z.object({
  steps: z.array(auditStepSchema).min(1, 'Send at least one step').max(200, 'Send at most 200 steps at a time'),
});

/**
 * What an agent may declare when opening a run.
 *
 * `orgId` is deliberately absent: it comes from the caller's membership, so a
 * caller cannot file work against an organization they do not belong to even
 * before RLS gets a say. `sourceTable`/`sourceId` are absent for the same kind
 * of reason — provenance is stamped by the database bridges, and letting a
 * client claim it would let it collide with a mirrored row.
 */
export const auditRunCreateSchema = z.object({
  agentKey: agentKeyField,
  title: z.string({ required_error: 'title is required' }).trim().min(1, 'title is required').max(500),
  agentLabel: z.string().trim().max(120).optional().nullable(),
  actorType: z.enum(AGENT_ACTOR_TYPES).optional(),
  actorLabel: z.string().trim().max(120).optional().nullable(),
  parentRunId: z.string().uuid('parentRunId must be a run id').optional().nullable(),
  status: z.enum(AGENT_RUN_STATUSES).optional(),
  input: z.unknown().optional(),
  startedAt: z.string().datetime({ offset: true }).optional().nullable(),
  /** Opening a run and recording its first steps in one call. */
  steps: z.array(auditStepSchema).max(200).optional(),
});

export const auditRunPatchSchema = z
  .object({
    status: z.enum(AGENT_RUN_STATUSES).optional(),
    summary: z.string().max(4000).optional().nullable(),
    result: z.unknown().optional(),
    error: z.string().max(4000).optional().nullable(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    finishedAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

/** Filters behind the Audit tab's run list. All optional; all narrowing. */
export const auditRunQuerySchema = z.object({
  agent: agentKeyField.optional(),
  status: z.enum(AGENT_RUN_STATUSES).optional(),
  actorType: z.enum(AGENT_ACTOR_TYPES).optional(),
  actorUserId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Keyset cursor, "<iso timestamp>|<run id>", from the previous page. */
  cursor: z.string().max(120).optional(),
});

export type AuditRunQuery = z.infer<typeof auditRunQuerySchema>;
export type AuditStepInput = z.infer<typeof auditStepSchema>;
/* ==========================================================================
 * Agent Memory — jobs, tasks, crew assignments and work logs
 *
 * These mirror the CHECK constraints in the migration. Validating here as well
 * is not redundant: it turns a Postgres constraint violation into a field-level
 * message the form can render, while the database stays the actual authority.
 * ========================================================================== */

/** crm_job_status — the CRM owns the job lifecycle; this mirrors its enum. */
export const JOB_STATUSES = [
  'draft',
  'scheduled',
  'in_progress',
  'on_hold',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
] as const;

/** crm_jobs.priority is a smallint 1-5, 1 being the most urgent. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;

/** crm_loss_type. */
export const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'biohazard', 'contents', 'other'] as const;

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const WORK_LOG_KINDS = [
  'work',
  'note',
  'call',
  'site_visit',
  'photo',
  'material',
  'issue',
] as const;
export const ASSIGNMENT_ROLES = ['lead', 'crew', 'estimator', 'supervisor', 'observer'] as const;

const jobStatusSchema = z.enum(JOB_STATUSES, {
  errorMap: () => ({ message: 'Select a valid job status' }),
});
const jobPrioritySchema = z
  .number()
  .int()
  .min(1, 'Priority runs from 1 (most urgent) to 5')
  .max(5, 'Priority runs from 1 (most urgent) to 5');
const taskStatusSchema = z.enum(TASK_STATUSES, {
  errorMap: () => ({ message: 'Select a valid task status' }),
});
const taskPrioritySchema = z.enum(TASK_PRIORITIES, {
  errorMap: () => ({ message: 'Select a valid priority' }),
});

/** Optional free-text field: '' from an untouched form input means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const optionalDate = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid date' })
  .optional()
  .nullable();

/**
 * Opening a job writes to `crm_jobs`. This is the field-facing subset — the
 * fuller CRUD, with financials and the links to accounts, contacts and
 * properties, stays with `/api/crm/jobs`. Customer and address are absent on
 * purpose: they live on `crm_contacts` and `crm_properties`, not on the job.
 */
export const createJobSchema = z.object({
  title: z
    .string({ required_error: 'Job name is required' })
    .trim()
    .min(2, 'Job name is too short')
    .max(200, 'Job name is too long'),
  workType: workTypeSchema,
  description: optionalText(4000),
  lossType: z.enum(LOSS_TYPES).optional(),
  priority: jobPrioritySchema.optional(),
  status: jobStatusSchema.optional(),
  claimNumber: optionalText(60),
  policyNumber: optionalText(60),
  ownerId: z.string().uuid('Select a valid team member').optional().nullable(),
  scheduledStart: optionalDate,
});

/** Every field optional — a PATCH may carry just the one thing that changed. */
export const updateJobSchema = createJobSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'Task title is required' })
    .trim()
    .min(2, 'Task title is too short')
    .max(200, 'Task title is too long'),
  details: optionalText(4000),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignedTo: z.string().uuid('Select a valid team member').optional().nullable(),
  dueAt: optionalDate,
  position: z.number().int().min(0).max(100_000).optional(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createWorkLogSchema = z.object({
  kind: z.enum(WORK_LOG_KINDS, { errorMap: () => ({ message: 'Select a valid entry type' }) }),
  body: z
    .string({ required_error: 'Describe the work' })
    .trim()
    .min(1, 'Describe the work')
    .max(8000, 'That entry is too long'),
  taskId: z.string().uuid().optional().nullable(),
  minutes: z
    .number()
    .int('Minutes must be a whole number')
    .min(0, 'Minutes cannot be negative')
    .max(24 * 60, 'That is more than a day')
    .optional()
    .nullable(),
  occurredAt: optionalDate,
});

export const updateWorkLogSchema = z.object({
  body: z.string().trim().min(1, 'Describe the work').max(8000, 'That entry is too long').optional(),
  kind: z.enum(WORK_LOG_KINDS).optional(),
  minutes: z.number().int().min(0).max(24 * 60).optional().nullable(),
});

export const assignAgentSchema = z.object({
  userId: z.string({ required_error: 'Choose a team member' }).uuid('Choose a valid team member'),
  roleOnJob: z
    .enum(ASSIGNMENT_ROLES, { errorMap: () => ({ message: 'Select a valid role' }) })
    .optional(),
});

/**
 * Query parameters for the memory feed. Everything arrives as a string from the
 * URL, so numbers are coerced. `before` is the opaque cursor: the `seq` of the
 * oldest row already shown.
 */
export const memoryQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.enum(['job', 'task', 'assignment', 'work_log', 'session']).optional(),
  eventType: z.string().trim().max(60).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  search: z.string().trim().max(120).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateWorkLogInput = z.infer<typeof createWorkLogSchema>;
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;
/* ---- Technician app ---- */

/**
 * One prior turn of the voice conversation. The client owns the transcript
 * (nothing is persisted server-side) and replays it on each request, so the
 * assistant stays stateless like the rest of the backend.
 */
const assistantTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});

export type AssistantTurn = z.infer<typeof assistantTurnSchema>;

/**
 * What the assistant is told about the caller and their surroundings. Every
 * field is optional — the client sends whatever it happens to know.
 */
const assistantContextSchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  workType: z.enum(WORK_TYPES).optional(),
  orgName: z.string().trim().max(80).optional(),
  /** Labels from the in-browser object detector, most confident first. */
  detectedObjects: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export type AssistantContext = z.infer<typeof assistantContextSchema>;

export const assistantSchema = z.object({
  message: z
    .string({ required_error: 'Say something first' })
    .trim()
    .min(1, 'Say something first')
    .max(4000, 'That message is too long'),
  history: z.array(assistantTurnSchema).max(40).default([]),
  context: assistantContextSchema.optional(),
});
/* ---------------------------------------------------------------- billing -- */

/** Subscription tiers. `enterprise` is quote-only and rejected by the database. */
export const PLAN_CODES = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'enterprise'] as const;

export const setPlanSchema = z.object({
  planCode: z.enum(PLAN_CODES, { errorMap: () => ({ message: 'Select a valid plan' }) }),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
  seats: z.number().int().min(1, 'At least one seat').max(10000, 'Too many seats').default(1),
});

/** Optional post-checkout return path — must be a same-origin relative path. */
export const onboardingCheckoutSchema = z.object({
  returnPath: z
    .string()
    .max(500)
    .optional()
    .refine((value) => !value || (value.startsWith('/') && !value.startsWith('//')), {
      message: 'returnPath must be a relative path',
    }),
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

/* ---- App Connectors --------------------------------------------------- */

const connectorAccessModeSchema = z.enum(['web', 'computer', 'api'], {
  errorMap: () => ({ message: 'Choose Web Access, Computer Use, or API' }),
});

/**
 * Connect (or reconnect) a curated third-party app. Credentials are mode-
 * specific: web needs username/password, api needs an API key or login pair,
 * computer needs none (the paired desktop already has the session).
 */
export const connectAppConnectorSchema = z.object({
  connectorKey: z
    .string({ required_error: 'Choose an app' })
    .trim()
    .min(2, 'Choose an app')
    .max(64, 'That app id is too long'),
  accessMode: connectorAccessModeSchema,
  label: z.string().trim().min(2).max(80).optional(),
  siteUrl: siteUrlField.optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  loginUrl: siteUrlField.optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  apiKey: z.string().trim().max(2000).optional(),
  accountId: z.string().trim().max(200).optional(),
  baseUrl: siteUrlField.optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
});

export const updateAppConnectorSchema = z
  .object({
    label: z.string().trim().min(2).max(80).optional(),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : v)),
    status: z.enum(['connected', 'needs_attention', 'disabled']).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update',
  });

export const startConnectorRunSchema = z.object({
  templateId: z.string().trim().min(1).max(64).optional(),
  kind: z.enum(['pull', 'push']).optional(),
  instruction: z.string().trim().max(4000).optional(),
  data: z.unknown().optional(),
});

export type ConnectAppConnectorInput = z.infer<typeof connectAppConnectorSchema>;
export type StartConnectorRunInput = z.infer<typeof startConnectorRunSchema>;

/**
 * A job application from the corporate site's careers page. `website` is a
 * honeypot — the field is invisible in the browser, so a non-empty value means
 * a bot filled the form; the route accepts and discards it.
 */
export const careersApplicationSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(200),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address'),
  role: z.string({ required_error: 'Pick a role' }).trim().min(1, 'Pick a role').max(200),
  links: z.string().trim().max(1000).optional().default(''),
  message: z
    .string({ required_error: 'Tell us something about your work' })
    .trim()
    .min(10, 'Tell us a little more — a sentence or two is plenty')
    .max(10_000, 'That message is longer than we can take in one go'),
  website: z.string().max(200).optional().default(''),
});

export type CareersApplication = z.infer<typeof careersApplicationSchema>;


/**
 * A message from the corporate site's contact form. Same honeypot convention
 * as the careers application: `website` is invisible in the browser, so a
 * non-empty value means a bot filled the form.
 */
export const contactMessageSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(200),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address'),
  company: z.string().trim().max(200).optional().default(''),
  teamSize: z.string().trim().max(50).optional().default(''),
  workType: z.string().trim().max(50).optional().default(''),
  message: z
    .string({ required_error: 'Tell us what you need' })
    .trim()
    .min(10, 'Tell us a little more — a sentence or two is plenty')
    .max(10_000, 'That message is longer than we can take in one go'),
  website: z.string().max(200).optional().default(''),
});

export type ContactMessage = z.infer<typeof contactMessageSchema>;
