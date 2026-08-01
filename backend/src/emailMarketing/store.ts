/**
 * Email Marketing — data access against Supabase under the caller's JWT.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import type {
  EmSettings,
  MapContact,
  StormSeverity,
  StormStatus,
  WeatherAlert,
  WeatherSource,
} from './types.js';

type Db = SupabaseClient;

function contactDisplayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  const parts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  if (parts) return parts;
  if (row.company_name?.trim()) return row.company_name.trim();
  return 'Contact';
}

function camelize(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camel] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
        ? camelize(value as Record<string, any>)
        : value;
  }
  return out;
}

export { camelize };

/**
 * Build map pins from CRM properties (preferred — they have lat/lng) joined to
 * their primary contact. Properties without coordinates are counted but omitted.
 */
export async function loadMapContacts(
  supabase: Db,
  orgId: string,
): Promise<{ contacts: MapContact[]; unmappedCount: number }> {
  const { data: properties, error } = await supabase
    .from('crm_properties')
    .select(
      'id, label, city, region, latitude, longitude, primary_contact_id, is_archived, crm_contacts:primary_contact_id(id, first_name, last_name, company_name, email, phone, marketing_opt_out, is_archived)',
    )
    .eq('org_id', orgId)
    .eq('is_archived', false);

  if (error) throw new HttpError(500, error.message, 'map_contacts_failed');

  const contacts: MapContact[] = [];
  let unmappedCount = 0;

  for (const prop of properties ?? []) {
    const lat = prop.latitude != null ? Number(prop.latitude) : NaN;
    const lng = prop.longitude != null ? Number(prop.longitude) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      unmappedCount += 1;
      continue;
    }

    const rawContact = prop.crm_contacts as
      | Record<string, any>
      | Record<string, any>[]
      | null;
    const contact = Array.isArray(rawContact) ? rawContact[0] : rawContact;
    if (!contact || contact.is_archived) continue;

    contacts.push({
      contactId: contact.id,
      propertyId: prop.id,
      name: contactDisplayName(contact),
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      city: prop.city ?? null,
      region: prop.region ?? null,
      lat,
      lng,
      marketingOptOut: Boolean(contact.marketing_opt_out),
      label: prop.label ?? null,
    });
  }

  // Also plot contacts that have their own address coords? CRM contacts do not
  // currently store lat/lng — only properties do — so the property path is the
  // whole map. Contacts without a property stay off the map until geocoded.

  return { contacts, unmappedCount };
}

export async function getOrCreateSettings(
  supabase: Db,
  orgId: string,
  userId: string,
): Promise<EmSettings> {
  const { data: existing, error } = await supabase
    .from('em_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'settings_read_failed');
  if (existing) return camelize(existing) as EmSettings;

  const { data: created, error: insertErr } = await supabase
    .from('em_settings')
    .insert({
      org_id: orgId,
      created_by: userId,
      from_name: 'Atmosphere',
    })
    .select('*')
    .single();

  if (insertErr) {
    // Race: another request inserted first.
    const { data: again, error: againErr } = await supabase
      .from('em_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    if (againErr || !again) {
      throw new HttpError(500, insertErr.message, 'settings_create_failed');
    }
    return camelize(again) as EmSettings;
  }

  return camelize(created) as EmSettings;
}

export async function upsertStorms(
  supabase: Db,
  orgId: string,
  userId: string,
  alerts: WeatherAlert[],
): Promise<Array<Record<string, any>>> {
  const rows = alerts.map((alert) => ({
    org_id: orgId,
    external_id: alert.externalId,
    source: alert.source as WeatherSource,
    name: alert.name.slice(0, 200),
    event_type: alert.eventType.slice(0, 120),
    severity: alert.severity as StormSeverity,
    status: alert.status as StormStatus,
    headline: alert.headline,
    description: alert.description,
    instruction: alert.instruction,
    center_lat: alert.center.lat,
    center_lng: alert.center.lng,
    radius_miles: alert.radiusMiles,
    geometry: alert.geometry,
    area_desc: alert.areaDesc,
    onset_at: alert.onsetAt,
    ends_at: alert.endsAt,
    raw_payload: alert.rawPayload ?? null,
    created_by: userId,
  }));

  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from('em_storms')
    .upsert(rows, { onConflict: 'org_id,external_id' })
    .select('*');

  if (error) throw new HttpError(500, error.message, 'storm_upsert_failed');
  return (data ?? []).map((row) => camelize(row)!);
}

export async function recordCrmEmailActivity(
  supabase: Db,
  args: {
    orgId: string;
    userId: string;
    contactId: string;
    propertyId?: string | null;
    subject: string;
    body: string;
    occurredAt?: string;
  },
): Promise<void> {
  const { error } = await supabase.from('crm_activities').insert({
    org_id: args.orgId,
    contact_id: args.contactId,
    property_id: args.propertyId ?? null,
    kind: 'email',
    subject: args.subject.slice(0, 200),
    body: args.body,
    occurred_at: args.occurredAt ?? new Date().toISOString(),
    created_by: args.userId,
  });

  // Soft-fail: outreach already sent; timeline is best-effort enrichment.
  if (error) {
    console.warn('[email-marketing] crm activity write failed:', error.message);
  }
}

export function stormToFootprint(storm: Record<string, any>) {
  return {
    center: {
      lat: Number(storm.centerLat ?? storm.center_lat),
      lng: Number(storm.centerLng ?? storm.center_lng),
    },
    radiusMiles: Number(storm.radiusMiles ?? storm.radius_miles),
    geometry: (storm.geometry as import('./types.js').GeoPolygon | null) ?? null,
  };
}
