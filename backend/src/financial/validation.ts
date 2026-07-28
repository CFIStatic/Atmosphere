import { z } from 'zod';
import {
  COST_CATEGORIES,
  COST_ORIGINS,
  COST_STATUSES,
  FINANCE_ACCESS_MODES,
  FINANCE_ACCESS_PATHS,
  FINANCE_CONNECTION_KINDS,
  FINANCE_PROVIDERS,
  FINANCE_ACCOUNT_TYPES,
  ALERT_STATUSES,
} from './types.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' || v === undefined ? null : v));

const uuid = z.string().uuid();
const optionalUuid = uuid.nullish().transform((v) => v ?? null);

const cents = z.number().int().min(0);
const credentialRef = z
  .string()
  .regex(/^[A-Z0-9_]{1,64}$/)
  .nullish()
  .transform((v) => v ?? null);

export const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: text(64).optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
    arWarnDays: z.number().int().min(1).max(365).optional(),
    arCriticalDays: z.number().int().min(1).max(365).optional(),
    marginFloorPct: z.number().min(0).max(100).optional(),
    overBudgetPct: z.number().min(50).max(500).optional(),
    unbilledCostWarnCents: cents.optional(),
    cashFloorCents: cents.optional(),
    connectionStaleHours: z.number().int().min(1).max(720).optional(),
    booksBalanceToleranceCents: cents.optional(),
    defaultLaborRateCents: cents.optional(),
    disabledRules: z.array(z.string().min(1).max(64)).max(64).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.arWarnDays === undefined ||
      v.arCriticalDays === undefined ||
      v.arCriticalDays >= v.arWarnDays,
    { message: 'Critical AR days must be at least the warn threshold.' },
  );

export const connectionCreateSchema = z
  .object({
    label: text(120),
    kind: z.enum(FINANCE_CONNECTION_KINDS),
    provider: z.enum(FINANCE_PROVIDERS),
    accessPath: z.enum(FINANCE_ACCESS_PATHS).default('api'),
    // Bank/accounting links default to observe-only. draft_writes still never
    // posts without a human approving a draft elsewhere.
    accessMode: z.enum(FINANCE_ACCESS_MODES).default('read_only'),
    config: z.record(z.unknown()).default({}),
    credentialRef,
    webConnectionId: optionalUuid,
    computerMachineId: optionalUuid,
    enabled: z.boolean().default(true),
  })
  .strict();

export const connectionCreateInputSchema = connectionCreateSchema.superRefine((v, ctx) => {
  if (v.kind === 'bank' && !['plaid', 'bank_portal', 'manual'].includes(v.provider)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Bank connections use plaid, bank_portal, or manual.',
      path: ['provider'],
    });
  }
  if (v.kind === 'accounting' && ['plaid', 'bank_portal'].includes(v.provider)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Accounting connections cannot use a bank-only provider.',
      path: ['provider'],
    });
  }
});

export const connectionUpdateSchema = connectionCreateSchema.partial().strict();

export const accountCreateSchema = z
  .object({
    connectionId: optionalUuid,
    name: text(160),
    accountType: z.enum(FINANCE_ACCOUNT_TYPES),
    currency: z.string().length(3).default('USD'),
    balanceCents: z.number().int().nullish().transform((v) => v ?? null),
    externalId: optionalText(120),
    isActive: z.boolean().default(true),
  })
  .strict();

export const costCodeCreateSchema = z
  .object({
    code: text(32),
    label: text(120),
    category: z.enum(COST_CATEGORIES).default('other'),
    isActive: z.boolean().default(true),
  })
  .strict();

export const costCodeUpdateSchema = costCodeCreateSchema.partial().strict();

export const jobCostCreateSchema = z
  .object({
    jobId: optionalUuid,
    pmProjectId: optionalUuid,
    costCodeId: optionalUuid,
    category: z.enum(COST_CATEGORIES),
    description: optionalText(2000),
    quantity: z.number().positive().max(1_000_000).default(1),
    unit: text(16).default('EA'),
    unitCostCents: cents,
    amountCents: cents.optional(),
    incurredOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    origin: z.enum(COST_ORIGINS).default('manual'),
    status: z.enum(COST_STATUSES).default('posted'),
  })
  .strict()
  .refine((v) => v.jobId || v.pmProjectId, {
    message: 'A job cost line needs a CRM job or a PM project.',
  });

export const jobCostUpdateSchema = z
  .object({
    costCodeId: optionalUuid,
    category: z.enum(COST_CATEGORIES).optional(),
    description: optionalText(2000),
    quantity: z.number().positive().max(1_000_000).optional(),
    unit: text(16).optional(),
    unitCostCents: cents.optional(),
    amountCents: cents.optional(),
    incurredOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z.enum(COST_STATUSES).optional(),
  })
  .strict();

export const alertActionSchema = z
  .object({
    status: z.enum(ALERT_STATUSES),
    snoozeHours: z.number().int().min(1).max(24 * 30).optional(),
  })
  .strict();

export const briefQuerySchema = z.object({
  refresh: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const jobCostQuerySchema = z.object({
  jobId: uuid.optional(),
  status: z.enum(COST_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
