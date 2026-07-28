import { z } from 'zod';
import {
  ALERT_STATUSES,
  DOCUMENT_STATUSES,
  EQUIPMENT_KINDS,
  LOSS_TYPES,
  MATERIALS,
  MILESTONE_KINDS,
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  READING_KINDS,
  TASK_CATEGORIES,
  TASK_STATUSES,
  UPDATE_AUDIENCES,
  WORK_TYPES,
} from './types.js';
import { isPhaseValidFor } from './playbooks.js';

/**
 * Input validation for the Project Manager routes.
 *
 * Kept in the module rather than in `lib/validation.ts` because the schemas
 * reference the domain's own enums — the same reason the estimator keeps its
 * own. The rule shared with the rest of the backend is the important one: every
 * route parses its body before anything touches the database.
 */

const uuid = z.string().uuid('Expected an id');
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .optional();

const money = z.number().int().min(0).max(1_000_000_000).optional();

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

const projectFields = {
  name: shortText(160),
  description: optionalText(4000),
  workType: z.enum(WORK_TYPES),
  lossType: z.enum(LOSS_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  pmUserId: uuid.optional().nullable(),
  customerName: optionalText(160),
  customerPhone: optionalText(40),
  customerEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(20),
  carrier: optionalText(160),
  claimNumber: optionalText(80),
  adjusterName: optionalText(160),
  adjusterEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  adjusterPhone: optionalText(40),
  deductibleCents: money,
  approvedAmountCents: money,
  lossAt: isoDate,
  scheduledStartAt: isoDate,
  targetCompletionAt: isoDate,
};

export const createProjectSchema = z.object(projectFields);

export const updateProjectSchema = z
  .object({
    ...projectFields,
    name: shortText(160).optional(),
    workType: z.enum(WORK_TYPES).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    phase: z.enum(PROJECT_PHASES).optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/**
 * A phase must belong to the project's own workflow.
 *
 * The database check accepts the union of both trades' phases, because that
 * mapping changes more often than the schema should — which leaves this as the
 * place that stops a mitigation job being moved to `permitting`.
 */
export function assertPhaseAllowed(workType: string, phase: string | undefined): void {
  if (!phase) return;
  if (!isPhaseValidFor(workType as never, phase as never)) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['phase'],
        message: `“${phase}” is not a phase a ${workType} project goes through.`,
      },
    ]);
  }
}

export const projectQuerySchema = z.object({
  status: z.string().optional(),
  phase: z.enum(PROJECT_PHASES).optional(),
  workType: z.enum(WORK_TYPES).optional(),
  mine: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export const createTaskSchema = z.object({
  title: shortText(200),
  details: optionalText(4000),
  category: z.enum(TASK_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: uuid.optional().nullable(),
  dueAt: isoDate,
  position: z.number().int().min(0).max(10_000).optional(),
});

export const updateTaskSchema = z
  .object({
    title: shortText(200).optional(),
    details: optionalText(4000),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    assignedTo: uuid.nullable().optional(),
    dueAt: isoDate,
    position: z.number().int().min(0).max(10_000).optional(),
    blockedReason: optionalText(500),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(
    (v) => v.status !== 'blocked' || Boolean(v.blockedReason),
    { message: 'Say why it is blocked.', path: ['blockedReason'] },
  );

/* ------------------------------------------------------------------ *
 * Crew
 * ------------------------------------------------------------------ */

export const assignCrewSchema = z.object({
  userId: uuid,
  roleOnProject: z.enum(['lead', 'crew', 'estimator', 'supervisor', 'observer']).optional(),
  allocationPct: z.number().int().min(1).max(100).optional(),
});

/* ------------------------------------------------------------------ *
 * Equipment
 * ------------------------------------------------------------------ */

export const createEquipmentSchema = z.object({
  assetTag: shortText(40),
  kind: z.enum(EQUIPMENT_KINDS),
  makeModel: optionalText(120),
  capacityPintsDay: z.number().int().min(1).max(2000).optional(),
  capacityCfm: z.number().int().min(1).max(50_000).optional(),
  dailyRateCents: money,
});

export const placeEquipmentSchema = z.object({
  equipmentId: uuid,
  areaLabel: optionalText(120),
  billedRateCents: money,
});

/* ------------------------------------------------------------------ *
 * Drying
 * ------------------------------------------------------------------ */

export const createAreaSchema = z.object({
  label: shortText(120),
  material: z.enum(MATERIALS).optional(),
  dryGoalPct: z.number().min(0.1).max(100),
  waterClass: z.number().int().min(1).max(4).optional(),
  affectedSqft: z.number().min(0).max(1_000_000).optional(),
  affectedCuft: z.number().min(0).max(10_000_000).optional(),
});

export const updateAreaSchema = z
  .object({
    label: shortText(120).optional(),
    dryGoalPct: z.number().min(0.1).max(100).optional(),
    waterClass: z.number().int().min(1).max(4).optional(),
    affectedSqft: z.number().min(0).max(1_000_000).optional(),
    affectedCuft: z.number().min(0).max(10_000_000).optional(),
    /** Sign-off is a decision, so it is explicit rather than a timestamp field. */
    signOff: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const readingSchema = z
  .object({
    areaId: uuid.optional().nullable(),
    kind: z.enum(READING_KINDS).optional(),
    moisturePct: z.number().min(0).max(100).optional(),
    temperatureF: z.number().min(-40).max(200).optional(),
    humidityPct: z.number().min(0).max(100).optional(),
    note: optionalText(2000),
    takenAt: isoDate,
  })
  .refine(
    (r) =>
      r.moisturePct !== undefined ||
      (r.temperatureF !== undefined && r.humidityPct !== undefined),
    {
      message: 'A reading needs a moisture value, or a temperature and humidity pair.',
      path: ['moisturePct'],
    },
  );

/** Readings arrive in batches — a crew logs a whole visit at once. */
export const createReadingsSchema = z.object({
  readings: z.array(readingSchema).min(1).max(200),
});

/* ------------------------------------------------------------------ *
 * Documents and milestones
 * ------------------------------------------------------------------ */

export const updateDocumentSchema = z
  .object({
    status: z.enum(DOCUMENT_STATUSES).optional(),
    externalRef: optionalText(2000),
    note: optionalText(2000),
    waivedReason: optionalText(500),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => v.status !== 'waived' || Boolean(v.waivedReason), {
    message: 'Waiving a requirement needs a reason.',
    path: ['waivedReason'],
  });

export const createMilestoneSchema = z.object({
  label: shortText(160),
  kind: z.enum(MILESTONE_KINDS).optional(),
  dueAt: z.string().datetime({ offset: true }),
  note: optionalText(2000),
});

export const updateMilestoneSchema = z
  .object({
    label: shortText(160).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    note: optionalText(2000),
    complete: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/* ------------------------------------------------------------------ *
 * Alerts, updates, settings
 * ------------------------------------------------------------------ */

export const alertActionSchema = z
  .object({
    status: z.enum(ALERT_STATUSES),
    /** Required for a snooze; ignored otherwise. */
    snoozeHours: z.number().int().min(1).max(720).optional(),
  })
  .refine((v) => v.status !== 'snoozed' || v.snoozeHours !== undefined, {
    message: 'Say how long to snooze it for.',
    path: ['snoozeHours'],
  });

export const draftUpdateSchema = z.object({
  audience: z.enum(UPDATE_AUDIENCES),
  instruction: optionalText(1000),
});

export const updateDraftSchema = z.object({
  status: z.enum(['approved', 'sent', 'discarded']),
});

export const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-CA', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Not a recognised time zone')
      .optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
    readingIntervalHours: z.number().int().min(4).max(168).optional(),
    dryingStallDays: z.number().int().min(1).max(14).optional(),
    dryingProgressMinPct: z.number().min(0).max(20).optional(),
    equipmentIdleHours: z.number().int().min(1).max(336).optional(),
    staleProjectDays: z.number().int().min(1).max(60).optional(),
    milestoneLeadDays: z.number().int().min(0).max(30).optional(),
    maxProjectsPerCrew: z.number().int().min(1).max(50).optional(),
    disabledRules: z.array(z.string().max(80)).max(100).optional(),
    autoCreateTasks: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const briefQuerySchema = z.object({
  kind: z.enum(['morning', 'end_of_day', 'ad_hoc']).optional(),
  refresh: z.enum(['true', 'false']).optional(),
});

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

const platforms = z.enum(['dash', 'xactanalysis', 'xactimate', 'outlook']);
const channels = z.enum([
  'imessage',
  'whatsapp',
  'signal',
  'sms',
  'email',
  'outlook',
  'other',
]);

export const connectPlatformSchema = z.object({
  platform: platforms,
  label: optionalText(120),
  externalAccountId: optionalText(200),
});

export const linkPlatformSchema = z.object({
  platform: platforms,
  externalId: shortText(200),
  externalUrl: optionalText(1000),
  externalLabel: optionalText(200),
});

export const syncPlatformSchema = z.object({
  summary: shortText(500),
  detail: optionalText(8000),
  payload: z.record(z.string(), z.unknown()).optional(),
  proposeAction: z
    .object({
      kind: shortText(80),
      title: shortText(200),
      detail: optionalText(8000),
      proposedAction: z.record(z.string(), z.unknown()),
      priority: z.enum(PRIORITIES).optional(),
    })
    .optional()
    .nullable(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: optionalText(2000),
});

export const communicationStatusSchema = z.object({
  status: z.enum(['reviewed', 'filed', 'actioned', 'ignored']),
  projectId: uuid.optional().nullable(),
});

export const manualCommunicationSchema = z.object({
  projectId: uuid.optional().nullable(),
  channel: channels,
  body: shortText(16000),
  counterpartyName: optionalText(160),
  counterpartyHandle: optionalText(200),
  counterpartyKind: z
    .enum(['vendor', 'customer', 'adjuster', 'crew', 'carrier', 'supplier', 'unknown'])
    .optional(),
  direction: z.enum(['inbound', 'outbound', 'note']).optional(),
  occurredAt: isoDate.optional(),
});

export const deriveEquipmentPlanSchema = z.object({
  source: z.enum(['mitigation_estimate', 'construction_estimate', 'manual', 's500']),
  sourceRef: optionalText(200),
  approve: z.boolean().optional(),
  equipment: z
    .array(
      z.object({
        kind: shortText(60),
        quantity: z.number().positive().optional(),
        days: z.number().nonnegative().optional(),
        roomLabel: optionalText(120),
      }),
    )
    .max(200)
    .optional(),
  lineItems: z
    .array(
      z.object({
        code: optionalText(40),
        description: optionalText(400),
        quantity: z.number().positive().optional().nullable(),
        unit: optionalText(20),
        category: optionalText(80),
      }),
    )
    .max(500)
    .optional(),
  materials: z
    .array(
      z.object({
        material: optionalText(60),
        action: optionalText(40),
        quantity: z.number().positive().optional().nullable(),
        unit: optionalText(20),
      }),
    )
    .max(200)
    .optional(),
});

export const dumpsterSearchSchema = z.object({
  planItemId: uuid.optional().nullable(),
  title: optionalText(200),
  description: optionalText(4000),
  sizeHint: optionalText(80),
  postal: optionalText(20),
  address: optionalText(500),
});

export const materialReferralSchema = z.object({
  planItemId: uuid.optional().nullable(),
  vendorKey: shortText(40),
  title: shortText(200),
  query: shortText(200),
  postal: optionalText(20),
  address: optionalText(500),
});

export const selectBidSchema = z.object({
  bidId: uuid,
});

export const mentionWebhookSchema = z.object({
  orgId: uuid,
  channel: channels,
  body: shortText(16000),
  counterpartyName: optionalText(160),
  counterpartyHandle: optionalText(200),
  counterpartyKind: z
    .enum(['vendor', 'customer', 'adjuster', 'crew', 'carrier', 'supplier', 'unknown'])
    .optional(),
  threadKey: optionalText(200),
  externalMessageId: optionalText(200),
  occurredAt: isoDate.optional(),
  claimNumber: optionalText(80),
  phone: optionalText(40),
  addressHint: optionalText(200),
  projectId: uuid.optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
