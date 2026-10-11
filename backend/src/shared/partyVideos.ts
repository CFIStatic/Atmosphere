import { HttpError } from '../lib/errors.js';

/**
 * An invited subcontractor (a job party) sees only the videos they recorded
 * on that job, never anyone else's. Every row here was already filtered by
 * party_id; ownership is checked again before a clip is opened.
 */

export interface PartyVideo {
  id: string;
  workDate: string;
  phase: string | null;
  capturedAt: string | null;
  durationSeconds: number | null;
  summary: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** List rows for the sub's own videos, newest first, no office-only fields. */
export function partyVideoList(rows: any[], partyId: string): PartyVideo[] {
  return rows
    .filter((row) => row && row.party_id === partyId && !row.deleted_at)
    .map((row) => ({
      id: String(row.id),
      workDate: String(row.work_date ?? ''),
      phase: row.phase ?? null,
      capturedAt: row.captured_at ?? row.received_at ?? row.created_at ?? null,
      durationSeconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
      summary: typeof row.ai_summary === 'string' && row.ai_summary.trim() ? row.ai_summary.trim() : null,
    }));
}

/** A clip opens for the sub only when they recorded it and it was not removed. */
export function assertPartyOwnsVideo(proof: any, party: { id: string; job_id: string }): void {
  if (!proof || proof.deleted_at || proof.party_id !== party.id || proof.job_id !== party.job_id) {
    throw new HttpError(404, 'No such video.', 'not_found');
  }
}
