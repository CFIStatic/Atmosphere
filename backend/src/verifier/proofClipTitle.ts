/**
 * Short human titles for filed clips.
 *
 * The Videos list groups clips under a job folder. Repeating the job name on
 * every nested row makes three films look identical. After vision/narration
 * reads a clip, we keep a few-word title on job_proofs.title so the list can
 * show "Inspection" or "Tear-off north slope" instead.
 *
 * Offices may also set job_proofs.custom_title. That override wins everywhere
 * the clip name is painted; clearing it falls back to the AI title.
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

const UUID_TITLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Empty, whitespace, or a raw UUID — treat as untitled for derivation/backfill. */
export function isPlaceholderClipTitle(title: string | null | undefined): boolean {
  const text = String(title ?? '').trim();
  if (!text) return true;
  if (UUID_TITLE.test(text)) return true;
  // Short hex tails sometimes used as list ids ("Video · a1b2c3d4") are fine as titles
  // only when longer human text exists; pure 32-hex blobs are placeholders.
  if (/^[0-9a-f]{32}$/i.test(text)) return true;
  return false;
}


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
  const title = deriveProofClipTitle({ ...source, existingTitle: undefined });
  if (!title) return null;

  const { data: row } = await admin
    .from('job_proofs')
    .select('title')
    .eq('id', proofId)
    .maybeSingle();
  if (!isPlaceholderClipTitle(row?.title)) return null;

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

/** Max length for an office-chosen clip name (DB check matches). */
export const CUSTOM_CLIP_TITLE_MAX = 80;

/**
 * Normalize a typed custom name. Empty / whitespace → null (fall back to AI).
 * Collapses internal whitespace; clamps to CUSTOM_CLIP_TITLE_MAX.
 */
export function normalizeCustomClipTitle(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.slice(0, CUSTOM_CLIP_TITLE_MAX);
}

/**
 * Effective painted name: custom title when set, else AI/stored/derived title.
 */
export function displayClipTitle(input: {
  customTitle?: string | null;
  title?: string | null;
}): string | null {
  const custom = normalizeCustomClipTitle(input.customTitle);
  if (custom) return custom;
  const stored = typeof input.title === 'string' ? input.title.trim() : '';
  return stored || null;
}

/**
 * What the Videos list paints as the clip name under a job group.
 * Prefer custom title, then stored (or derived) AI title; else phase + short id —
 * never clock time alone, and never the job name on nested rows.
 */
export function proofClipListLabel(input: {
  /** Office override — wins over AI title when non-empty. */
  customTitle?: string | null;
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
  const custom = normalizeCustomClipTitle(input.customTitle);
  if (custom) return custom;
  const stored = typeof input.title === 'string' ? input.title.trim() : '';
  if (stored && !isPlaceholderClipTitle(stored)) return stored;

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

/**
 * Save or clear an office-chosen clip name.
 * Pass empty/whitespace to clear (AI title returns). Returns the row fields
 * the list needs to repaint: customTitle + effective title.
 */
export async function setProofCustomTitle(
  admin: { from: (table: string) => any },
  proofId: string,
  rawCustomTitle: unknown,
): Promise<{ customTitle: string | null; title: string | null; aiTitle: string | null }> {
  const customTitle = normalizeCustomClipTitle(rawCustomTitle);
  const { data: row, error: readErr } = await admin
    .from('job_proofs')
    .select('title, custom_title')
    .eq('id', proofId)
    .maybeSingle();
  if (readErr) {
    throw new Error(readErr.message || 'Could not load clip');
  }
  if (!row) {
    throw new Error('No such clip');
  }

  const { error: writeErr } = await admin
    .from('job_proofs')
    .update({ custom_title: customTitle })
    .eq('id', proofId);
  if (writeErr) {
    throw new Error(writeErr.message || 'Could not rename clip');
  }

  const aiTitle =
    typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null;
  return {
    customTitle,
    aiTitle,
    title: customTitle ?? aiTitle,
  };
}


export type ProofClipTitleBackfillResult = {
  scanned: number;
  wouldWrite: number;
  written: number;
  skipped: number;
  dryRun: boolean;
};

/**
 * Backfill AI titles for clips that still show blank/UUID titles.
 * Dry-run by default (apply=false). Uses existing analysis fields — no model calls.
 */
export async function backfillProofClipTitles(
  admin: { from: (table: string) => any },
  options?: {
    apply?: boolean;
    orgId?: string | null;
    jobId?: string | null;
    limit?: number;
  },
): Promise<ProofClipTitleBackfillResult> {
  const apply = Boolean(options?.apply);
  const limit = Math.max(1, Math.min(Number(options?.limit) || 500, 5000));
  let q = admin
    .from('job_proofs')
    .select(
      'id, title, custom_title, phase, ai_summary, narration_text, narration, actions, labels, ai_findings',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (options?.orgId) q = q.eq('org_id', options.orgId);
  if (options?.jobId) q = q.eq('job_id', options.jobId);

  const { data, error } = await q;
  if (error) throw new Error(error.message || 'Could not list proofs for title backfill');

  const rows = Array.isArray(data) ? data : [];
  let wouldWrite = 0;
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!isPlaceholderClipTitle(row.title)) {
      skipped += 1;
      continue;
    }
    if (normalizeCustomClipTitle(row.custom_title)) {
      skipped += 1;
      continue;
    }
    const findings =
      row.ai_findings && typeof row.ai_findings === 'object' ? (row.ai_findings as Record<string, unknown>) : {};
    const narration =
      (typeof row.narration_text === 'string' && row.narration_text.trim()) ||
      (typeof row.narration === 'string' && row.narration.trim()) ||
      (typeof findings.narrative === 'string' ? String(findings.narrative) : null);
    const actions = Array.isArray(row.actions)
      ? row.actions
      : Array.isArray(findings.actions)
        ? findings.actions
        : [];
    const title = deriveProofClipTitle({
      summary: row.ai_summary ?? (typeof findings.summary === 'string' ? findings.summary : null),
      narration,
      actions: actions as ProofTitleAction[],
      labels: Array.isArray(row.labels) ? row.labels : null,
      phase: row.phase,
    });
    if (!title) {
      skipped += 1;
      continue;
    }
    wouldWrite += 1;
    if (!apply) continue;
    const { error: writeErr } = await admin.from('job_proofs').update({ title }).eq('id', row.id);
    if (writeErr) {
      console.warn('[proof-title-backfill] write failed', row.id, writeErr.message);
      skipped += 1;
      continue;
    }
    written += 1;
  }

  return {
    scanned: rows.length,
    wouldWrite,
    written: apply ? written : 0,
    skipped,
    dryRun: !apply,
  };
}

/** Stable short citation label: title, or date + clip number. Never mid-word cut. */
export function stableClipCitationLabel(input: {
  title?: string | null;
  workDate?: string | null;
  clipNumber?: number | null;
  atSeconds?: number | null;
  maxLen?: number;
}): string {
  const max = input.maxLen ?? 40;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatDate = (iso: string): string => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
  };
  const formatClock = (seconds: number): string => {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const min = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}:${String(min).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${min}:${String(r).padStart(2, '0')}`;
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let base = '';
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
  if (title && !uuid.test(title)) {
    base = title.length <= max ? title : title.slice(0, max).replace(/\s+\S*$/, '').trim() || title.slice(0, max);
  } else if (input.workDate) {
    const date = formatDate(String(input.workDate).slice(0, 10));
    const n = input.clipNumber;
    base = n != null && n > 0 ? `${date} · Clip ${n}` : `${date} clip`;
  } else {
    base = 'Clip';
  }
  if (input.atSeconds != null && Number.isFinite(input.atSeconds)) {
    return `${base} · ${formatClock(input.atSeconds)}`;
  }
  return base;
}
