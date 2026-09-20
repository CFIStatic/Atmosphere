/**
 * Ask ↔ CRM — pull claim/contact/job fields for answers and cite CRM as a source.
 *
 * Atmosphere-native fields always come from crm_jobs / contacts / properties.
 * External systems (JobNimbus, AccuLynx, Salesforce, ServiceTitan) are detected
 * primarily via crm_agent_credentials (Connect CRM username/password), then
 * legacy mirror/sync/oauth tables when present. Soft-fails when nothing
 * external is connected — never throws the Ask turn.
 */

export type CrmProviderId =
  | 'atmosphere'
  | 'jobnimbus'
  | 'acculynx'
  | 'salesforce'
  | 'servicetitan'
  | 'other';

export type CrmConnectionInfo = {
  provider: CrmProviderId;
  label: string;
  connected: boolean;
  accountLabel?: string | null;
};

export type AskCrmRecord = {
  provider: CrmProviderId;
  label: string;
  jobId: string;
  title: string | null;
  claimNumber: string | null;
  policyNumber: string | null;
  status: string | null;
  jobNumber: string | number | null;
  address: string | null;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    type: string | null;
  } | null;
  external: Array<{
    provider: CrmProviderId;
    label: string;
    externalId: string | null;
    entityType?: string | null;
  }>;
  connectedProviders: CrmConnectionInfo[];
  softFail?: string | null;
};

export type AskCrmSearchHit = {
  kind: 'job' | 'contact' | 'external';
  provider: CrmProviderId;
  label: string;
  id: string;
  title: string;
  claimNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  jobId?: string | null;
};

const PROVIDER_LABELS: Record<CrmProviderId, string> = {
  atmosphere: 'Atmosphere',
  jobnimbus: 'JobNimbus',
  acculynx: 'AccuLynx',
  salesforce: 'Salesforce',
  servicetitan: 'ServiceTitan',
  other: 'CRM',
};

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeProvider(raw: unknown): CrmProviderId {
  const s = trim(raw).toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return 'other';
  if (s.includes('jobnimbus') || s === 'jn') return 'jobnimbus';
  if (s.includes('acculynx') || s === 'alx') return 'acculynx';
  if (s.includes('salesforce') || s === 'sf' || s === 'sfdc') return 'salesforce';
  if (s.includes('servicetitan') || s === 'st') return 'servicetitan';
  if (s.includes('atmosphere') || s === 'native') return 'atmosphere';
  return 'other';
}

function providerLabel(id: CrmProviderId): string {
  return PROVIDER_LABELS[id] ?? 'CRM';
}

function formatAddress(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const line1 = trim(row.address_line1 || row.line1 || row.street);
  const line2 = trim(row.address_line2 || row.line2);
  const cityLine = [
    trim(row.city),
    trim(row.region || row.state),
    trim(row.postal_code || row.postalCode || row.zip),
  ]
    .filter(Boolean)
    .join(' ');
  const parts = [line1, line2, cityLine].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function contactName(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const full = trim(row.full_name || row.name);
  if (full) return full;
  const joined = [trim(row.first_name), trim(row.last_name)].filter(Boolean).join(' ');
  return joined || null;
}

/** Best-effort: which CRMs look connected for this org. */
export async function listAskCrmConnections(
  supabase: any,
  orgId: string,
): Promise<CrmConnectionInfo[]> {
  const out: CrmConnectionInfo[] = [
    {
      provider: 'atmosphere',
      label: providerLabel('atmosphere'),
      connected: true,
      accountLabel: 'Native job file fields',
    },
  ];
  const seen = new Set<CrmProviderId>(['atmosphere']);

  const push = (provider: CrmProviderId, accountLabel?: string | null) => {
    if (provider !== 'other' && seen.has(provider)) return;
    if (provider !== 'other') seen.add(provider);
    out.push({
      provider,
      label: providerLabel(provider),
      connected: true,
      accountLabel: accountLabel ?? null,
    });
  };

  try {
    const { data, error } = await supabase
      .from('crm_agent_credentials')
      .select('system, username, status')
      .eq('org_id', orgId)
      .limit(20);
    if (!error) {
      for (const row of data ?? []) {
        push(normalizeProvider(row.system), trim(row.username) || null);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { data, error } = await supabase
      .from('crm_external_sources')
      .select('system, label, enabled')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .limit(20);
    if (!error) {
      for (const row of data ?? []) {
        push(normalizeProvider(row.system), trim(row.label) || null);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { data, error } = await supabase
      .from('crm_sync_connections')
      .select('system, account_label')
      .eq('org_id', orgId)
      .limit(20);
    if (!error) {
      for (const row of data ?? []) {
        push(normalizeProvider(row.system), trim(row.account_label) || null);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { data, error } = await supabase
      .from('crm_oauth_grants')
      .select('provider, account_label')
      .eq('org_id', orgId)
      .limit(20);
    if (!error) {
      for (const row of data ?? []) {
        push(normalizeProvider(row.provider), trim(row.account_label) || null);
      }
    }
  } catch {
    /* ignore */
  }

  return out;
}

function externalConnected(connections: CrmConnectionInfo[]): boolean {
  return connections.some((c) => c.connected && c.provider !== 'atmosphere');
}

/**
 * Load the CRM-facing record for this job (Atmosphere fields + any links).
 * Soft-fails with atmosphere-only data when no external CRM is connected.
 */
export async function getAskCrmRecord(input: {
  supabase: any;
  orgId: string;
  jobId: string;
  addressHint?: string | null;
}): Promise<AskCrmRecord> {
  const connections = await listAskCrmConnections(input.supabase, input.orgId);
  const hasExternal = externalConnected(connections);

  let job: Record<string, unknown> | null = null;
  try {
    const { data, error } = await input.supabase
      .from('crm_jobs')
      .select(
        'id, title, status, job_number, claim_number, policy_number, contact_id, property_id',
      )
      .eq('org_id', input.orgId)
      .eq('id', input.jobId)
      .maybeSingle();
    if (!error) job = (data as Record<string, unknown> | null) ?? null;
  } catch {
    job = null;
  }

  let contact: AskCrmRecord['contact'] = null;
  const contactId = trim(job?.contact_id);
  if (contactId) {
    try {
      const { data } = await input.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, full_name, email, phone, type')
        .eq('org_id', input.orgId)
        .eq('id', contactId)
        .maybeSingle();
      if (data) {
        contact = {
          name: contactName(data as Record<string, unknown>),
          email: trim((data as any).email) || null,
          phone: trim((data as any).phone) || null,
          type: trim((data as any).type) || null,
        };
      }
    } catch {
      /* ignore */
    }
  }

  let address = trim(input.addressHint) || null;
  const propertyId = trim(job?.property_id);
  if (!address && propertyId) {
    try {
      const { data } = await input.supabase
        .from('crm_properties')
        .select('address_line1, address_line2, city, region, postal_code')
        .eq('org_id', input.orgId)
        .eq('id', propertyId)
        .maybeSingle();
      address = formatAddress(data as Record<string, unknown>) || null;
    } catch {
      /* ignore */
    }
  }

  const external: AskCrmRecord['external'] = [];
  try {
    const { data, error } = await input.supabase
      .from('crm_job_links')
      .select('system, external_id')
      .eq('org_id', input.orgId)
      .eq('job_id', input.jobId)
      .limit(10);
    if (!error) {
      for (const row of data ?? []) {
        const provider = normalizeProvider(row.system);
        external.push({
          provider,
          label: providerLabel(provider),
          externalId: trim(row.external_id) || null,
        });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { data, error } = await input.supabase
      .from('crm_external_records')
      .select('external_id, entity_type, linked_id, crm_external_sources(system, label)')
      .eq('org_id', input.orgId)
      .eq('linked_id', input.jobId)
      .eq('is_current', true)
      .limit(10);
    if (!error) {
      for (const row of data ?? []) {
        const src = (row as any).crm_external_sources;
        const provider = normalizeProvider(src?.system);
        external.push({
          provider,
          label: trim(src?.label) || providerLabel(provider),
          externalId: trim(row.external_id) || null,
          entityType: trim(row.entity_type) || null,
        });
      }
    }
  } catch {
    /* ignore */
  }

  const softFail = hasExternal
    ? null
    : 'No external CRM connected (JobNimbus, AccuLynx, Salesforce, or ServiceTitan). Showing Atmosphere-native fields. Connect a CRM under Connect CRM with your username and password so an agent can pull vendor records.';

  return {
    provider: 'atmosphere',
    label: providerLabel('atmosphere'),
    jobId: input.jobId,
    title: trim(job?.title) || null,
    claimNumber: trim(job?.claim_number) || null,
    policyNumber: trim(job?.policy_number) || null,
    status: trim(job?.status) || null,
    jobNumber: (job?.job_number as string | number | null) ?? null,
    address,
    contact,
    external,
    connectedProviders: connections,
    softFail,
  };
}

/** Search Atmosphere CRM tables (and soft-note external connection state). */
export async function searchAskCrm(input: {
  supabase: any;
  orgId: string;
  query: string;
  limit?: number;
}): Promise<{
  hits: AskCrmSearchHit[];
  connectedProviders: CrmConnectionInfo[];
  softFail?: string | null;
}> {
  const q = trim(input.query);
  const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
  const connections = await listAskCrmConnections(input.supabase, input.orgId);
  const hasExternal = externalConnected(connections);
  const softFail = hasExternal
    ? null
    : 'No external CRM connected — searching Atmosphere-native jobs and contacts only. Connect JobNimbus, AccuLynx, Salesforce, or ServiceTitan under Connect CRM (username + password) for vendor search.';

  if (!q) {
    return { hits: [], connectedProviders: connections, softFail: 'Missing search query.' };
  }

  const hits: AskCrmSearchHit[] = [];
  const safe = q.replace(/[%_,]/g, ' ').slice(0, 80);

  try {
    const { data } = await input.supabase
      .from('crm_jobs')
      .select('id, title, claim_number, status, job_number')
      .eq('org_id', input.orgId)
      .or(`title.ilike.%${safe}%,claim_number.ilike.%${safe}%`)
      .limit(limit);
    for (const row of data ?? []) {
      hits.push({
        kind: 'job',
        provider: 'atmosphere',
        label: providerLabel('atmosphere'),
        id: String(row.id),
        title: trim(row.title) || `Job ${row.job_number ?? row.id}`,
        claimNumber: trim(row.claim_number) || null,
        jobId: String(row.id),
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const { data } = await input.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, full_name, email, phone, type')
      .eq('org_id', input.orgId)
      .or(
        `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`,
      )
      .limit(limit);
    for (const row of data ?? []) {
      const name = contactName(row as Record<string, unknown>) || trim(row.email) || 'Contact';
      hits.push({
        kind: 'contact',
        provider: 'atmosphere',
        label: providerLabel('atmosphere'),
        id: String(row.id),
        title: name,
        email: trim(row.email) || null,
        phone: trim(row.phone) || null,
      });
    }
  } catch {
    /* ignore */
  }

  if (hasExternal) {
    try {
      const { data } = await input.supabase
        .from('crm_external_records')
        .select('id, external_id, entity_type, payload, crm_external_sources(system, label)')
        .eq('org_id', input.orgId)
        .eq('is_current', true)
        .limit(40);
      const needle = safe.toLowerCase();
      for (const row of data ?? []) {
        const blob = JSON.stringify(row.payload ?? {}).toLowerCase();
        const extId = trim(row.external_id).toLowerCase();
        if (!blob.includes(needle) && !extId.includes(needle)) continue;
        const src = (row as any).crm_external_sources;
        const provider = normalizeProvider(src?.system);
        const title =
          trim((row.payload as any)?.name) ||
          trim((row.payload as any)?.title) ||
          trim(row.external_id) ||
          trim(row.entity_type) ||
          'CRM record';
        hits.push({
          kind: 'external',
          provider,
          label: trim(src?.label) || providerLabel(provider),
          id: String(row.id),
          title,
          claimNumber:
            trim((row.payload as any)?.claim_number) ||
            trim((row.payload as any)?.claimNumber) ||
            null,
        });
        if (hits.length >= limit * 2) break;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    hits: hits.slice(0, limit),
    connectedProviders: connections,
    softFail,
  };
}

export function summarizeAskCrmRecord(record: AskCrmRecord): string {
  const bits: string[] = [];
  if (record.title) bits.push(record.title);
  if (record.claimNumber) bits.push(`claim ${record.claimNumber}`);
  if (record.contact?.name) bits.push(`contact ${record.contact.name}`);
  if (record.address) bits.push(record.address);
  const core = bits.length ? bits.join(' · ') : 'No CRM fields on file yet';
  if (record.softFail) return `${core}. ${record.softFail}`;
  if (record.external.length) {
    const links = record.external.map((e) => e.label).join(', ');
    return `${core}. Linked from ${links}.`;
  }
  return `${core}.`;
}


/** Honest soft-fail when Ask wants to push to an external CRM without credentials. */
export function crmUpdateSoftFail(connectedProviders: CrmConnectionInfo[]): string {
  if (externalConnected(connectedProviders)) {
    return 'External CRM credentials are on file. Push/update to the vendor runs via the agent job queue (may be stubbed per CRM). Atmosphere job file fields were updated when requested.';
  }
  return 'No external CRM connected. Connect JobNimbus, AccuLynx, Salesforce, or ServiceTitan under Connect CRM with your login so an agent can update vendor records.';
}
