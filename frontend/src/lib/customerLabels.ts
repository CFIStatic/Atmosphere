/**
 * Customer-facing words for internal enum values.
 *
 * The database speaks in slugs — `field_capture`, `other`, `analysed` — and
 * those leak straight into the Evidence report and the timeline when a
 * component prints the raw column. Every customer surface goes through here
 * instead, so a clip reads "Field capture · After · Analyzed", never
 * "field_capture · other · analysed".
 */
import { SERVICE_TRADE_OPTIONS } from '../components/setup/verifierSetupOptions';

const TRADE_WORDS: Record<string, string> = {
  field_capture: 'Field capture',
  subcontractor: 'Subcontractor',
  homeowner: 'Homeowner',
  general_contractor: 'General contractor',
  other: 'Other trade',
};

/** Sentence-case a slug we have no curated word for: `windows_doors` → "Windows doors". */
function humanizeSlug(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/** A party's trade as a customer reads it. Empty for no trade. */
export function tradeLabel(raw: string | null | undefined): string {
  const slug = (raw ?? '').trim();
  if (!slug) return '';
  const key = slug.toLowerCase();
  if (TRADE_WORDS[key]) return TRADE_WORDS[key];
  const option = SERVICE_TRADE_OPTIONS.find((t) => t.value === key);
  if (option) return option.label;
  // Free text someone typed ("Tile setter") is already a label.
  return /[_-]/.test(slug) || slug === key ? humanizeSlug(slug) : slug;
}

const CATEGORY_WORDS: Record<string, string> = {
  before: 'Before',
  after: 'After',
  condition: 'Condition',
  issue: 'Issue',
  completion: 'Completion',
};

/**
 * The evidence category a customer reads. `other` / missing is not a
 * category anyone chose, so fall back to the clip's before/after phase.
 */
export function evidenceCategoryLabel(
  category: string | null | undefined,
  phase?: string | null,
): { key: string; label: string } {
  const key = (category ?? '').trim().toLowerCase();
  if (CATEGORY_WORDS[key]) return { key, label: CATEGORY_WORDS[key] };
  const phaseKey = (phase ?? '').trim().toLowerCase();
  if (CATEGORY_WORDS[phaseKey]) return { key: phaseKey, label: CATEGORY_WORDS[phaseKey] };
  return { key: 'other', label: 'General' };
}

export type StatusTone = 'neutral' | 'progress' | 'good' | 'bad';

export interface EvidenceStatus {
  capture: { label: string; tone: StatusTone };
  processing: { label: string; tone: StatusTone };
  review: { label: string; tone: StatusTone };
}

/**
 * One proof state column (`uploaded → checked → analysed → accepted|rejected`)
 * carries three different questions. Split them so a customer can read each:
 *   capture    — is the file here?
 *   processing — has the integrity check and AI reading finished?
 *   review     — has a person signed off?
 */
export function evidenceStatus(input: {
  state: string | null | undefined;
  failedChecks?: number;
  legalHold?: boolean;
}): EvidenceStatus {
  const state = (input.state ?? '').trim().toLowerCase();
  const capture = { label: 'Uploaded', tone: 'good' as StatusTone };

  let processing: EvidenceStatus['processing'];
  if ((input.failedChecks ?? 0) > 0) {
    const n = input.failedChecks ?? 0;
    processing = { label: `${n} check${n === 1 ? '' : 's'} failed`, tone: 'bad' };
  } else if (state === 'uploaded') {
    processing = { label: 'Waiting to process', tone: 'neutral' };
  } else if (state === 'checked') {
    processing = { label: 'Analyzing', tone: 'progress' };
  } else if (state === 'analysed' || state === 'analyzed' || state === 'accepted' || state === 'rejected') {
    processing = { label: 'Analyzed', tone: 'good' };
  } else {
    processing = { label: state ? humanizeSlug(state) : 'Unknown', tone: 'neutral' };
  }

  let review: EvidenceStatus['review'];
  if (state === 'accepted') review = { label: 'Accepted', tone: 'good' };
  else if (state === 'rejected') review = { label: 'Rejected', tone: 'bad' };
  else if (input.legalHold) review = { label: 'On hold', tone: 'neutral' };
  else review = { label: 'Not reviewed', tone: 'neutral' };

  return { capture, processing, review };
}
