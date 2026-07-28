/**
 * Promote mirrored external records into the native Atmosphere CRM.
 *
 * The mirror stays verbatim. This step is separate and reversible: it reads
 * current crm_external_records, upserts crm_contacts / crm_properties /
 * crm_accounts, and stamps linked_table / linked_id on the mirror row so we
 * know which Atmosphere record a vendor id became.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PromoteStats {
  contactsUpserted: number;
  propertiesUpserted: number;
  accountsUpserted: number;
  linked: number;
  skipped: number;
  errors: string[];
}

function dig(payload: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const parts = path.split('.');
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in (cur as object)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function str(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function contactFields(payload: Record<string, unknown>) {
  const props = (payload.properties as Record<string, unknown> | undefined) ?? {};
  const merged = { ...props, ...payload };

  const firstName =
    str(dig(merged, ['firstName', 'FirstName', 'first_name', 'firstname'])) ?? null;
  const lastName =
    str(dig(merged, ['lastName', 'LastName', 'last_name', 'lastname'])) ?? null;
  const companyName =
    str(dig(merged, ['companyName', 'Company', 'company', 'Name', 'name', 'accountName'])) ??
    null;

  return {
    first_name: firstName,
    last_name: lastName,
    company_name: companyName && !firstName && !lastName ? companyName : companyName,
    email: str(dig(merged, ['email', 'Email', 'email_address']))?.toLowerCase() ?? null,
    phone: str(dig(merged, ['phone', 'Phone', 'phone_number'])) ?? null,
    mobile: str(dig(merged, ['mobile', 'MobilePhone', 'mobile_phone'])) ?? null,
    address_line1:
      str(
        dig(merged, [
          'addressLine1',
          'MailingStreet',
          'address',
          'street',
          'BillingStreet',
        ]),
      ) ?? null,
    city: str(dig(merged, ['city', 'MailingCity', 'City', 'BillingCity'])) ?? null,
    region: str(dig(merged, ['region', 'MailingState', 'state', 'BillingState'])) ?? null,
    postal_code:
      str(dig(merged, ['postalCode', 'MailingPostalCode', 'zip', 'BillingPostalCode'])) ?? null,
    country: str(dig(merged, ['country', 'MailingCountry', 'BillingCountry'])) ?? 'US',
    notes: str(dig(merged, ['notes', 'description', 'Description'])) ?? null,
  };
}

function propertyFields(payload: Record<string, unknown>) {
  const merged = { ...payload };
  return {
    label: str(dig(merged, ['label', 'name', 'Name', 'title'])) ?? null,
    address_line1:
      str(dig(merged, ['addressLine1', 'address', 'street', 'Address', 'BillingStreet'])) ??
      'Address pending',
    address_line2: str(dig(merged, ['addressLine2', 'address2'])) ?? null,
    city: str(dig(merged, ['city', 'City', 'BillingCity'])) ?? null,
    region: str(dig(merged, ['region', 'state', 'State', 'BillingState'])) ?? null,
    postal_code: str(dig(merged, ['postalCode', 'zip', 'BillingPostalCode'])) ?? null,
    country: str(dig(merged, ['country', 'Country', 'BillingCountry'])) ?? 'US',
    latitude: num(dig(merged, ['latitude', 'lat', 'Latitude'])),
    longitude: num(dig(merged, ['longitude', 'lng', 'lon', 'Longitude'])),
    contactExternalId: str(
      dig(merged, ['contactExternalId', 'contact_id', 'ContactId', 'primaryContactId']),
    ),
  };
}

function accountFields(payload: Record<string, unknown>) {
  return {
    name: str(dig(payload, ['name', 'Name', 'company', 'Company'])) ?? 'Account',
    phone: str(dig(payload, ['phone', 'Phone'])) ?? null,
    email: str(dig(payload, ['email', 'Email'])) ?? null,
    website: str(dig(payload, ['website', 'Website'])) ?? null,
    address_line1: str(dig(payload, ['addressLine1', 'BillingStreet', 'address'])) ?? null,
    city: str(dig(payload, ['city', 'BillingCity'])) ?? null,
    region: str(dig(payload, ['region', 'BillingState', 'state'])) ?? null,
    postal_code: str(dig(payload, ['postalCode', 'BillingPostalCode', 'zip'])) ?? null,
    country: str(dig(payload, ['country', 'BillingCountry'])) ?? 'US',
  };
}

async function linkMirror(
  admin: SupabaseClient,
  recordId: string,
  table: string,
  id: string,
): Promise<void> {
  await admin
    .from('crm_external_records')
    .update({ linked_table: table, linked_id: id })
    .eq('id', recordId);
}

/**
 * Promote current mirrored records for one source into native CRM tables.
 *
 * Uses the service-role client because linking updates mirror rows and the
 * promote is an org-wide server operation (same trust model as sync).
 */
export async function promoteSourceToCrm(params: {
  admin: SupabaseClient;
  orgId: string;
  sourceId: string;
  userId: string;
  limit?: number;
}): Promise<PromoteStats> {
  const stats: PromoteStats = {
    contactsUpserted: 0,
    propertiesUpserted: 0,
    accountsUpserted: 0,
    linked: 0,
    skipped: 0,
    errors: [],
  };

  const limit = params.limit ?? 5000;

  const { data: records, error } = await params.admin
    .from('crm_external_records')
    .select('id, entity_type, external_id, payload, linked_table, linked_id')
    .eq('org_id', params.orgId)
    .eq('source_id', params.sourceId)
    .eq('is_current', true)
    .limit(limit);

  if (error) throw new Error(`Promote read failed: ${error.message}`);

  // Map external contact ids → crm contact ids as we create them, so properties
  // can attach to the right primary contact in the same pass.
  const contactByExternal = new Map<string, string>();

  const sorted = [...(records ?? [])].sort((a, b) => {
    const rank = (t: string) =>
      t === 'contact' || t === 'customer' || t === 'account' || t === 'company' ? 0 : 1;
    return rank(a.entity_type) - rank(b.entity_type);
  });

  for (const row of sorted) {
    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const entity = String(row.entity_type).toLowerCase();

      if (entity === 'contact' || entity === 'customer') {
        const fields = contactFields(payload);
        if (!fields.first_name && !fields.last_name && !fields.company_name) {
          stats.skipped += 1;
          continue;
        }

        let contactId = row.linked_id as string | null;
        if (row.linked_table === 'crm_contacts' && contactId) {
          const { error: updErr } = await params.admin
            .from('crm_contacts')
            .update(fields)
            .eq('org_id', params.orgId)
            .eq('id', contactId);
          if (updErr) throw new Error(updErr.message);
        } else {
          const { data: created, error: insErr } = await params.admin
            .from('crm_contacts')
            .insert({
              ...fields,
              org_id: params.orgId,
              type: 'homeowner',
              created_by: params.userId,
            })
            .select('id')
            .single();
          if (insErr) throw new Error(insErr.message);
          contactId = created.id as string;
          await linkMirror(params.admin, row.id, 'crm_contacts', contactId);
          stats.linked += 1;
        }

        if (!contactId) throw new Error('Contact id missing after upsert');
        contactByExternal.set(String(row.external_id), contactId);
        stats.contactsUpserted += 1;
        continue;
      }

      if (entity === 'account' || entity === 'company') {
        const fields = accountFields(payload);
        let accountId = row.linked_id as string | null;
        if (row.linked_table === 'crm_accounts' && accountId) {
          await params.admin
            .from('crm_accounts')
            .update(fields)
            .eq('org_id', params.orgId)
            .eq('id', accountId);
        } else {
          const { data: created, error: insErr } = await params.admin
            .from('crm_accounts')
            .insert({
              ...fields,
              org_id: params.orgId,
              type: 'other',
              created_by: params.userId,
            })
            .select('id')
            .single();
          if (insErr) throw new Error(insErr.message);
          accountId = created.id as string;
          await linkMirror(params.admin, row.id, 'crm_accounts', accountId);
          stats.linked += 1;
        }
        stats.accountsUpserted += 1;
        continue;
      }

      if (entity === 'property' || entity === 'location') {
        const fields = propertyFields(payload);
        const { contactExternalId, ...propertyRow } = fields;
        const primaryContactId = contactExternalId
          ? contactByExternal.get(contactExternalId) ?? null
          : null;

        let propertyId = row.linked_id as string | null;
        if (row.linked_table === 'crm_properties' && propertyId) {
          await params.admin
            .from('crm_properties')
            .update({
              ...propertyRow,
              primary_contact_id: primaryContactId,
            })
            .eq('org_id', params.orgId)
            .eq('id', propertyId);
        } else {
          const { data: created, error: insErr } = await params.admin
            .from('crm_properties')
            .insert({
              ...propertyRow,
              org_id: params.orgId,
              primary_contact_id: primaryContactId,
              created_by: params.userId,
            })
            .select('id')
            .single();
          if (insErr) throw new Error(insErr.message);
          propertyId = created.id as string;
          await linkMirror(params.admin, row.id, 'crm_properties', propertyId);
          stats.linked += 1;
        }
        stats.propertiesUpserted += 1;
        continue;
      }

      stats.skipped += 1;
    } catch (err) {
      stats.errors.push(
        `${row.entity_type}/${row.external_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // For contacts that carry their own address + coordinates but no separate
  // property entity, synthesise a property so Email Marketing can map them.
  for (const row of sorted) {
    const entity = String(row.entity_type).toLowerCase();
    if (entity !== 'contact' && entity !== 'customer') continue;
    if (row.linked_table !== 'crm_contacts' || !row.linked_id) continue;

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const fields = contactFields(payload);
    const lat = num(dig(payload, ['latitude', 'lat', 'Latitude']));
    const lng = num(dig(payload, ['longitude', 'lng', 'lon', 'Longitude']));
    if (!fields.address_line1 || lat == null || lng == null) continue;

    // Skip if a property already points at this contact.
    const { count } = await params.admin
      .from('crm_properties')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', params.orgId)
      .eq('primary_contact_id', row.linked_id);

    if ((count ?? 0) > 0) continue;

    const { error: propErr } = await params.admin.from('crm_properties').insert({
      org_id: params.orgId,
      primary_contact_id: row.linked_id,
      label: [fields.first_name, fields.last_name].filter(Boolean).join(' ') || 'Property',
      address_line1: fields.address_line1,
      city: fields.city,
      region: fields.region,
      postal_code: fields.postal_code,
      country: fields.country ?? 'US',
      latitude: lat,
      longitude: lng,
      created_by: params.userId,
    });

    if (!propErr) stats.propertiesUpserted += 1;
  }

  await params.admin
    .from('crm_external_sources')
    .update({ last_promote_at: new Date().toISOString() })
    .eq('id', params.sourceId);

  return stats;
}
