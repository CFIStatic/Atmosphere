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
import { clipProcessing, type ClipProcessingInput } from './clipProcessing';

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
  analysisStatus?: string | null;
  transcriptStatus?: string | null;
  narrationStatus?: string | null;
  summaryState?: string | null;
  hasSummary?: boolean | null;
  noSpeech?: boolean | null;
  uploading?: boolean | null;
  retrying?: boolean | null;
  transcriptActive?: boolean | null;
  analysisActive?: boolean | null;
  narrationActive?: boolean | null;
  summaryActive?: boolean | null;
}): EvidenceStatus {
  const state = (input.state ?? '').trim().toLowerCase();
  const capture = { label: 'Uploaded', tone: 'good' as StatusTone };
  const derived = clipProcessing({
    proofState: input.state,
    failedChecks: input.failedChecks,
    analysisStatus: input.analysisStatus,
    transcriptStatus: input.transcriptStatus,
    narrationStatus: input.narrationStatus,
    summaryState: input.summaryState,
    hasSummary: input.hasSummary,
    noSpeech: input.noSpeech,
    uploading: input.uploading,
    retrying: input.retrying,
    transcriptActive: input.transcriptActive,
    analysisActive: input.analysisActive,
    narrationActive: input.narrationActive,
    summaryActive: input.summaryActive,
  } satisfies ClipProcessingInput);
  const processing = { label: derived.label, tone: derived.tone };

  let review: EvidenceStatus['review'];
  if (state === 'accepted') review = { label: 'Accepted', tone: 'good' };
  else if (state === 'rejected') review = { label: 'Rejected', tone: 'bad' };
  else review = { label: 'Not reviewed', tone: 'neutral' };

  return { capture, processing, review };
}
