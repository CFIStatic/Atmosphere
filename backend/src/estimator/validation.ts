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
    costOverrides: z.record(z.string().max(40), z.number().min(0).max(100_000)).optional(),
  })
  .optional();

export const buildEstimateSchema = z
  .object({
    jobId: z.string().trim().max(120).optional(),
    docusketch: vendorPayload.optional(),
    mica: vendorPayload.optional(),
    photos: photoManifestSchema.optional(),
    notes: z.string().max(50_000, 'Those notes are longer than 50,000 characters.').optional(),
    overrides: overridesSchema,
    settings: estimatorSettingsSchema,
  })
  .refine(
    (value) => Boolean(value.docusketch || value.mica || value.photos?.length || value.notes?.trim()),
    { message: 'Supply at least one source: a DocuSketch scan, a MICA report, photos, or field notes.' },
  );

export type BuildEstimateInput = z.infer<typeof buildEstimateSchema>;

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
    .max(50_000, 'That price list is too large to upload in one request'),
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
