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
