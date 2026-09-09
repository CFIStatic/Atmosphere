/**
 * Short human titles for filed clips.
 *
 * The Videos list groups clips under a job folder. Repeating the job name on
 * every nested row makes three films look identical. After vision/narration
 * reads a clip, we keep a few-word title on job_proofs.title so the list can
 * show "Inspection" or "Tear-off north slope" instead.
 */

export type ProofTitleAction = {
  action?: string | null;
  objectLabel?: string | null;
  description?: string | null;
  room?: string | null;
};

export type ProofTitleSource = {
  /** Existing DB title — when set, we never overwrite. */
  existingTitle?: string | null;
  summary?: string | null;
  narration?: string | null;
  narrationSummary?: string | null;
  actions?: ProofTitleAction[] | null;
  labels?: string[] | null;
  phase?: string | null;
};

const MAX_TITLE_CHARS = 60;
const MAX_TITLE_WORDS = 8;
const MIN_TITLE_CHARS = 2;

const NOISE_LABEL = /^(before|after|workday|walkthrough|no_scope|change:|action:|stage:)/i;
const STOP_LEAD = /^(the|a|an|this|that|there|here|it|we|they|crew|technician)\s+/i;

function cleanPhrase(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’.\-:;]+|[\s"'“”‘’.\-:;]+$/g, '')
    .trim();
}

function titleCaseWords(phrase: string): string {
  return phrase
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2 && word === word.toLowerCase()) return word;
      if (/^[A-Z0-9]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function clampTitle(phrase: string): string | null {
  let text = cleanPhrase(phrase);
  if (!text) return null;
  text = text.replace(STOP_LEAD, '');
  const words = text.split(/\s+/).filter(Boolean).slice(0, MAX_TITLE_WORDS);
  text = words.join(' ');
  if (text.length > MAX_TITLE_CHARS) {
    text = text.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, '').trim();
  }
  text = cleanPhrase(text);
  if (text.length < MIN_TITLE_CHARS) return null;
  return titleCaseWords(text);
}

function firstClause(text: string): string {
  const cut = text.split(/(?<=[.!?])\s+|;\s+| — |\n/)[0] ?? text;
  return cleanPhrase(cut);
}

function fromActions(actions: ProofTitleAction[] | null | undefined): string | null {
  for (const row of actions ?? []) {
    const object = cleanPhrase(String(row.objectLabel ?? ''));
    if (object.length >= MIN_TITLE_CHARS) return clampTitle(object);

    const room = cleanPhrase(String(row.room ?? ''));
    const action = cleanPhrase(String(row.action ?? '').replace(/_/g, ' '));
    if (room && action) return clampTitle(`${action} ${room}`);
    if (action && action.length >= MIN_TITLE_CHARS) return clampTitle(action);

    const description = firstClause(String(row.description ?? ''));
    if (description.length >= MIN_TITLE_CHARS) return clampTitle(description);
  }
  return null;
}

function fromLabels(labels: string[] | null | undefined): string | null {
  for (const raw of labels ?? []) {
    const label = cleanPhrase(String(raw ?? ''));
    if (!label || NOISE_LABEL.test(label)) continue;
    if (label.length < MIN_TITLE_CHARS) continue;
    return clampTitle(label);
  }
  return null;
}

/**
 * Derive a short clip title from the vision/narration reading.
 * Returns null when nothing useful is available — leave title empty.
 */
export function deriveProofClipTitle(input: ProofTitleSource): string | null {
  if (input.existingTitle && String(input.existingTitle).trim()) {
    return null;
  }

  const summaryCandidates = [input.narrationSummary, input.summary, input.narration];
  for (const candidate of summaryCandidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (!text) continue;
    const clause = firstClause(text);
    const clipped = clampTitle(clause);
    if (clipped) return clipped;
  }

  return fromActions(input.actions) ?? fromLabels(input.labels);
}

/** Patch fragment for a done write — empty when title should stay untouched. */
export function proofTitleWritePatch(
  input: ProofTitleSource,
): { title: string } | Record<string, never> {
  const title = deriveProofClipTitle(input);
  return title ? { title } : {};
}

/**
 * Persist a derived title only when job_proofs.title is still empty.
 * Safe to call after narration/analysis writes; never overwrites a set title.
 */
export async function persistProofClipTitleIfEmpty(
  admin: { from: (table: string) => any },
  proofId: string,
  source: ProofTitleSource,
): Promise<string | null> {
  const title = deriveProofClipTitle(source);
  if (!title) return null;

  const { data: row } = await admin
    .from('job_proofs')
    .select('title')
    .eq('id', proofId)
    .maybeSingle();
  if (row?.title && String(row.title).trim()) return null;

  const { error } = await admin.from('job_proofs').update({ title }).eq('id', proofId);
  if (error) {
    console.warn('[proof-title] could not store clip title:', error.message);
    return null;
  }
  return title;
}

function clipKindLabel(phase: string | null | undefined): string {
  const raw = String(phase || '')
    .replace(/_/g, ' ')
    .trim();
  if (!raw || raw === 'before' || raw === 'after') return 'Video';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Short unique token for list fallbacks — never a clock time.
 * Prefer a short clip id; else the tail of the proof id.
 */
export function shortProofListId(input: {
  clipId?: string | null;
  proofId?: string | null;
  id?: string | null;
}): string | null {
  const clip = typeof input.clipId === 'string' ? input.clipId.trim().toLowerCase() : '';
  if (/^[a-z0-9]{6,32}$/.test(clip)) return clip.slice(0, 8);
  const proofId = typeof input.proofId === 'string' ? input.proofId.trim() : '';
  if (proofId.length >= 6) return proofId.replace(/-/g, '').slice(-8);
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id.length >= 6) return id.replace(/-/g, '').slice(-8);
  return null;
}

/**
 * What the Videos list paints as the clip name under a job group.
 * Prefer stored (or derived) title; else phase + short id — never clock time alone,
 * and never the job name on nested rows.
 */
export function proofClipListLabel(input: {
  title?: string | null;
  phase?: string | null;
  capturedAt?: string | null;
  uploadedAt?: string | null;
  /** When true (nested under the job folder), never fall back to the job name. */
  underJob?: boolean;
  jobName?: string | null;
  clipId?: string | null;
  proofId?: string | null;
  id?: string | null;
  /** Optional analysis fields used when title is empty. */
  summary?: string | null;
  narration?: string | null;
  narrationSummary?: string | null;
  actions?: ProofTitleAction[] | null;
  labels?: string[] | null;
}): string {
  const stored = typeof input.title === 'string' ? input.title.trim() : '';
  if (stored) return stored;

  const derived = deriveProofClipTitle({
    summary: input.summary,
    narration: input.narration,
    narrationSummary: input.narrationSummary,
    actions: input.actions,
    labels: input.labels,
    phase: input.phase,
  });
  if (derived) return derived;

  const kind = clipKindLabel(input.phase);
  const shortId = shortProofListId(input);
  if (kind !== 'Video' && shortId) return `${kind} · ${shortId}`;
  if (kind !== 'Video') return kind;
  if (shortId) return `Video · ${shortId}`;
  if (input.underJob) return 'Video';
  const job = typeof input.jobName === 'string' ? input.jobName.trim() : '';
  return job || 'Video';
}
