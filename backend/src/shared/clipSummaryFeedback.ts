/**
 * Thumbs up / down and corrections on a clip's AI summary, and the workspace
 * switch that lets those corrections train Atmosphere's own AI.
 *
 * The AI text is read from the clip on the server at rating time (never taken
 * from the request), so every row pairs exactly what the model said with what
 * a person said it should be. The clip itself is never changed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';

type Db = { from: (table: string) => any };

export const CLIP_FEEDBACK_REASONS = ['wrong', 'missing', 'made_up', 'unclear', 'other'] as const;
export type ClipFeedbackReason = (typeof CLIP_FEEDBACK_REASONS)[number];

export const CORRECTION_MAX_CHARS = 4000;

export interface ClipSummaryFeedback {
  rating: 1 | -1;
  reason: ClipFeedbackReason | null;
  correctedText: string | null;
}

function missingTable(error: { message?: string; code?: string } | null | undefined, table: string): boolean {
  if (!error) return false;
  return new RegExp(`${table}|does not exist|schema cache`, 'i').test(`${error.message ?? ''} ${error.code ?? ''}`);
}

/** The summary the Videos tab shows for a clip: same fallback as the job proof list. */
export function shownSummary(row: { ai_summary?: string | null; narration_text?: string | null }): string | null {
  const text = (row.ai_summary ?? row.narration_text ?? '').trim();
  return text ? text : null;
}

/**
 * Rate a clip's summary (1 / -1), optionally with a reason and a corrected
 * version, or clear this person's rating with 0. Writes with the service
 * client; the caller has already resolved orgId from the session.
 */
export async function rateClipSummary(
  admin: Db,
  input: {
    orgId: string;
    jobId: string;
    proofId: string;
    userId: string;
    rating: 1 | -1 | 0;
    reason?: ClipFeedbackReason | null;
    correctedText?: string | null;
  },
): Promise<ClipSummaryFeedback | null> {
  const { data: clip, error: clipError } = await admin
    .from('job_proofs')
    .select('id, ai_summary, narration_text, ai_model')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('id', input.proofId)
    .is('deleted_at', null)
    .maybeSingle();
  if (clipError) throw new HttpError(500, clipError.message, 'clip_feedback_failed');
  if (!clip) throw new HttpError(404, 'That video is not on this job.', 'clip_not_found');

  if (input.rating === 0) {
    const { error } = await admin
      .from('clip_summary_feedback')
      .delete()
      .eq('org_id', input.orgId)
      .eq('proof_id', input.proofId)
      .eq('user_id', input.userId);
    if (error && !missingTable(error, 'clip_summary_feedback')) {
      throw new HttpError(500, error.message, 'clip_feedback_failed');
    }
    return null;
  }

  const aiText = shownSummary(clip);
  if (!aiText) throw new HttpError(409, 'This video has no summary to rate yet.', 'clip_summary_missing');

  const reason = input.rating === -1 ? (input.reason ?? null) : null;
  const corrected = input.correctedText?.trim().slice(0, CORRECTION_MAX_CHARS) || null;
  // A fix that only repeats the AI text is a thumbs up, not a correction.
  const correctedText = corrected && corrected !== aiText ? corrected : null;

  const { error } = await admin.from('clip_summary_feedback').upsert(
    {
      org_id: input.orgId,
      job_id: input.jobId,
      proof_id: input.proofId,
      user_id: input.userId,
      rating: input.rating,
      reason,
      ai_text: aiText.slice(0, 8000),
      ai_model: typeof clip.ai_model === 'string' ? clip.ai_model : null,
      corrected_text: correctedText,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'proof_id,user_id' },
  );
  if (error) {
    if (missingTable(error, 'clip_summary_feedback')) {
      throw new HttpError(503, 'Feedback is not available yet.', 'clip_feedback_unavailable');
    }
    throw new HttpError(500, error.message, 'clip_feedback_failed');
  }
  return { rating: input.rating, reason, correctedText };
}

/** This person's ratings on a job's clips, keyed by clip id. */
export async function myClipFeedback(
  admin: Db,
  input: { orgId: string; jobId: string; userId: string },
): Promise<Record<string, ClipSummaryFeedback>> {
  const { data, error } = await admin
    .from('clip_summary_feedback')
    .select('proof_id, rating, reason, corrected_text')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('user_id', input.userId)
    .limit(500);
  if (error) return {};
  const out: Record<string, ClipSummaryFeedback> = {};
  for (const row of (data ?? []) as Array<{
    proof_id: string;
    rating: number;
    reason: ClipFeedbackReason | null;
    corrected_text: string | null;
  }>) {
    out[row.proof_id] = {
      rating: row.rating === 1 ? 1 : -1,
      reason: row.reason ?? null,
      correctedText: row.corrected_text ?? null,
    };
  }
  return out;
}

export interface AiTrainingSetting {
  optedIn: boolean;
  changedAt: string | null;
}

/** Off unless a Global Admin turned it on. No row (or no table yet) reads as off. */
export async function getAiTrainingSetting(admin: Db, orgId: string): Promise<AiTrainingSetting> {
  const { data, error } = await admin
    .from('org_ai_training_settings')
    .select('opted_in, changed_at')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error || !data) return { optedIn: false, changedAt: null };
  return { optedIn: data.opted_in === true, changedAt: data.changed_at ?? null };
}

export async function setAiTrainingSetting(
  admin: Db,
  input: { orgId: string; userId: string; optedIn: boolean },
): Promise<AiTrainingSetting> {
  const changedAt = new Date().toISOString();
  const { error } = await admin.from('org_ai_training_settings').upsert(
    { org_id: input.orgId, opted_in: input.optedIn, changed_by: input.userId, changed_at: changedAt },
    { onConflict: 'org_id' },
  );
  if (error) {
    if (missingTable(error, 'org_ai_training_settings')) {
      throw new HttpError(503, 'This setting is not available yet.', 'ai_training_unavailable');
    }
    throw new HttpError(500, error.message, 'ai_training_failed');
  }
  return { optedIn: input.optedIn, changedAt };
}
