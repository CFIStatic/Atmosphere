/**
 * Reading one clip's actual footage, on demand.
 *
 * The upload pipeline reads a day when a crew files it. This module is the
 * other moment: somebody opens a clip in the Verifier and the panel has
 * nothing to show — the day pipeline never ran, or the phone filed the video
 * without stills, or the clip is the morning half of a pair and the day's
 * reading lives on the afternoon one. Before this existed that panel sat on
 * "the assistant is reading this clip" forever, which is a lie told by a
 * spinner.
 *
 * So: mint a signed URL for the stored video, sparsely extract stills (the
 * same frame pipeline every other inbound video uses), hand them to the vision
 * model, and write the result onto the clip. What comes back is a reading of
 * *this* clip — what is happening in it — not a comparison against its sibling.
 *
 * Two disciplines carry over from the day pipeline and are not negotiable
 * here either: the model describes what is visible and never infers what was
 * probably done, and nothing about money reaches it. A reading that can move
 * a payment has to be checkable against the playhead, which is why every beat
 * carries the timestamp of the frame it came from.
 */
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { isModelProviderConfigured } from '../lib/anthropic.js';
import {
  dictatePreparedFrames,
  prepareVideoFrames,
  type PreparedVideoFrame,
} from './videoIntelligence.js';
import { persistProofActions, type VisionAction } from './proofActions.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROOF_BUCKET = 'job-proofs';

/** How many stills one on-demand clip read is allowed to keep. */
export const CLIP_READ_MAX_FRAMES = 24;

/** How many of those stills a question is allowed to carry to the model. */
export const CLIP_ASK_MAX_FRAMES = 12;

export interface ClipVisionFrame {
  atSeconds: number;
  jpeg: Buffer;
}

export interface ClipReading {
  dictation: string;
  summary: string | null;
  entries: Array<{ frame: number; atSeconds: number; stageIndex: number; note: string }>;
  actions: VisionAction[];
  model: string;
  frameCount: number;
}

/** The proof row columns a clip read needs. Narrow on purpose. */
export const CLIP_VISION_PROOF_SELECT =
  'id, org_id, job_id, party_id, phase, work_date, storage_path, duration_seconds, ' +
  'narration_status, narration_text, ai_summary';

export interface ClipVisionProof {
  id: string;
  org_id: string;
  job_id: string;
  party_id: string | null;
  phase: string | null;
  work_date: string | null;
  storage_path: string | null;
  duration_seconds: number | null;
  narration_status?: string | null;
  narration_text?: string | null;
  ai_summary?: string | null;
}

/** Has this clip already been read, whatever the day pipeline made of the pair? */
export function hasClipReading(proof: {
  narration_text?: string | null;
  ai_summary?: string | null;
}): boolean {
  return Boolean(
    (proof.narration_text && String(proof.narration_text).trim()) ||
      (proof.ai_summary && String(proof.ai_summary).trim()),
  );
}

/** Evenly spaced subset — the same shape videoIntelligence uses, kept local. */
export function spaceFrames<T>(frames: T[], max: number): T[] {
  if (frames.length <= max) return frames.slice();
  if (max <= 1) return frames.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(frames[Math.round((i * (frames.length - 1)) / (max - 1))]!);
  }
  return out;
}

/**
 * The sentence the model gets about where this footage came from.
 *
 * Job, crew, date and phase — enough to write a reading somebody can file.
 * Never the amount, never whether the sub is trusted: what is on screen does
 * not change because the invoice is large.
 */
export function clipContextText(input: {
  proof: Pick<ClipVisionProof, 'phase' | 'work_date' | 'duration_seconds'>;
  jobName?: string | null;
  company?: string | null;
  scopeTitles?: string[];
}): string {
  const lines: string[] = [];
  if (input.jobName) lines.push(`Job: ${input.jobName}`);
  if (input.company) lines.push(`Crew: ${input.company}`);
  if (input.proof.work_date) lines.push(`Work date: ${input.proof.work_date}`);
  if (input.proof.phase) lines.push(`Phase: ${input.proof.phase}`);
  if (input.proof.duration_seconds != null) {
    lines.push(`Duration: ${Math.round(Number(input.proof.duration_seconds))}s`);
  }
  const scope = (input.scopeTitles ?? []).filter(Boolean).slice(0, 20);
  if (scope.length) {
    lines.push(
      'Agreed scope for this crew (say only what the stills support, and say "not visible" freely):',
    );
    for (const title of scope) lines.push(`- ${title}`);
  }
  lines.push(
    'Describe what is visible in these stills for the office reviewer sitting next to the player.',
  );
  return lines.join('\n');
}

/** Frames already on file for this clip, oldest moment first. */
export async function storedClipFrames(
  admin: any,
  proofId: string,
  max = CLIP_READ_MAX_FRAMES,
): Promise<ClipVisionFrame[]> {
  const { data: rows } = await admin
    .from('job_proof_frames')
    .select('at_seconds, storage_path')
    .eq('proof_id', proofId)
    .order('at_seconds');
  const wanted = spaceFrames((rows ?? []) as any[], max);
  const frames: ClipVisionFrame[] = [];
  for (const row of wanted) {
    const { data: blob } = await admin.storage.from(PROOF_BUCKET).download(row.storage_path);
    if (!blob) continue;
    frames.push({
      atSeconds: Number(row.at_seconds),
      jpeg: Buffer.from(await blob.arrayBuffer()),
    });
  }
  return frames;
}

/**
 * Pull stills out of the stored video itself and keep them.
 *
 * Node never holds the file: ffmpeg reads the signed URL and writes JPEGs.
 * The frames are stored because the next question about this clip should not
 * pay to extract them again, and because "these are the frames the model read"
 * is part of the record.
 */
export async function extractClipFrames(
  admin: any,
  proof: ClipVisionProof,
  max = CLIP_READ_MAX_FRAMES,
): Promise<ClipVisionFrame[]> {
  if (!proof.storage_path) return [];
  const { data: signed, error } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(proof.storage_path, 60 * 60);
  if (error || !signed?.signedUrl) {
    throw new HttpError(
      502,
      'Could not open the stored video to read it.',
      'clip_video_unreachable',
    );
  }

  const durationSeconds = Number(proof.duration_seconds ?? 0) || 60;
  const prepared = await prepareVideoFrames({
    id: proof.id,
    source: 'proof_of_work',
    url: signed.signedUrl,
    durationSeconds,
    maxFrames: max,
  });
  if (!prepared.frames.length) return [];

  const kept = spaceFrames(prepared.frames, max);
  for (const frame of kept) {
    const path =
      `${proof.org_id}/${proof.job_id}/${proof.party_id ?? 'unassigned'}/` +
      `${proof.work_date ?? 'undated'}-${proof.phase ?? 'clip'}-cv${Math.round(frame.atSeconds)}.jpg`;
    try {
      await admin.storage
        .from(PROOF_BUCKET)
        .upload(path, frame.jpeg, { contentType: 'image/jpeg', upsert: true });
      await admin.from('job_proof_frames').upsert(
        {
          org_id: proof.org_id,
          proof_id: proof.id,
          at_seconds: frame.atSeconds,
          storage_path: path,
        },
        { onConflict: 'proof_id,at_seconds' },
      );
    } catch {
      // A still that would not store is not a reason to refuse the reading —
      // the bytes are in hand either way. The next read re-extracts.
    }
  }
  return kept.map((frame: PreparedVideoFrame) => ({
    atSeconds: frame.atSeconds,
    jpeg: frame.jpeg,
  }));
}

/** Stills for this clip: whatever is on file, else straight out of the video. */
export async function ensureClipFrames(
  admin: any,
  proof: ClipVisionProof,
  max = CLIP_READ_MAX_FRAMES,
): Promise<ClipVisionFrame[]> {
  const stored = await storedClipFrames(admin, proof.id, max);
  if (stored.length >= 2) return stored;
  const extracted = await extractClipFrames(admin, proof, max);
  if (extracted.length) return extracted;
  return stored;
}

/**
 * Beats for the note stream that runs beside the player.
 *
 * Every action the model reported becomes one timestamped line, so a reviewer
 * can click a claim and land on the frame it was made from.
 */
export function readingEntries(actions: VisionAction[]): ClipReading['entries'] {
  return actions
    .filter((action) => String(action.description ?? '').trim())
    .map((action, index) => ({
      frame: index,
      atSeconds: Math.max(0, Number(action.atSeconds) || 0),
      stageIndex: -1,
      note: String(action.description).trim(),
    }))
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * One read of one clip, persisted onto the proof row.
 *
 * In-flight reads are shared rather than repeated: the panel asks for a
 * reading the moment a clip opens, and a reviewer who clicks the button at the
 * same time should join that read, not buy a second one.
 */
const inFlight = new Map<string, Promise<ClipReading>>();

export async function readClipFootage(
  admin: any,
  input: {
    proof: ClipVisionProof;
    jobName?: string | null;
    company?: string | null;
    scopeTitles?: string[];
    maxFrames?: number;
  },
): Promise<ClipReading> {
  const existing = inFlight.get(input.proof.id);
  if (existing) return existing;

  const run = performClipRead(admin, input).finally(() => inFlight.delete(input.proof.id));
  inFlight.set(input.proof.id, run);
  return run;
}

async function performClipRead(
  admin: any,
  input: {
    proof: ClipVisionProof;
    jobName?: string | null;
    company?: string | null;
    scopeTitles?: string[];
    maxFrames?: number;
  },
): Promise<ClipReading> {
  const proof = input.proof;
  if (!isModelProviderConfigured()) {
    throw new HttpError(
      503,
      'Model access is not configured on this server.',
      'model_provider_unconfigured',
    );
  }
  if (!proof.storage_path) {
    throw new HttpError(409, 'This clip has no stored video to read.', 'no_video');
  }

  await admin.from('job_proofs').update({ narration_status: 'running' }).eq('id', proof.id);

  try {
    const frames = await ensureClipFrames(
      admin,
      proof,
      Math.max(4, Math.min(input.maxFrames ?? CLIP_READ_MAX_FRAMES, CLIP_READ_MAX_FRAMES)),
    );
    if (!frames.length) {
      throw new HttpError(
        422,
        'Could not extract any frames from this recording.',
        'no_frames',
      );
    }

    const durationSeconds =
      Number(proof.duration_seconds ?? 0) || frames[frames.length - 1]!.atSeconds || 60;

    const dictation = await dictatePreparedFrames(
      {
        id: proof.id,
        source: 'proof_of_work',
        durationSeconds,
        frames: frames.map((frame) => ({ atSeconds: frame.atSeconds, jpeg: frame.jpeg })),
        longForm: durationSeconds >= config.verification.longFormSeconds,
      },
      {
        contextText: clipContextText({
          proof,
          jobName: input.jobName,
          company: input.company,
          scopeTitles: input.scopeTitles,
        }),
        maxModelFrames: frames.length,
      },
    );

    const entries = readingEntries(dictation.actions);
    const reading: ClipReading = {
      dictation: dictation.narrationText,
      summary: dictation.narrationSummary,
      entries,
      actions: dictation.actions,
      model: dictation.model,
      frameCount: dictation.frameCount,
    };

    await admin
      .from('job_proofs')
      .update({
        ai_summary: (dictation.narrationSummary || dictation.narrationText).slice(0, 500),
        ai_model: dictation.model,
        narration: { entries, coverage: [], model: dictation.model, source: 'clip_read' },
        narration_text: dictation.narrationText,
        narration_status: 'done',
        narration_error: null,
        narrated_at: new Date().toISOString(),
      })
      .eq('id', proof.id);

    if (dictation.actions.length) {
      await persistProofActions(admin, {
        orgId: proof.org_id,
        proofId: proof.id,
        actions: dictation.actions,
        model: dictation.model,
      });
    }

    return reading;
  } catch (error) {
    // A failed read says so on the row. A status column that stays "running"
    // after the attempt died is the spinner problem again, one layer down.
    await admin
      .from('job_proofs')
      .update({
        narration_status: 'failed',
        narration_error:
          error instanceof Error ? error.message.slice(0, 400) : 'The clip read failed.',
      })
      .eq('id', proof.id);
    throw error;
  }
}
