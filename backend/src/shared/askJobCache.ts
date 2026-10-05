/**
 * Per-job Ask cache: summary + retrieval fingerprint.
 *
 * Rebuilt when videos/notes/docs/CRM change (fingerprint mismatch). Process
 * memory first; optional Supabase table ask_job_context_cache when migrated.
 */
import { createHash } from 'node:crypto';
import type { AskLookupCatalog } from './askLookup.js';
import { clipsInScope, formatAskJobContext } from './askLookup.js';
import { retrievalFingerprint, formatAskJobSummary } from './askRetrievalContext.js';

export type AskJobCacheEntry = {
  jobId: string;
  orgId: string;
  fingerprint: string;
  summaryText: string;
  rebuiltAt: string;
};

const mem = new Map<string, AskJobCacheEntry>();

export function resetAskJobCacheForTests(): void {
  mem.clear();
}

export function jobContentFingerprint(catalog: AskLookupCatalog, jobFileRecord?: string | null): string {
  const base = retrievalFingerprint(catalog);
  const crm = createHash('sha256')
    .update(
      [
        catalog.jobTitle ?? '',
        catalog.jobAddress ?? '',
        catalog.clientName ?? '',
        catalog.jobDescription ?? '',
        (catalog.history ?? []).map((h) => h.summary).join('|'),
        jobFileRecord ?? '',
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 24);
  return `${base}:${crm}`;
}

export function getAskJobCache(jobId: string | null | undefined): AskJobCacheEntry | null {
  if (!jobId) return null;
  return mem.get(jobId) ?? null;
}

export function putAskJobCache(entry: AskJobCacheEntry): void {
  mem.set(entry.jobId, entry);
}

/**
 * Return a cached summary when the fingerprint matches; otherwise rebuild.
 */
export function resolveAskJobSummary(
  catalog: AskLookupCatalog,
  jobFileRecord?: string | null,
): { summary: string; cacheHit: boolean; fingerprint: string } {
  const fingerprint = jobContentFingerprint(catalog, jobFileRecord);
  const jobId = catalog.jobId;
  if (jobId) {
    const hit = mem.get(jobId);
    if (hit && hit.fingerprint === fingerprint) {
      return { summary: hit.summaryText, cacheHit: true, fingerprint };
    }
  }
  const summary = formatAskJobSummary(catalog);
  if (jobId) {
    putAskJobCache({
      jobId,
      orgId: catalog.orgId,
      fingerprint,
      summaryText: summary,
      rebuiltAt: new Date().toISOString(),
    });
  }
  return { summary, cacheHit: false, fingerprint };
}

/** Invalidate when a proof / note / doc / CRM write happens. */
export function invalidateAskJobCache(jobId: string | null | undefined): void {
  if (!jobId) return;
  mem.delete(jobId);
}

/** Dev helper: force-fill from stuffed context size for tests. */
export function debugStuffedSize(catalog: AskLookupCatalog): number {
  return formatAskJobContext(catalog).length + clipsInScope(catalog).length;
}
