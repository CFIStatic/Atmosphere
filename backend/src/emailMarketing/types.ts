/**
 * Email Marketing — shared types.
 *
 * Storm footprints, matched contacts, drafted outreach, and check-ins. Kept
 * plain so the matching / templating code stays free of Express and Supabase.
 */

export type StormSeverity = 'advisory' | 'watch' | 'warning' | 'emergency';
export type StormStatus = 'active' | 'expired' | 'cancelled';
export type OutreachStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export type MessageStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'skipped';
export type CheckinStatus = 'scheduled' | 'sent' | 'completed' | 'cancelled';
export type WeatherSource = 'nws' | 'demo' | 'manual';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface StormFootprint {
  center: LatLng;
  radiusMiles: number;
  geometry?: GeoPolygon | null;
}

export interface WeatherAlert {
  externalId: string;
  source: WeatherSource;
  name: string;
  eventType: string;
  severity: StormSeverity;
  status: StormStatus;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  center: LatLng;
  radiusMiles: number;
  geometry: GeoPolygon | null;
  areaDesc: string | null;
  onsetAt: string | null;
  endsAt: string | null;
  rawPayload?: unknown;
}

export interface MapContact {
  contactId: string;
  propertyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
  marketingOptOut: boolean;
  label: string | null;
}

export interface StormMatch {
  contactId: string;
  propertyId: string | null;
  name: string;
  email: string | null;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
  distanceMiles: number;
  marketingOptOut: boolean;
  skipReason: string | null;
}

export interface EmSettings {
  id: string;
  orgId: string;
  fromName: string;
  replyToEmail: string | null;
  companySignature: string | null;
  autoSend: boolean;
  followUpDays: number;
  includeOfferOfHelp: boolean;
}

export interface RenderedEmail {
  subject: string;
  bodyText: string;
}
