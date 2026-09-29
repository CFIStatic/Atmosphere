/**
 * Gold regression set for clip Ask and conversation summaries.
 *
 * The public repo only carries SYNTHETIC gold (backend/eval/synthetic-gold.json).
 * Real, consented clips live outside the repo and are loaded at run time
 * (EVAL_GOLD_PATH or EVAL_GOLD_URL); see backend/eval/README.md.
 */
import type { ClipAskRecord } from '../shared/clipAsk.js';

export type GoldQuestionType =
  | 'transcript_count'
  | 'quote_time'
  | 'temporal_order'
  | 'negative'
  | 'false_premise'
  | 'speaker_source';

export type GoldCategory =
  | 'walkthrough'
  | 'quiet'
  | 'multiple_voices'
  | 'media_playback'
  | 'damage_closeup'
  | 'occlusion'
  | 'no_work'
  | 'synthetic';

export type GoldExpect = {
  /** answer: the evidence answers it; abstain: the right answer is "not shown / not established". */
  answerType: 'answer' | 'abstain';
  /** transcript_count: the number the first sentence must state. */
  count?: number;
  /** Exact transcript quotes (and their times, seconds) the answer must include. */
  quotes?: Array<{ text: string; at?: number | null }>;
  /** temporal_order: phrases that must appear in this order. */
  order?: string[];
  /** Leading yes/no the answer must give. */
  yesNo?: 'yes' | 'no';
  /** Words or phrases the answer must contain (case-insensitive). */
  mustContain?: string[];
  /**
   * Phrases the answer must not contain. `critical` ones (a made-up price, a
   * "work completed" or a commitment claim) fail the release gate.
   */
  mustNotContain?: string[];
  critical?: string[];
  /**
   * Job Ask: each expected quote must also come back as a quote card whose
   * link opens its clip at that second (±1 s), carrying this clip name.
   */
  quoteCards?: boolean;
  clipTitle?: string;
};

export type GoldQuestion = {
  id: string;
  type: GoldQuestionType;
  question: string;
  expect: GoldExpect;
  /** Drafted automatically; a person has not confirmed the expectation yet. */
  needsReview?: boolean;
};

export type GoldClip = {
  id: string;
  categories: GoldCategory[];
  /** Consent record for real clips; synthetic clips carry { status: 'synthetic' }. */
  consent?: { status: 'synthetic' | 'pending' | 'confirmed' | 'declined'; confirmedBy?: string | null; confirmedAt?: string | null };
  /** What Ask sees for the clip (clipRecordFromEvidenceItem output). */
  record: ClipAskRecord;
  questions: GoldQuestion[];
};

/**
 * Job-level Ask gold: the raw job_proofs rows a job Ask loads, plus the
 * questions asked across the whole job. Real rows only in private gold.
 */
export type GoldJob = {
  id: string;
  consent?: GoldClip['consent'];
  timeZone?: string | null;
  fixture: {
    job: { id: string; org_id: string; title: string };
    parties: Array<Record<string, unknown>>;
    proofs: Array<Record<string, unknown>>;
  };
  questions: GoldQuestion[];
};

export type GoldSet = {
  version: 1;
  name: string;
  clips: GoldClip[];
  jobs?: GoldJob[];
};
