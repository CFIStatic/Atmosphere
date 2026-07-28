/**
 * Shared types for the Sales Agent outbound pipeline.
 */

export const CAMPAIGN_STATUSES = [
  'draft',
  'researching',
  'crawling',
  'outreach',
  'following_up',
  'scheduling',
  'paused',
  'completed',
  'failed',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const BUSINESS_STATUSES = [
  'discovered',
  'researching',
  'crawling',
  'contacted',
  'replied',
  'meeting_booked',
  'skipped',
  'failed',
] as const;

export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const CONTACT_STATUSES = [
  'identified',
  'researched',
  'queued',
  'emailed',
  'followed_up',
  'replied',
  'meeting_booked',
  'unsubscribed',
  'bounced',
  'skipped',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface DiscoveredBusiness {
  name: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  source: 'research' | 'overpass' | 'manual' | 'crawl' | 'demo';
  sourceRef?: string | null;
  researchNotes?: string | null;
}

export interface DiscoveredContact {
  fullName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  isDecisionMaker: boolean;
  researchSummary?: string | null;
  personalizationHooks: string[];
}

export interface DraftEmail {
  subject: string;
  body: string;
}

export type ReplyIntent =
  | 'interested'
  | 'not_interested'
  | 'ask_later'
  | 'unsubscribe'
  | 'unclear';
