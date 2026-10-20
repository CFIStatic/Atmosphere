/**
 * Builds a text-only training set from people's ratings and corrections of
 * clip summaries, for fine-tuning a model on Atmosphere's own work.
 *
 * What goes in, and what never does:
 * - Only workspaces whose Global Admin turned on "Help improve Atmosphere's
 *   AI" (org_ai_training_settings.opted_in).
 * - Only text: the clip's transcript in, the summary a person approved or
 *   wrote out. No video, audio, stills or storage paths.
 * - Clips with a child or private moment are skipped entirely.
 * - Names the job knows (crew, companies, speakers, members, the job title),
 *   claim and policy numbers, emails, phone numbers and street addresses are
 *   replaced with placeholders. Pattern matching misses things, so a person
 *   still reviews a sample before any training run.
 *
 * Splits are by job, so one job's clips never land in both train and test.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { assignSplit, type DatasetSplit } from '../verification/dataset/splits.js';

type Db = { from: (table: string) => any };

export const SUMMARY_SYSTEM_PROMPT =
  'You summarize a job-site video for a restoration or construction contractor. ' +
  'Say what work was done or discussed, any agreements, concerns or next steps, in plain sentences. ' +
  'Only state what the transcript supports.';

const PATTERNS: Array<{ placeholder: string; re: RegExp }> = [
  { placeholder: '[EMAIL]', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { placeholder: '[PHONE]', re: /(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { placeholder: '[ID]', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    placeholder: '[ADDRESS]',
    re: /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Lane|Ln|Dr|Drive|Ct|Court|Way|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace|Hwy|Highway)\b\.?/g,
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Terms worth hiding: whole values plus each word of a multi-word name
 * ("Maria Lopez" also hides "Maria" and "Lopez"). Short or common words are
 * left alone so "Roofing" or "Al" do not blank out ordinary text.
 */
export function namesToHide(values: Array<string | null | undefined>, wholeOnly: Array<string | null | undefined> = []): string[] {
  const out = new Set<string>();
  for (const raw of wholeOnly) {
    const value = (raw ?? '').trim();
    if (value.length >= 3) out.add(value);
  }
  const skip = new Set([
    'llc', 'inc', 'co', 'corp', 'company', 'the', 'and', 'of', 'roofing', 'restoration', 'construction',
    'plumbing', 'electric', 'electrical', 'services', 'service', 'group', 'home', 'homes', 'job', 'house',
    'residence', 'repair', 'water', 'damage', 'mitigation', 'test', 'new', 'old', 'north', 'south', 'east', 'west',
  ]);
  for (const raw of values) {
    const value = (raw ?? '').trim();
    if (value.length < 3) continue;
    out.add(value);
    for (const word of value.split(/[\s,.'’()/-]+/)) {
      if (word.length >= 3 && !skip.has(word.toLowerCase()) && /^[A-Za-z]/.test(word)) out.add(word);
    }
  }
  // Longest first so "Maria Lopez" is replaced before "Maria".
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrubText(text: string, hide: string[]): string {
  let out = text;
  // Patterns first, so an email is one [EMAIL] rather than "[NAME]@x.com".
  for (const { placeholder, re } of PATTERNS) out = out.replace(re, placeholder);
  for (const term of hide) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), '[NAME]');
  }
  return out;
}

/** A clip with any child or private moment never enters the training set. */
export function hasProtectedMoments(aiFindings: unknown): boolean {
  if (!aiFindings || typeof aiFindings !== 'object') return false;
  const findings = aiFindings as Record<string, any>;
  for (const key of ['childPrivacyRedactions', 'privacyRedactions']) {
    const ranges = findings[key]?.ranges;
    if (Array.isArray(ranges) && ranges.length > 0) return true;
  }
  return false;
}

export interface FeedbackRow {
  id: string;
  org_id: string;
  job_id: string;
  proof_id: string;
  rating: number;
  reason: string | null;
  ai_text: string;
  ai_model: string | null;
  corrected_text: string | null;
}

export interface ClipRow {
  id: string;
  transcript_text: string | null;
  phase: string | null;
  duration_seconds: number | null;
  ai_findings: unknown;
}

export interface SftExample {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  meta: {
    exampleId: string;
    split: DatasetSplit;
    source: 'correction' | 'approved';
    aiModel: string | null;
  };
}

export interface PreferenceExample {
  prompt: Array<{ role: 'system' | 'user'; content: string }>;
  chosen: string;
  rejected: string;
  meta: { exampleId: string; split: DatasetSplit; reason: string | null; aiModel: string | null };
}

export type SkipReason = 'no_transcript' | 'protected_moments' | 'thumbs_down_without_fix' | 'clip_missing';

export function userPrompt(clip: ClipRow, transcript: string): string {
  const facts = [
    clip.phase ? `Clip: ${clip.phase}` : null,
    clip.duration_seconds ? `Length: ${Math.round(Number(clip.duration_seconds))} seconds` : null,
  ].filter(Boolean);
  return `${facts.join('\n')}${facts.length ? '\n\n' : ''}Transcript:\n${transcript}`;
}

/**
 * One feedback row becomes:
 * - a corrected summary → a training example AND a preference pair (fix beats AI text);
 * - a thumbs up → a training example with the AI text as the answer;
 * - a thumbs down with no fix → nothing (it says what is wrong, not what is right).
 */
export function buildExamples(
  row: FeedbackRow,
  clip: ClipRow | undefined,
  hide: string[],
): { sft?: SftExample; preference?: PreferenceExample; skipped?: SkipReason } {
  if (!clip) return { skipped: 'clip_missing' };
  if (hasProtectedMoments(clip.ai_findings)) return { skipped: 'protected_moments' };
  const transcript = (clip.transcript_text ?? '').trim();
  if (!transcript) return { skipped: 'no_transcript' };
  const corrected = row.corrected_text?.trim() || null;
  if (row.rating !== 1 && !corrected) return { skipped: 'thumbs_down_without_fix' };

  const split = assignSplit({ projectId: row.job_id });
  const exampleId = createHash('sha256').update(`clip-summary:${row.id}`).digest('hex').slice(0, 16);
  const system = { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT };
  const user = { role: 'user' as const, content: scrubText(userPrompt(clip, transcript), hide) };
  const answer = scrubText(corrected ?? row.ai_text, hide);

  const sft: SftExample = {
    messages: [system, user, { role: 'assistant', content: answer }],
    meta: { exampleId, split, source: corrected ? 'correction' : 'approved', aiModel: row.ai_model },
  };
  if (!corrected) return { sft };
  return {
    sft,
    preference: {
      prompt: [system, user],
      chosen: answer,
      rejected: scrubText(row.ai_text, hide),
      meta: { exampleId, split, reason: row.reason, aiModel: row.ai_model },
    },
  };
}

export interface TrainingSetResult {
  orgsOptedIn: number;
  feedbackRows: number;
  sft: SftExample[];
  preference: PreferenceExample[];
  skipped: Record<SkipReason, number>;
}

/** Reads opted-in workspaces' feedback with the service client and builds the examples in memory. */
export async function collectTrainingSet(admin: Db): Promise<TrainingSetResult> {
  const skipped: Record<SkipReason, number> = {
    no_transcript: 0,
    protected_moments: 0,
    thumbs_down_without_fix: 0,
    clip_missing: 0,
  };
  const result: TrainingSetResult = { orgsOptedIn: 0, feedbackRows: 0, sft: [], preference: [], skipped };

  const { data: settings, error: settingsError } = await admin
    .from('org_ai_training_settings')
    .select('org_id')
    .eq('opted_in', true);
  if (settingsError) throw new Error(settingsError.message);
  const orgIds = (settings ?? []).map((row: { org_id: string }) => row.org_id);
  result.orgsOptedIn = orgIds.length;
  if (!orgIds.length) return result;

  for (const orgId of orgIds) {
    const { data: rows, error } = await admin
      .from('clip_summary_feedback')
      .select('id, org_id, job_id, proof_id, rating, reason, ai_text, ai_model, corrected_text')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(10000);
    if (error) throw new Error(error.message);
    const feedback = (rows ?? []) as FeedbackRow[];
    result.feedbackRows += feedback.length;
    if (!feedback.length) continue;

    const proofIds = [...new Set(feedback.map((r) => r.proof_id))];
    const jobIds = [...new Set(feedback.map((r) => r.job_id))];
    const clips = new Map<string, ClipRow>();
    for (let i = 0; i < proofIds.length; i += 200) {
      const { data } = await admin
        .from('job_proofs')
        .select('id, transcript_text, phase, duration_seconds, ai_findings')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('id', proofIds.slice(i, i + 200));
      for (const clip of (data ?? []) as ClipRow[]) clips.set(clip.id, clip);
    }

    const known = await orgNames(admin, orgId, jobIds, proofIds);
    const hide = namesToHide(known.names, known.phrases);
    for (const row of feedback) {
      const built = buildExamples(row, clips.get(row.proof_id), hide);
      if (built.skipped) skipped[built.skipped] += 1;
      if (built.sft) result.sft.push(built.sft);
      if (built.preference) result.preference.push(built.preference);
    }
  }
  return result;
}

/**
 * Every name and number the workspace's records know for these jobs. Job
 * titles and claim numbers are hidden whole only: a title like "Lopez
 * kitchen" must not blank out every "kitchen".
 */
async function orgNames(
  admin: Db,
  orgId: string,
  jobIds: string[],
  proofIds: string[],
): Promise<{ names: string[]; phrases: string[] }> {
  const names: Array<string | null> = [];
  const phrases: Array<string | null> = [];
  const { data: parties } = await admin
    .from('job_parties')
    .select('company, contact_name')
    .eq('org_id', orgId)
    .in('job_id', jobIds);
  for (const p of parties ?? []) names.push(p.company, p.contact_name);

  const { data: jobs } = await admin
    .from('crm_jobs')
    .select('title, claim_number, policy_number')
    .eq('org_id', orgId)
    .in('id', jobIds);
  for (const j of jobs ?? []) phrases.push(j.title, j.claim_number, j.policy_number);

  const { data: speakers } = await admin
    .from('speaker_identities')
    .select('display_name')
    .eq('org_id', orgId)
    .in('proof_id', proofIds);
  for (const s of speakers ?? []) names.push(s.display_name);

  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', orgId);
  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (userIds.length) {
    const { data: profiles } = await admin.from('profiles').select('full_name, email').in('id', userIds);
    for (const p of profiles ?? []) names.push(p.full_name, p.email);
  }
  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  names.push(org?.name ?? null);
  const strings = (list: Array<string | null>) => list.filter((n): n is string => typeof n === 'string');
  return { names: strings(names), phrases: strings(phrases) };
}
