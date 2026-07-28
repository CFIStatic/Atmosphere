import { z } from 'zod';
import { ALL_SCOPES } from './xactimate/consent.js';

/**
 * Input validation for the estimator and Xactimate routes.
 *
 * Two shapes need different treatment. Vendor exports (DocuSketch, MICA) are
 * validated only as "some JSON value" — their schemas are not ours to pin down,
 * they change between versions, and the ingestion adapters are already written
 * to tolerate anything. Rejecting a scan here for a key we did not expect would
 * mean a technician re-scanning a house.
 *
 * Everything the *user* types is validated strictly, because those are the
 * values that end up in a login form or a stored record.
 */

/** A vendor payload of unknown shape, capped so one upload cannot exhaust memory. */
const vendorPayload = z.unknown().refine(
  (value) => {
    if (value === undefined || value === null) return true;
    try {
      return JSON.stringify(value).length <= 4_000_000; // ~4 MB
    } catch {
      return false;
    }
  },
  { message: 'That export is too large or could not be read. Export it again, or split it by level.' },
);

export const photoManifestSchema = z.array(
  z.object({
    id: z.string().trim().max(200).optional(),
    filename: z.string().trim().max(300).optional(),
    capturedAt: z.string().trim().max(60).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    caption: z.string().trim().max(2000).optional(),
    roomId: z.string().trim().max(200).optional(),
    roomName: z.string().trim().max(200).optional(),
    uri: z.string().trim().max(2000).optional(),
  }),
).max(2000, 'That is more than 2,000 photos — split the job by level.');

const waterCategory = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const waterClass = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const overridesSchema = z
  .object({
    propertyAddress: z.string().trim().max(300).optional(),
    claimNumber: z.string().trim().max(100).optional(),
    carrier: z.string().trim().max(150).optional(),
    insuredName: z.string().trim().max(150).optional(),
    dateOfLoss: z.string().trim().max(60).optional(),
    dateOfArrival: z.string().trim().max(60).optional(),
    category: waterCategory.optional(),
    class: waterClass.optional(),
    dryingDays: z.number().int().min(0).max(120).optional(),
    monitoringVisits: z.number().int().min(0).max(120).optional(),
  })
  .optional();

/** Org-level knobs. Bounded so a typo cannot produce a nonsense estimate. */
export const estimatorSettingsSchema = z
  .object({
    targetMargin: z.number().min(0).max(0.9).optional(),
    overheadAndProfitRate: z.number().min(0).max(0.5).optional(),
    oAndPEligible: z.boolean().optional(),
    taxRate: z.number().min(0).max(0.25).optional(),
    costMultiplier: z.number().min(0.25).max(4).optional(),
    lineMarginFloor: z.number().min(0).max(0.9).optional(),
    hoursPerMonitoringVisit: z.number().min(0).max(12).optional(),
    techniciansOnSite: z.number().int().min(1).max(20).optional(),
    category3CutHeightIn: z.number().min(12).max(96).optional(),
    planCutHeightIn: z.number().min(12).max(96).optional(),
    equipmentBillingMode: z.enum(['as_logged', 'recommended', 'max']).optional(),
    costOverrides: z.record(z.string().max(40), z.number().min(0).max(100_000)).optional(),
    catalogRemaps: z.record(z.string().max(40), z.string().trim().min(1).max(40)).optional(),
    codeOverrides: z.record(z.string().max(80), z.string().trim().min(1).max(40)).optional(),
  })
  .optional();

const equipmentKindSchema = z.enum([
  'air_mover',
  'axial_air_mover',
  'dehumidifier_lgr',
  'dehumidifier_conventional',
  'dehumidifier_desiccant',
  'air_scrubber',
  'heater',
  'injectidry',
]);

const moistureReadingSchema = z.object({
  roomId: z.string().trim().max(200),
  material: z.string().trim().max(60),
  value: z.number().min(0).max(1000),
  dryStandard: z.number().min(0).max(1000),
  takenAt: z.string().trim().max(60),
  location: z.string().trim().max(300).optional(),
});

const psychrometricSchema = z.object({
  takenAt: z.string().trim().max(60),
  zone: z.enum(['affected', 'unaffected', 'outside', 'dehu_outlet']),
  temperatureF: z.number().min(-40).max(150),
  relativeHumidity: z.number().min(0).max(100),
  gpp: z.number().min(0).max(1000).optional(),
});

const equipmentPlacementSchema = z.object({
  kind: equipmentKindSchema,
  quantity: z.number().int().min(0).max(500),
  roomId: z.string().trim().max(200).optional(),
  placedAt: z.string().trim().max(60),
  removedAt: z.string().trim().max(60).optional(),
  days: z.number().min(0).max(120).optional(),
});

/**
 * One drying visit / export. Used on build (inline array) and on the append
 * endpoint (single report). Id is optional on append — the route will mint one.
 */
export const dryingReportSchema = z.object({
  id: z.string().trim().max(120).optional(),
  takenAt: z.string().trim().min(1).max(60),
  source: z.enum(['mica', 'manual', 'notes', 'photos']),
  notes: z.string().trim().max(10_000).optional(),
  moistureReadings: z.array(moistureReadingSchema).max(500).optional(),
  psychrometrics: z.array(psychrometricSchema).max(200).optional(),
  equipment: z.array(equipmentPlacementSchema).max(200).optional(),
  roomsAtDryStandard: z.array(z.string().trim().max(200)).max(100).optional(),
  roomsStillWet: z.array(z.string().trim().max(200)).max(100).optional(),
  evidence: z
    .array(
      z.object({
        id: z.string().trim().max(200),
        kind: z.enum(['photo', 'moisture_reading', 'psychrometric', 'note', 'sketch']),
        roomId: z.string().trim().max(200).optional(),
        capturedAt: z.string().trim().max(60).optional(),
        description: z.string().trim().max(4000),
        uri: z.string().trim().max(2000).optional(),
        tags: z.array(z.string().trim().max(80)).max(50).default([]),
      }),
    )
    .max(500)
    .optional(),
});

export const dryingReportsSchema = z.array(dryingReportSchema).max(200).optional();

/** A human's answer about who the estimate is for. Always beats inference. */
export const carrierOverrideSchema = z
  .object({
    carrierId: z.string().trim().max(60).regex(/^[a-z0-9_]+$/, 'Use the carrier id, not its display name').optional(),
    programId: z.string().trim().max(60).regex(/^[a-z0-9_]+$/, 'Use the program id').optional(),
  })
  .optional();

export const buildEstimateSchema = z
  .object({
    jobId: z.string().trim().max(120).optional(),
    docusketch: vendorPayload.optional(),
    mica: vendorPayload.optional(),
    photos: photoManifestSchema.optional(),
    notes: z.string().max(50_000, 'Those notes are longer than 50,000 characters.').optional(),
    dryingReports: dryingReportsSchema,
    overrides: overridesSchema,
    settings: estimatorSettingsSchema,
    carrier: carrierOverrideSchema,
    /**
     * Per-build code picks: knowledge key or scope item id → account Xactimate code.
     * Merged on top of any org-level codeOverrides in settings.
     */
    codeOverrides: z.record(z.string().max(80), z.string().trim().min(1).max(40)).optional(),
  })
  .refine(
    (value) => Boolean(value.docusketch || value.mica || value.photos?.length || value.notes?.trim()),
    { message: 'Supply at least one source: a DocuSketch scan, a MICA report, photos, or field notes.' },
  );

export type BuildEstimateInput = z.infer<typeof buildEstimateSchema>;

/** Rebuild may omit sources when the caller only wants stored reports reapplied. */
export const rebuildEstimateSchema = z.object({
  jobId: z.string().trim().max(120).optional(),
  docusketch: vendorPayload.optional(),
  mica: vendorPayload.optional(),
  photos: photoManifestSchema.optional(),
  notes: z.string().max(50_000).optional(),
  dryingReports: dryingReportsSchema,
  overrides: overridesSchema,
  settings: estimatorSettingsSchema,
  carrier: carrierOverrideSchema,
  codeOverrides: z.record(z.string().max(80), z.string().trim().min(1).max(40)).optional(),
  /** Persist the rebuilt estimate when true. */
  save: z.boolean().optional(),
});

/* ------------------------------------------------------------------ *
 * Xactimate
 * ------------------------------------------------------------------ */

const scopeSchema = z.enum(ALL_SCOPES as unknown as [string, ...string[]]);

/**
 * The connect request.
 *
 * `acknowledgedTerms` is required and must be `true`. It is not a dark pattern
 * in reverse — the connect screen states plainly that the server will sign in as
 * the user, what it will do once in, and that whether automated access is
 * permitted depends on their agreement with Verisk. Recording that they read it
 * is the point.
 */
export const xactimateConnectSchema = z.object({
  username: z
    .string({ required_error: 'Your Xactimate username is required' })
    .trim()
    .min(3, 'Enter your Xactimate username')
    .max(200),
  password: z
    .string({ required_error: 'Your Xactimate password is required' })
    .min(1, 'Enter your Xactimate password')
    .max(500),
  mfaCode: z.string().trim().regex(/^\d{4,8}$/, 'Enter the numeric code').optional(),
  scopes: z.array(scopeSchema).min(1, 'Grant at least one permission').max(10),
  storageMode: z.enum(['session', 'stored']).default('session'),
  consentDays: z.number().int().min(1).max(90).default(30),
  acknowledgedTerms: z.literal(true, {
    errorMap: () => ({
      message: 'Please confirm you have read what Atmosphere will do with your Xactimate account.',
    }),
  }),
});

export const priceListSyncSchema = z.object({
  priceListId: z.string().trim().min(1, 'Choose a price list').max(120),
});

/** Uploading an exported price list — the route that needs no login at all. */
export const priceListUploadSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  effectiveDate: z.string().trim().max(60).optional(),
  entries: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        description: z.string().trim().max(400).default(''),
        unit: z.string().trim().max(10).default('EA'),
        unitPrice: z.number().min(0).max(1_000_000),
      }),
    )
    .min(1, 'That price list has no rows')
    .max(50_000, 'That price list is too large to upload in one request')
    .optional(),
  /** Raw CSV / TSV / JSON export from Xactimate Online — alternative to `entries`. */
  content: z.string().min(1).max(20_000_000).optional(),
  format: z.enum(['csv', 'tsv', 'json', 'auto']).optional(),
}).refine((value) => Boolean(value.entries?.length || value.content?.trim()), {
  message: 'Provide either structured entries or a raw export file body (content).',
});

export const codeSearchSchema = z.object({
  q: z.string().trim().min(1, 'Enter a code or description').max(200),
  limit: z.number().int().min(1).max(100).optional(),
  preferUnit: z.enum(['SF', 'LF', 'SY', 'CF', 'EA', 'DA', 'HR', 'WK', 'CY']).optional(),
  preferCategory: z.string().trim().max(10).optional(),
});

export const catalogRemapSchema = z.object({
  remaps: z
    .record(z.string().max(40), z.string().trim().min(1).max(40))
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one remap'),
});

export const applyCodeOverrideSchema = z.object({
  /** Knowledge key or scope item id. */
  key: z.string().trim().min(1).max(80),
  /** Live account Xactimate selector. */
  code: z.string().trim().min(1).max(40),
  /** Persist on the org so later builds reuse it. */
  persist: z.boolean().default(true),
});

export const pushEstimateSchema = z.object({
  /** The estimate to push, as returned by POST /api/estimator/build. */
  estimate: z.unknown().refine((value) => Boolean(value && typeof value === 'object'), {
    message: 'Build an estimate first.',
  }),
  /** Guard against pushing a scope the user has not looked at. */
  confirmedFindings: z.boolean().default(false),
});

export const exportFormatSchema = z.object({
  format: z.enum(['csv', 'xml', 'scope']).default('csv'),
});

/* ------------------------------------------------------------------ *
 * Carrier program agreements
 * ------------------------------------------------------------------ */

/**
 * One machine-checkable term.
 *
 * A discriminated union rather than a loose object: a term whose shape does not
 * validate is a term that would be silently skipped at check time, and an
 * estimate believed to have been checked against terms it never was is worse
 * than one checked against nothing.
 */
const slaConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('price_list'), priceListId: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal('overhead_and_profit'), allowed: z.boolean(), maxRate: z.number().min(0).max(0.5).optional() }),
  z.object({
    kind: z.literal('rate_concession'),
    discountPct: z.number().min(0).max(0.5),
    categories: z.array(z.string().trim().max(10)).max(20).optional(),
  }),
  z.object({
    kind: z.literal('max_quantity'),
    catalogKey: z.string().trim().min(1).max(40),
    max: z.number().min(0).max(100_000),
    unit: z.enum(['SF', 'LF', 'SY', 'CF', 'EA', 'DA', 'HR', 'WK', 'CY']),
    per: z.enum(['job', 'room', 'day']),
  }),
  z.object({ kind: z.literal('max_equipment_days'), maxDays: z.number().int().min(0).max(120) }),
  z.object({ kind: z.literal('approval_threshold'), amount: z.number().min(0).max(10_000_000) }),
  z.object({ kind: z.literal('line_item_prohibited'), catalogKeys: z.array(z.string().trim().max(40)).min(1).max(200) }),
  z.object({ kind: z.literal('required_documentation'), items: z.array(z.string().trim().min(1).max(120)).min(1).max(50) }),
  z.object({
    kind: z.literal('timeline'),
    milestone: z.enum(['contact', 'on_site', 'inspection', 'estimate_submitted', 'work_complete']),
    withinHours: z.number().min(0).max(2000),
  }),
  z.object({ kind: z.literal('invoice_window'), withinDays: z.number().int().min(0).max(365) }),
]);

export const agreementSchema = z.object({
  carrier: z.object({
    id: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Carrier id must be lowercase snake case'),
    name: z.string().trim().min(1).max(120),
  }),
  program: z.object({
    id: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Program id must be lowercase snake case'),
    name: z.string().trim().min(1).max(120),
  }),
  version: z.string().trim().min(1).max(60),
  effectiveFrom: z.string().trim().max(40).optional(),
  effectiveTo: z.string().trim().max(40).optional(),
  rules: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(60),
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().max(2000).default(''),
        // Terms default to binding. If whoever entered it did not say how
        // binding it is, treating it as advisory is the expensive way to be
        // wrong.
        severity: z.enum(['hard', 'soft']).default('hard'),
        sourceRef: z.string().trim().max(120).optional(),
        constraint: slaConstraintSchema,
      }),
    )
    .min(1, 'An agreement with no terms is not an agreement')
    .max(200),
});

export const agreementFetchSchema = z.object({
  carrierId: z.string().trim().min(1).max(60),
  programId: z.string().trim().max(60).optional(),
});

/**
 * Accepting a deviation.
 *
 * `reason` and `evidenceIds` are both required and neither may be empty. That is
 * the whole mechanism: the difference between a documented deviation and simply
 * ignoring the agreement is that a reviewer can open the evidence and see the
 * reason for themselves.
 */
export const deviationSchema = z.object({
  ruleId: z.string().trim().min(1).max(60),
  reason: z
    .string({ required_error: 'A written reason is required' })
    .trim()
    .min(20, 'Say why in enough detail that a reviewer who was not there understands it')
    .max(4000),
  evidenceIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1, 'Cite at least one piece of evidence from this job. A reason with nothing behind it is an assertion, not documentation.')
    .max(50),
  authorizedBy: z.string().trim().max(120).optional(),
});
