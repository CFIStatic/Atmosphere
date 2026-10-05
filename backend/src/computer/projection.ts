/**
 * What the Computer agent may know about the job: an allowlisted projection
 * of this chat's own job fields, each tagged with where it came from. Notes,
 * messages, documents, transcripts, crew, lockbox and gate codes never go to
 * the agent. Anything else it types has to come from the person's own words
 * in Chat.
 */
import type { JobFileAskContext } from '../shared/jobFileAsk.js';
import type { ApprovalField, FormFieldReading, ProjectedJobField } from './types.js';

const JOB_KEYS: Array<{ key: keyof NonNullable<JobFileAskContext['job']>; label: string }> = [
  { key: 'title', label: 'Job title' },
  { key: 'jobNumber', label: 'Job number' },
  { key: 'claimNumber', label: 'Claim number' },
  { key: 'policyNumber', label: 'Policy number' },
  { key: 'lossType', label: 'Loss type' },
  { key: 'workType', label: 'Work type' },
];

/** Brief-field labels the agent may use. Matched on the normalised label. */
const FACT_ALLOW =
  /^(insured|insured name|named insured|policyholder|policy holder|homeowner|homeowner name|owner|owner name|property owner|customer|customer name|client|client name|carrier|insurance carrier|insurance company|insurer|adjuster|adjuster name|adjuster email|adjuster phone|date of loss|loss date|deductible|homeowner phone|customer phone|insured phone|phone|homeowner email|customer email|insured email|email|year built|roof type|county|parcel|parcel number|permit number)$/;

/** Never, even when the label also matches the allowlist. */
const FACT_DENY =
  /(lock ?box|gate|alarm|door code|garage code|access code|password|passcode|\bpin\b|ssn|social security|bank|routing|account number|card|cvv|dob|date of birth|driver'?s? licen[cs]e|security question)/;

function clean(value: unknown, max = 300): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function projectJobForComputer(
  file: JobFileAskContext | null | undefined,
  address: string | null | undefined,
): ProjectedJobField[] {
  const out: ProjectedJobField[] = [];
  const job = file?.job ?? null;
  for (const { key, label } of JOB_KEYS) {
    const value = clean(job?.[key]);
    if (value) out.push({ key: `job.${String(key)}`, label, value, source: `Job: ${label}` });
  }
  const addr = clean(address);
  if (addr) out.push({ key: 'job.address', label: 'Property address', value: addr, source: 'Job: Property address' });
  const facts = file?.facts ?? {};
  for (const [rawLabel, rawValue] of Object.entries(facts)) {
    const norm = clean(rawLabel, 80).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm || FACT_DENY.test(norm) || !FACT_ALLOW.test(norm)) continue;
    const value = clean(rawValue);
    if (!value) continue;
    const label = clean(rawLabel, 80);
    if (out.some((f) => f.label.toLowerCase() === label.toLowerCase())) continue;
    out.push({ key: `fact.${slug(label)}`, label, value, source: `Job brief: ${label}` });
    if (out.length >= 30) break;
  }
  return out;
}

/** Default editor chrome — not real content for Approve provenance. */
export function isCosmeticFormField(label: string, value = ''): boolean {
  const l = String(label ?? '').toLowerCase();
  const v = String(value ?? '').toLowerCase();
  if (/\b(font|font-family|font family|font size|fontsize|typeface|text style|paragraph style|line spacing|letter spacing)\b/.test(l)) {
    return true;
  }
  if (/\b(arial|calibri|times new roman|helvetica|sans-serif|serif)\b/.test(v) && /\bfont\b/.test(l)) return true;
  if (/^\d{1,3}(\s*(pt|px))?$/.test(v.trim()) && /\b(font|size)\b/.test(l)) return true;
  return false;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Check every field the agent says it filled against what it was given. The
 * source shown on the approval card is decided here, not by the model: a
 * value that matches a job field says so, a value in the person's message
 * says "Your message", and anything else is flagged as unverified.
 */
export function verifyApprovalFields(input: {
  claimed: Array<{ label?: unknown; value?: unknown; source?: unknown }>;
  projection: ProjectedJobField[];
  instructions: string;
  onPage: FormFieldReading[];
}): ApprovalField[] {
  const out: ApprovalField[] = [];
  const said = norm(input.instructions);
  const seenValues = new Set<string>();
  for (const raw of input.claimed.slice(0, 60)) {
    const label = clean(raw.label, 120) || 'Field';
    const value = clean(raw.value, 500);
    if (!value) continue;
    if (isCosmeticFormField(label, value)) continue;
    const n = norm(value);
    seenValues.add(n);
    const match = input.projection.find((f) => norm(f.value) === n);
    if (match) {
      out.push({ label, value, source: match.source, verified: true });
    } else if (n && said.includes(n)) {
      out.push({ label, value, source: 'Your message in Chat', verified: true });
    } else {
      out.push({ label, value, source: 'Not from the job or your message (check this)', verified: false });
    }
  }
  for (const field of input.onPage) {
    const value = clean(field.value, 500);
    if (!value || field.type === 'password') continue;
    const pageLabel = clean(field.label, 120) || clean(field.name, 120) || 'Field on the page';
    if (isCosmeticFormField(pageLabel, value)) continue;
    if (seenValues.has(norm(value))) continue;
    seenValues.add(norm(value));
    out.push({
      label: pageLabel,
      value,
      source: 'Already on the page (not listed by the agent)',
      verified: false,
    });
  }
  return out;
}

/** Unverified values shown on the Approve card (cosmetic font fields already excluded). */
export function countUnverifiedApprovalFields(fields: ApprovalField[]): number {
  return fields.filter((f) => !f.verified && !isCosmeticFormField(f.label, f.value)).length;
}
