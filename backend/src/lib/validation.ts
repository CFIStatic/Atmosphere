import { z } from 'zod';

/**
 * Input validation schemas. Password rules mirror a sensible baseline; Supabase
 * enforces its own minimum on the server as a second line of defence.
 */

export const credentialsSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'), // bcrypt hard limit
});

export type Credentials = z.infer<typeof credentialsSchema>;

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
