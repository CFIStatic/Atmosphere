import { titleFromSiteAddress } from '../verifier/intakePropose.js';

/**
 * Job-file identity: the name the office typed, and a copy of the file.
 *
 * Footage, parties, and holds stay on the original. A duplicate is a new
 * folder with the same site, brief, and scope so a similar job does not
 * start from a blank intake.
 */

export const JOB_FILE_TITLE_MIN = 2;
export const JOB_FILE_TITLE_MAX = 200;

export function normalizeJobFileTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length < JOB_FILE_TITLE_MIN) {
    throw new Error('Job name is too short');
  }
  return title.slice(0, JOB_FILE_TITLE_MAX);
}

/** The name the library should paint — the stored title, not a scope rewrite. */
export function displayJobFileName(
  title: string | null | undefined,
  address = '',
): string {
  const stored = (title ?? '').trim();
  if (stored) return stored.slice(0, JOB_FILE_TITLE_MAX);
  return titleFromSiteAddress(address);
}

/** Default name for a duplicated job file. */
export function suggestedDuplicateTitle(title: string): string {
  const base = title.trim() || 'Job';
  const prefix = 'Copy of ';
  if (base.toLowerCase().startsWith(prefix.toLowerCase())) {
    return base.slice(0, JOB_FILE_TITLE_MAX);
  }
  return `${prefix}${base}`.slice(0, JOB_FILE_TITLE_MAX);
}

export type CopiedScopeLine = {
  title: string;
  state: string;
  detail: string | null;
  reason: string | null;
  amount: number | null;
};

/** Decisions do not travel — a copy is a new file, not a second signature. */
export function scopeStateForDuplicate(state: string | null | undefined): string {
  if (state === 'approved') return 'included';
  if (state === 'declined') return 'excluded';
  if (state === 'excluded' || state === 'proposed' || state === 'included') return state;
  return 'included';
}

/** Latest-revision scope, without party ownership — those people are not copied. */
export function scopeLinesForDuplicate(
  items: Array<{
    title?: string | null;
    state?: string | null;
    detail?: string | null;
    reason?: string | null;
    amount?: number | string | null;
    revision?: number | null;
  }>,
  currentRevision: number | null,
): CopiedScopeLine[] {
  const latest =
    currentRevision == null
      ? items
      : items.filter((item) => (item.revision ?? currentRevision) === currentRevision);
  return latest
    .map((item) => {
      const amount = item.amount == null || item.amount === '' ? null : Number(item.amount);
      return {
        title: String(item.title ?? '').trim().slice(0, JOB_FILE_TITLE_MAX),
        state: scopeStateForDuplicate(item.state),
        detail: item.detail ?? null,
        reason: item.reason ?? null,
        amount: amount != null && Number.isFinite(amount) ? amount : null,
      };
    })
    .filter((line) => line.title.length >= JOB_FILE_TITLE_MIN);
}
