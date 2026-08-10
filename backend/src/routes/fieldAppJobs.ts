/**
 * Shared helpers for Field Capture org job lists (today + search).
 */

export type FieldJobRow = {
  id: string;
  job_number: number | null;
  title: string | null;
  status: string | null;
  scheduled_start: string | null;
  property_id: string | null;
};

export type FieldJobOut = {
  id: string;
  number: string;
  name: string;
  address: string;
  at: string;
  status: string | null;
  placed: boolean;
};

/** Terminal statuses — same set as /today. */
export const FIELD_JOB_EXCLUDED_STATUSES = '("completed","cancelled","lost","archived")';

export function sanitizeFieldSearchQuery(raw: string): string {
  return raw.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function mapFieldJobRow(
  j: FieldJobRow,
  addressById: Map<string, string>,
): FieldJobOut {
  return {
    id: j.id,
    number: j.job_number != null ? `#${j.job_number}` : '',
    name: j.title || 'Job',
    address: (j.property_id && addressById.get(j.property_id)) || 'Address on file',
    at: j.scheduled_start
      ? new Date(j.scheduled_start).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'Today',
    status: j.status ?? null,
    placed: Boolean(j.scheduled_start),
  };
}

/**
 * Build a PostgREST `.or(...)` filter for field job search.
 * Returns null when the query is empty after sanitize.
 */
export function buildFieldJobSearchOr(
  q: string,
  propertyIds: string[] = [],
): string | null {
  const safe = sanitizeFieldSearchQuery(q);
  if (!safe) return null;

  const parts: string[] = [
    `title.ilike.%${safe}%`,
    `claim_number.ilike.%${safe}%`,
    `description.ilike.%${safe}%`,
  ];

  const digits = safe.replace(/^#/, '').trim();
  if (/^\d+$/.test(digits)) {
    parts.push(`job_number.eq.${digits}`);
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safe)) {
    parts.push(`id.eq.${safe}`);
  }

  if (propertyIds.length) {
    parts.push(`property_id.in.(${propertyIds.join(',')})`);
  }

  return parts.join(',');
}
