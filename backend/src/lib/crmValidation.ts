import { z } from 'zod';
import { WORK_TYPES } from './validation.js';

/**
 * Validation for the CRM surface.
 *
 * Kept separate from validation.ts, which covers auth and onboarding: the CRM
 * grows a schema per entity and would otherwise swamp that file.
 *
 * Two conventions run through everything here:
 *
 *  - The API speaks camelCase; Postgres speaks snake_case. Each entity owns a
 *    `toRow` translator so the mapping lives in exactly one place.
 *  - `org_id` and `created_by` are NEVER accepted from the client. The server
 *    derives both from the session, and the database refuses to let an UPDATE
 *    move a row between orgs. A request cannot address another company's data
 *    even if it tries.
 */

/* ------------------------------------------------------------------ enums */

export const ACCOUNT_TYPES = [
  'insurance_carrier',
  'property_management',
  'general_contractor',
  'referral_partner',
  'vendor',
  'other',
] as const;

export const CONTACT_TYPES = [
  'homeowner',
  'tenant',
  'adjuster',
  'agent',
  'property_manager',
  'vendor',
  'other',
] as const;

export const LEAD_SOURCES = [
  'referral',
  'insurance_carrier',
  'web',
  'phone',
  'repeat_customer',
  'marketing',
  'other',
] as const;

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'estimate_sent', 'won', 'lost'] as const;

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

export const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'biohazard', 'contents', 'other'] as const;

export const ACTIVITY_KINDS = [
  'note',
  'call',
  'email',
  'sms',
  'meeting',
  'site_visit',
  'task',
  'status_change',
  'system',
] as const;

/* ------------------------------------------------------------- primitives */

const uuid = z.string().uuid('Expected a valid id');
const optionalUuid = uuid.nullish();

/** Trimmed text with a length ceiling; empty string collapses to null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const requiredText = (max: number, label: string) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(320)
  .nullish()
  .or(z.literal('').transform(() => null));

/**
 * Phone numbers arrive from web forms, imports, and field techs typing on a
 * cracked screen. We accept any plausible shape and normalise rather than
 * reject: a lead lost to a validation error costs more than a messy number.
 */
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[0-9+().\-\s xX]*$/, 'Enter a valid phone number')
  .transform((v) => (v === '' ? null : v))
  .nullish();

const money = z
  .number()
  .nonnegative('Amount cannot be negative')
  .max(999_999_999.99, 'Amount is too large')
  .nullish();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .nullish()
  .or(z.literal('').transform(() => null));

const isoDateTime = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Use an ISO-8601 timestamp' })
  .nullish()
  .or(z.literal('').transform(() => null));

/** Address fields shared by accounts, contacts, and properties. */
const addressFields = {
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(120),
  region: text(120),
  postalCode: text(20),
  country: text(2),
};

const addressRow = (v: Record<string, unknown>) => ({
  address_line1: v.addressLine1,
  address_line2: v.addressLine2,
  city: v.city,
  region: v.region,
  postal_code: v.postalCode,
  country: v.country,
});

/**
 * Drops keys the caller did not send.
 *
 * A PATCH that omits `email` must leave the stored email alone, but zod turns
 * an absent optional key into `undefined` — and sending `{email: undefined}` to
 * PostgREST is indistinguishable from sending nothing at all only by accident.
 * Stripping undefined makes partial updates mean what they say, while an
 * explicit `null` still clears the field.
 */
export function pruneUndefined<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/* ---------------------------------------------------------------- queries */

/**
 * Shared list controls. The page cap is deliberate: an unbounded list endpoint
 * is how a CRM with one large tenant takes down everyone else's requests.
 */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  search: z.string().trim().max(120).optional(),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/* --------------------------------------------------------------- accounts */

export const accountCreateSchema = z.object({
  name: requiredText(200, 'Account name'),
  type: z.enum(ACCOUNT_TYPES).default('other'),
  phone,
  email,
  website: text(300),
  notes: text(5000),
  isArchived: z.boolean().optional(),
  ...addressFields,
});

export const accountUpdateSchema = accountCreateSchema.partial();

export const accountToRow = (v: z.infer<typeof accountUpdateSchema>) =>
  pruneUndefined({
    name: v.name,
    type: v.type,
    phone: v.phone,
    email: v.email,
    website: v.website,
    notes: v.notes,
    is_archived: v.isArchived,
    ...addressRow(v),
  });

/* --------------------------------------------------------------- contacts */

export const contactCreateSchema = z
  .object({
    accountId: optionalUuid,
    type: z.enum(CONTACT_TYPES).default('homeowner'),
    firstName: text(80),
    lastName: text(80),
    companyName: text(200),
    title: text(120),
    email,
    phone,
    mobile: phone,
    preferredContactMethod: text(20),
    notes: text(5000),
    marketingOptOut: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    ...addressFields,
  })
  // Mirrors the database's crm_contacts_has_a_name check, so the caller gets a
  // readable message instead of a constraint violation.
  .refine((v) => Boolean(v.firstName || v.lastName || v.companyName), {
    message: 'Give the contact a first name, last name, or company name',
    path: ['lastName'],
  });

export const contactUpdateSchema = contactCreateSchema.innerType().partial();

export const contactToRow = (v: z.infer<typeof contactUpdateSchema>) =>
  pruneUndefined({
    account_id: v.accountId,
    type: v.type,
    first_name: v.firstName,
    last_name: v.lastName,
    company_name: v.companyName,
    title: v.title,
    email: v.email,
    phone: v.phone,
    mobile: v.mobile,
    preferred_contact_method: v.preferredContactMethod,
    notes: v.notes,
    marketing_opt_out: v.marketingOptOut,
    is_archived: v.isArchived,
    ...addressRow(v),
  });

/* ------------------------------------------------------------- properties */

export const propertyCreateSchema = z.object({
  accountId: optionalUuid,
  primaryContactId: optionalUuid,
  label: text(120),
  addressLine1: requiredText(200, 'Street address'),
  addressLine2: text(200),
  city: text(120),
  region: text(120),
  postalCode: text(20),
  country: text(2),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  propertyType: text(60),
  yearBuilt: z.number().int().min(1600).max(2200).nullish(),
  squareFeet: z.number().int().min(0).max(10_000_000).nullish(),
  accessNotes: text(2000),
  isArchived: z.boolean().optional(),
});

export const propertyUpdateSchema = propertyCreateSchema.partial();

export const propertyToRow = (v: z.infer<typeof propertyUpdateSchema>) =>
  pruneUndefined({
    account_id: v.accountId,
    primary_contact_id: v.primaryContactId,
    label: v.label,
    address_line1: v.addressLine1,
    address_line2: v.addressLine2,
    city: v.city,
    region: v.region,
    postal_code: v.postalCode,
    country: v.country,
    latitude: v.latitude,
    longitude: v.longitude,
    property_type: v.propertyType,
    year_built: v.yearBuilt,
    square_feet: v.squareFeet,
    access_notes: v.accessNotes,
    is_archived: v.isArchived,
  });

/* ------------------------------------------------------------------ leads */

export const leadCreateSchema = z.object({
  title: requiredText(200, 'Lead title'),
  contactId: optionalUuid,
  accountId: optionalUuid,
  propertyId: optionalUuid,
  ownerId: optionalUuid,
  source: z.enum(LEAD_SOURCES).default('other'),
  status: z.enum(LEAD_STATUSES).default('new'),
  workType: z.enum(WORK_TYPES).nullish(),
  lossType: z.enum(LOSS_TYPES).nullish(),
  description: text(5000),
  estimatedValue: money,
  lossDate: isoDate,
  lostReason: text(500),
});

export const leadUpdateSchema = leadCreateSchema.partial();

export const leadToRow = (v: z.infer<typeof leadUpdateSchema>) =>
  pruneUndefined({
    title: v.title,
    contact_id: v.contactId,
    account_id: v.accountId,
    property_id: v.propertyId,
    owner_id: v.ownerId,
    source: v.source,
    status: v.status,
    work_type: v.workType,
    loss_type: v.lossType,
    description: v.description,
    estimated_value: v.estimatedValue,
    loss_date: v.lossDate,
    lost_reason: v.lostReason,
  });

/* ------------------------------------------------------------------- jobs */

export const jobCreateSchema = z.object({
  title: requiredText(200, 'Job title'),
  workType: z.enum(WORK_TYPES, { errorMap: () => ({ message: 'Select mitigation or construction' }) }),
  leadId: optionalUuid,
  contactId: optionalUuid,
  accountId: optionalUuid,
  propertyId: optionalUuid,
  ownerId: optionalUuid,
  lossType: z.enum(LOSS_TYPES).nullish(),
  status: z.enum(JOB_STATUSES).default('draft'),
  priority: z.number().int().min(1).max(5).default(3),
  description: text(5000),

  carrierAccountId: optionalUuid,
  adjusterContactId: optionalUuid,
  claimNumber: text(80),
  policyNumber: text(80),
  deductible: money,

  lossDate: isoDate,
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  actualStart: isoDateTime,
  actualEnd: isoDateTime,

  contractAmount: money,
  invoicedAmount: money,
  paidAmount: money,
});

export const jobUpdateSchema = jobCreateSchema.partial();

export const jobToRow = (v: z.infer<typeof jobUpdateSchema>) =>
  pruneUndefined({
    title: v.title,
    work_type: v.workType,
    lead_id: v.leadId,
    contact_id: v.contactId,
    account_id: v.accountId,
    property_id: v.propertyId,
    owner_id: v.ownerId,
    loss_type: v.lossType,
    status: v.status,
    priority: v.priority,
    description: v.description,
    carrier_account_id: v.carrierAccountId,
    adjuster_contact_id: v.adjusterContactId,
    claim_number: v.claimNumber,
    policy_number: v.policyNumber,
    deductible: v.deductible,
    loss_date: v.lossDate,
    scheduled_start: v.scheduledStart,
    scheduled_end: v.scheduledEnd,
    actual_start: v.actualStart,
    actual_end: v.actualEnd,
    contract_amount: v.contractAmount,
    invoiced_amount: v.invoicedAmount,
    paid_amount: v.paidAmount,
  });

/** Body of POST /api/crm/leads/:id/convert — turn a won lead into a job. */
export const leadConvertSchema = z.object({
  title: text(200),
  workType: z.enum(WORK_TYPES).nullish(),
  status: z.enum(JOB_STATUSES).default('scheduled'),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  contractAmount: money,
});

/* ------------------------------------------------------------- activities */

export const activityCreateSchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS).default('note'),
    subject: text(200),
    body: text(10_000),
    contactId: optionalUuid,
    accountId: optionalUuid,
    propertyId: optionalUuid,
    leadId: optionalUuid,
    jobId: optionalUuid,
    assignedTo: optionalUuid,
    dueAt: isoDateTime,
    completedAt: isoDateTime,
    occurredAt: isoDateTime,
  })
  .refine((v) => Boolean(v.contactId || v.accountId || v.propertyId || v.leadId || v.jobId), {
    message: 'Attach the activity to a contact, account, property, lead, or job',
    path: ['jobId'],
  });

export const activityUpdateSchema = activityCreateSchema.innerType().partial();

export const activityToRow = (v: z.infer<typeof activityUpdateSchema>) =>
  pruneUndefined({
    kind: v.kind,
    subject: v.subject,
    body: v.body,
    contact_id: v.contactId,
    account_id: v.accountId,
    property_id: v.propertyId,
    lead_id: v.leadId,
    job_id: v.jobId,
    assigned_to: v.assignedTo,
    due_at: v.dueAt,
    completed_at: v.completedAt,
    occurred_at: v.occurredAt,
  });

/* ----------------------------------------------------------- integrations */

export const SOURCE_KINDS = ['rest', 'salesforce', 'browser_crm', 'csv', 'webhook', 'manual'] as const;

export const sourceCreateSchema = z.object({
  system: requiredText(60, 'System name'),
  label: requiredText(120, 'Label'),
  kind: z.enum(SOURCE_KINDS).default('rest'),
  config: z.record(z.unknown()).default({}),
  // The NAME of a server-side secret, never the secret. Constrained to an
  // identifier shape so a source row cannot make the server read an arbitrary
  // environment variable.
  credentialRef: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{1,64}$/, 'Use A–Z, 0–9 and underscores for a credential reference')
    .nullish()
    .or(z.literal('').transform(() => null)),
  enabled: z.boolean().default(true),
  syncIntervalMinutes: z.number().int().min(5).max(43_200).default(1440),
  direction: z.enum(['pull', 'push', 'bidirectional']).optional(),
});

export const sourceUpdateSchema = sourceCreateSchema.partial();

export const sourceToRow = (v: z.infer<typeof sourceUpdateSchema>) =>
  pruneUndefined({
    system: v.system,
    label: v.label,
    kind: v.kind,
    config: v.config,
    credential_ref: v.credentialRef,
    enabled: v.enabled,
    sync_interval_minutes: v.syncIntervalMinutes,
    direction: v.direction,
  });

/** Connect a catalog CRM from the UI — may include a sealed secret payload. */
export const connectCrmSchema = z.object({
  system: requiredText(60, 'CRM system'),
  label: text(120),
  direction: z.enum(['pull', 'push', 'bidirectional']).default('bidirectional'),
  sandbox: z.boolean().optional(),
  baseUrl: text(500),
  config: z.record(z.unknown()).optional(),
  // Opaque secret fields — sealed server-side; never echoed back.
  credentials: z
    .object({
      apiKey: z.string().trim().max(2000).optional(),
      username: z.string().trim().max(320).optional(),
      password: z.string().max(500).optional(),
      securityToken: z.string().trim().max(200).optional(),
      accountId: z.string().trim().max(200).optional(),
      baseUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
      instanceUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
      accessToken: z.string().trim().max(4000).optional(),
      refreshToken: z.string().trim().max(4000).optional(),
    })
    .optional(),
  /** Still supported: name an ATM_INTEGRATION_* env var instead of sealing. */
  credentialRef: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{1,64}$/)
    .nullish()
    .or(z.literal('').transform(() => null)),
  syncIntervalMinutes: z.number().int().min(5).max(43_200).default(1440),
});

export const pushCrmSchema = z.object({
  operation: z.enum(['create_note', 'create_task', 'create_contact', 'update_contact']),
  entityType: text(60),
  externalId: text(200),
  contactId: optionalUuid,
  subject: text(300),
  body: text(20_000),
  fields: z.record(z.unknown()).optional(),
});

/** Body of POST /api/integrations/sources/:id/import — a manual CSV drop. */
export const csvImportSchema = z.object({
  entityType: requiredText(60, 'Entity type'),
  // The CSV itself. Capped well below the JSON body limit raised for this route.
  csv: z.string().min(1, 'Provide CSV content').max(8 * 1024 * 1024, 'CSV is too large'),
  // Which column holds the external system's primary key.
  idColumn: requiredText(120, 'Id column'),
  delimiter: z.string().length(1).default(','),
});

/* ---------------------------------------------------------------- backups */

export const backupCreateSchema = z.object({
  // Operators may request a platform-wide archive; tenants get their own org.
  scope: z.enum(['org', 'platform']).default('org'),
});

export const backupListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const auditQuerySchema = z.object({
  table: z.string().trim().max(60).optional(),
  rowId: z.string().uuid().optional(),
  since: z.string().trim().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
