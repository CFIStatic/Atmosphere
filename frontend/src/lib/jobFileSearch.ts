import {
  JOB_STATUS_LABELS,
  WORK_TYPE_LABELS,
  type JobSummary,
} from './api';

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_LONG = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Every way someone might type a filmed / scheduled / created day. */
export function dateSearchPhrases(iso: string | null | undefined): string[] {
  if (!iso) return [];
  const day = String(iso).trim().slice(0, 10);
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [String(iso).toLowerCase()];
  const [, year, month, date] = match;
  const monthIndex = Number(month) - 1;
  const short = MONTHS_SHORT[monthIndex];
  const long = MONTHS_LONG[monthIndex];
  if (!short || !long) return [day];
  return [
    day,
    `${month}/${date}/${year}`,
    `${Number(month)}/${Number(date)}/${year}`,
    `${Number(month)}/${Number(date)}`,
    `${short} ${Number(date)}`,
    `${short} ${Number(date)} ${year}`,
    `${long} ${Number(date)}`,
    `${long} ${Number(date)} ${year}`,
    year,
  ];
}

function tokenMatchesHay(hay: string, token: string): boolean {
  if (!token) return true;
  if (hay.includes(token) && token.length >= 4) return true;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay);
}

/**
 * Dashboard-style search: every whitespace-separated token must appear in
 * the job name, number, claim, last event, dates, or id.
 */
export function jobFileMatchesQuery(job: JobSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const fields = [
    job.title,
    job.jobId,
    String(job.jobNumber),
    `#${job.jobNumber}`,
    job.claimNumber,
    job.lastEvent,
    WORK_TYPE_LABELS[job.workType],
    JOB_STATUS_LABELS[job.status],
  ];
  const dates = [job.scheduledStart, job.createdAt, job.updatedAt, job.lastEventAt];
  const parts: string[] = [];
  for (const field of fields) {
    if (field == null || field === '') continue;
    parts.push(String(field));
  }
  for (const iso of dates) {
    parts.push(...dateSearchPhrases(iso));
  }
  const hay = parts.join(' ').toLowerCase();
  if (hay.includes(needle)) return true;
  return needle.split(/\s+/).every((token) => tokenMatchesHay(hay, token));
}
