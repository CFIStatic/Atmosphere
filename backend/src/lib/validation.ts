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
