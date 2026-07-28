import { z } from 'zod';

const optionalEmail = z
  .string()
  .trim()
  .email('Enter a valid email')
  .max(254)
  .nullish()
  .or(z.literal('').transform(() => null));

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .or(z.literal('').transform(() => null));

export const settingsUpdateSchema = z.object({
  fromName: z.string().trim().min(1).max(120).optional(),
  replyToEmail: optionalEmail,
  companySignature: text(2000),
  autoSend: z.boolean().optional(),
  followUpDays: z.number().int().min(1).max(30).optional(),
  includeOfferOfHelp: z.boolean().optional(),
});

export const stormScanSchema = z.object({
  /** Force the demo feed even when NWS is configured. */
  demo: z.boolean().optional(),
  /** Optional bbox hint — currently unused by NWS (national active pull). */
  region: z.string().trim().max(80).optional(),
});

export const createOutreachSchema = z.object({
  stormId: z.string().uuid(),
  subjectTemplate: z.string().trim().min(1).max(300).optional(),
  bodyTemplate: z.string().trim().min(1).max(20_000).optional(),
});

export const messageUpdateSchema = z
  .object({
    subject: z.string().trim().min(1).max(300).optional(),
    bodyText: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((v) => v.subject !== undefined || v.bodyText !== undefined, {
    message: 'Provide a subject or body to update',
  });

export const scheduleCheckinsSchema = z.object({
  stormId: z.string().uuid(),
  outreachId: z.string().uuid().optional(),
  /** Override the org default follow-up delay. */
  followUpDays: z.number().int().min(1).max(30).optional(),
});

export const checkinUpdateSchema = z
  .object({
    status: z.enum(['scheduled', 'sent', 'completed', 'cancelled']).optional(),
    outcomeNotes: text(5000),
    subject: z.string().trim().min(1).max(300).optional(),
    bodyText: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.outcomeNotes !== undefined ||
      v.subject !== undefined ||
      v.bodyText !== undefined,
    { message: 'Nothing to update' },
  );

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().trim().max(40).optional(),
});
