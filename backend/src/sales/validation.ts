import { z } from 'zod';
import { CAMPAIGN_STATUSES } from '../sales/types.js';

const availabilitySlot = z
  .string()
  .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Use HH:MM-HH:MM slots');

export const availabilitySchema = z
  .object({
    mon: z.array(availabilitySlot).max(6).optional(),
    tue: z.array(availabilitySlot).max(6).optional(),
    wed: z.array(availabilitySlot).max(6).optional(),
    thu: z.array(availabilitySlot).max(6).optional(),
    fri: z.array(availabilitySlot).max(6).optional(),
    sat: z.array(availabilitySlot).max(6).optional(),
    sun: z.array(availabilitySlot).max(6).optional(),
  })
  .default({});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  territory: z.string().trim().min(2).max(300),
  salesFocus: z.string().trim().min(2).max(500),
  valueProp: z.string().trim().max(2000).optional().nullable(),
  senderName: z.string().trim().max(120).optional().nullable(),
  senderEmail: z.string().trim().email().max(254).optional().nullable(),
  meetingDurationMin: z.number().int().min(15).max(180).optional(),
  availability: availabilitySchema.optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  territory: z.string().trim().min(2).max(300).optional(),
  salesFocus: z.string().trim().min(2).max(500).optional(),
  valueProp: z.string().trim().max(2000).optional().nullable(),
  senderName: z.string().trim().max(120).optional().nullable(),
  senderEmail: z.string().trim().email().max(254).optional().nullable(),
  meetingDurationMin: z.number().int().min(15).max(180).optional(),
  availability: availabilitySchema.optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
});

export const replySchema = z.object({
  body: z.string().trim().min(1).max(20000),
  subject: z.string().trim().max(500).optional().nullable(),
});

export const peopleSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(3, 'Enter a search — e.g. director of facilities at ABC Supply in Milwaukee')
    .max(1000),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type PeopleSearchInput = z.infer<typeof peopleSearchSchema>;
