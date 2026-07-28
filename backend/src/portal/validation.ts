import { z } from 'zod';

const optionalTrimmed = (max: number) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : v === null ? null : String(v)),
    z
      .union([z.string().max(max), z.null()])
      .optional()
      .transform((s) => {
        if (s == null) return null;
        const t = s.trim();
        return t.length === 0 ? null : t;
      }),
  );

export const createShareSchema = z.object({
  label: optionalTrimmed(120),
  customerName: optionalTrimmed(160),
  customerEmail: z
    .union([z.string().email().max(320), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
  welcomeNote: optionalTrimmed(2000),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const updateVisibilitySchema = z.object({
  showSchedule: z.boolean().optional(),
  showPhaseProgress: z.boolean().optional(),
  showMilestones: z.boolean().optional(),
  showCustomerUpdates: z.boolean().optional(),
  showDryingSummary: z.boolean().optional(),
  showDocuments: z.boolean().optional(),
  showClaimBasics: z.boolean().optional(),
  showDeductible: z.boolean().optional(),
  showOfficeContact: z.boolean().optional(),
  showAdjusterContact: z.boolean().optional(),
  showFieldContact: z.boolean().optional(),
  allowChat: z.boolean().optional(),
  allowPolicyUpload: z.boolean().optional(),
  allowInsuranceQa: z.boolean().optional(),
  brandName: optionalTrimmed(160),
  logoUrl: z
    .union([
      z
        .string()
        .url()
        .max(2000)
        .refine((u) => /^https?:\/\//i.test(u), 'Logo URL must be http(s)'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
  officeName: optionalTrimmed(160),
  officePhone: optionalTrimmed(40),
  officeEmail: optionalTrimmed(320),
  fieldContactName: optionalTrimmed(160),
  fieldContactPhone: optionalTrimmed(40),
  customMessage: optionalTrimmed(2000),
});

export const guestMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  topic: z
    .enum(['general', 'schedule', 'progress', 'insurance', 'policy', 'contact'])
    .optional()
    .default('general'),
});

export const staffMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  shareId: z.string().uuid(),
});

export const policyUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(3).max(120).default('text/plain'),
  contentText: z.string().trim().min(20).max(200_000),
  byteSize: z.number().int().min(0).max(2_000_000).nullable().optional(),
});

export const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});
