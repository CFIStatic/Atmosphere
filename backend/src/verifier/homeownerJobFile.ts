/**
 * The homeowner's job-file DTO.
 *
 * A progress share is the credential — no Atmosphere account. The guest sees
 * the same facts and recordings the office keeps on the file, minus pricing
 * and contractor-to-contractor messages.
 */

export type HomeownerScopeLine = {
  id: string;
  party_id: string | null;
  state: string;
  title: string;
  detail: string | null;
  amount: null;
  reason: string | null;
  revision: number;
  decided_at: string | null;
  created_at: string;
};

export type HomeownerBrief = {
  id: string;
  revision: number;
  facts: Record<string, string>;
  note: string | null;
};

export type HomeownerJobFile = {
  brief: HomeownerBrief | null;
  scope: HomeownerScopeLine[];
};

type ScopeRow = {
  id?: unknown;
  party_id?: unknown;
  state?: unknown;
  title?: unknown;
  detail?: unknown;
  reason?: unknown;
  revision?: unknown;
  decided_at?: unknown;
  created_at?: unknown;
};

type BriefRow = {
  id?: unknown;
  revision?: unknown;
  facts?: unknown;
  note?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asFacts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) out[key] = raw;
  }
  return out;
}

export function homeownerJobFileFromRows(input: {
  brief?: BriefRow | null;
  scope?: ScopeRow[] | null;
}): HomeownerJobFile {
  const brief = input.brief;
  return {
    brief: brief
      ? {
          id: asString(brief.id) || 'brief',
          revision: typeof brief.revision === 'number' ? brief.revision : 0,
          facts: asFacts(brief.facts),
          note: asNullableString(brief.note),
        }
      : null,
    scope: (input.scope ?? []).map((row) => ({
      id: asString(row.id),
      party_id: asNullableString(row.party_id),
      state: asString(row.state) || 'included',
      title: asString(row.title),
      detail: asNullableString(row.detail),
      amount: null,
      reason: asNullableString(row.reason),
      revision: typeof row.revision === 'number' ? row.revision : 0,
      decided_at: asNullableString(row.decided_at),
      created_at: asString(row.created_at),
    })),
  };
}
