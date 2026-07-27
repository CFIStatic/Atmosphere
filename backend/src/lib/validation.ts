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
