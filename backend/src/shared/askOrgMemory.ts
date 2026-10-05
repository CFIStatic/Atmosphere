/**
 * Company-wide Ask memory: org-scoped facts learned across past jobs
 * (adjusters, carriers, pricing habits, preferences). Restricted facts
 * that cite source jobs are never returned for a user who cannot access
 * every source job.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type OrgMemoryKind =
  | 'adjuster'
  | 'carrier'
  | 'pricing'
  | 'preference'
  | 'contact'
  | 'other';

export type OrgMemoryFact = {
  id?: string;
  orgId: string;
  kind: OrgMemoryKind;
  label: string;
  detail: string;
  restricted: boolean;
  sourceJobIds: string[];
  confidence: number;
  updatedAt?: string | null;
};

const KIND_ALIASES: Array<{ kind: OrgMemoryKind; re: RegExp }> = [
  { kind: 'adjuster', re: /\badjusters?\b/i },
  { kind: 'carrier', re: /\b(carriers?|insurers?|insurance\s+compan(?:y|ies)|state\s*farm|allstate|farmers|nationwide|usaa|liberty\s*mutual)\b/i },
  { kind: 'pricing', re: /\b(pric(?:e|ing)|rate\s*card|margin|markup|discount|how\s+we\s+charge|unit\s+cost)\b/i },
  { kind: 'preference', re: /\b(prefer|preference|usually|always|never|habit|we\s+(?:use|send|write|call))\b/i },
  { kind: 'contact', re: /\b(email|phone|call|contact)\b/i },
];

const LABEL_MAX = 200;
const DETAIL_MAX = 2000;
const PROMPT_FACT_LIMIT = 12;

function trim(s: string, max: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Heuristic extractors from an Ask turn / job note — no model call. */
export function extractOrgMemoryCandidates(input: {
  orgId: string;
  jobId?: string | null;
  question: string;
  answer?: string | null;
  restrictedJob?: boolean;
}): OrgMemoryFact[] {
  const orgId = String(input.orgId ?? '').trim();
  if (!orgId) return [];
  const q = String(input.question ?? '');
  const a = String(input.answer ?? '');
  const blob = `${q}\n${a}`.trim();
  if (blob.length < 12) return [];
  const restricted = Boolean(input.restrictedJob);
  const sourceJobIds = input.jobId ? [String(input.jobId)] : [];
  const out: OrgMemoryFact[] = [];

  const preferMatch = blob.match(
    /\bwe\s+(?:usually|always|prefer to|like to)\s+([^.!?\n]{8,160})/i,
  );
  if (preferMatch) {
    out.push({
      orgId,
      kind: 'preference',
      label: trim(preferMatch[1]!, 80),
      detail: trim(preferMatch[0]!, DETAIL_MAX),
      restricted,
      sourceJobIds,
      confidence: 0.55,
    });
  }

  const adjusterMatch = blob.match(
    /\b(?:adjuster|desk\s+adjuster)\s+(?:is\s+|named\s+|:\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  if (adjusterMatch) {
    out.push({
      orgId,
      kind: 'adjuster',
      label: trim(adjusterMatch[1]!, LABEL_MAX),
      detail: trim(`Adjuster mentioned: ${adjusterMatch[1]}`, DETAIL_MAX),
      restricted: true, // person tied to a job file — never org-broadcast without access
      sourceJobIds,
      confidence: 0.65,
    });
  }

  const carrierMatch = blob.match(
    /\b(?:carrier|insurer|insurance)\s+(?:is\s+|:\s*)?([A-Z][A-Za-z0-9&.\- ]{2,40})/,
  );
  if (carrierMatch) {
    out.push({
      orgId,
      kind: 'carrier',
      label: trim(carrierMatch[1]!, LABEL_MAX),
      detail: trim(`Carrier: ${carrierMatch[1]}`, DETAIL_MAX),
      restricted: true,
      sourceJobIds,
      confidence: 0.6,
    });
  }

  // Explicit "remember for the company" / "we always"
  if (/\b(remember\s+(?:this\s+)?(?:for\s+)?(?:the\s+)?(?:company|office|org)|company[- ]wide)\b/i.test(blob)) {
    const kind =
      KIND_ALIASES.find((row) => row.re.test(blob))?.kind ?? 'preference';
    out.push({
      orgId,
      kind,
      label: trim(q.slice(0, 80) || 'Company note', LABEL_MAX),
      detail: trim(a || q, DETAIL_MAX),
      restricted: false,
      sourceJobIds,
      confidence: 0.7,
    });
  }

  return out.filter((f) => f.label && f.detail);
}

/** Drop restricted facts whose source jobs the caller cannot access. */
export function filterOrgMemoryForAccess(
  facts: OrgMemoryFact[],
  accessibleJobIds: ReadonlySet<string> | null,
): OrgMemoryFact[] {
  if (!facts.length) return [];
  return facts.filter((fact) => {
    if (!fact.restricted) return true;
    if (!fact.sourceJobIds.length) return true;
    // Null set = unknown access map → fail closed for restricted rows.
    if (!accessibleJobIds) return false;
    return fact.sourceJobIds.every((id) => accessibleJobIds.has(id));
  });
}

export function formatOrgMemoryForPrompt(facts: OrgMemoryFact[]): string {
  const rows = facts.slice(0, PROMPT_FACT_LIMIT);
  if (!rows.length) return '';
  const lines = rows.map((f) => `- [${f.kind}] ${f.label}: ${f.detail}`);
  return [
    'Company memory (org-wide habits and facts you may use on this job; never invent beyond this list):',
    ...lines,
  ].join('\n');
}

/**
 * Load org memory for an Ask turn. Service-role reads must pass accessibleJobIds
 * for the signed-in user (or empty set) so restricted rows cannot leak.
 */
export async function loadOrgMemoryFacts(
  admin: { from: (t: string) => any } | null | undefined,
  input: {
    orgId: string;
    accessibleJobIds: ReadonlySet<string> | null;
    limit?: number;
  },
): Promise<OrgMemoryFact[]> {
  if (!admin?.from || !input.orgId) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 40, 80));
  try {
    const { data, error } = await admin
      .from('ask_org_memory_facts')
      .select('id, org_id, kind, label, detail, restricted, source_job_ids, confidence, updated_at')
      .eq('org_id', input.orgId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    const mapped: OrgMemoryFact[] = data.map((row: any) => ({
      id: String(row.id),
      orgId: String(row.org_id),
      kind: row.kind as OrgMemoryKind,
      label: String(row.label ?? ''),
      detail: String(row.detail ?? ''),
      restricted: Boolean(row.restricted),
      sourceJobIds: Array.isArray(row.source_job_ids)
        ? row.source_job_ids.map((x: unknown) => String(x))
        : [],
      confidence: Number(row.confidence ?? 0.6),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    }));
    return filterOrgMemoryForAccess(mapped, input.accessibleJobIds);
  } catch {
    return [];
  }
}

/** Upsert extracted facts (service role). Failures never break Ask. */
export async function rememberOrgMemoryFacts(
  admin: { from: (t: string) => any } | null | undefined,
  facts: OrgMemoryFact[],
  createdBy?: string | null,
): Promise<number> {
  if (!admin?.from || !facts.length) return 0;
  let written = 0;
  for (const fact of facts) {
    try {
      const payload = {
        org_id: fact.orgId,
        kind: fact.kind,
        label: trim(fact.label, LABEL_MAX),
        detail: trim(fact.detail, DETAIL_MAX),
        restricted: Boolean(fact.restricted),
        source_job_ids: fact.sourceJobIds,
        confidence: fact.confidence,
        created_by: createdBy ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from('ask_org_memory_facts').upsert(payload, {
        onConflict: 'org_id,kind,label',
      });
      if (!error) written += 1;
    } catch {
      // ignore
    }
  }
  return written;
}
