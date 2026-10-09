/**
 * Chat extras around stored answers: thumbs up / down, answers pinned to the
 * job file for the whole team, and search across this person's chats on a
 * job. Office members only; every call is scoped to the org and job, and a
 * question id from another job is "not found".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import { ilikeContains } from '../lib/ilikeExact.js';
import { displayMentionText } from './mentions.js';

type Db = { from: (table: string) => any };

export const FEEDBACK_REASONS = ['wrong', 'incomplete', 'not_on_file', 'unclear', 'other'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export interface AnswerFeedback {
  rating: 1 | -1;
  reason: FeedbackReason | null;
}

function missingTable(error: { message?: string; code?: string } | null | undefined, table: string): boolean {
  if (!error) return false;
  return new RegExp(`${table}|does not exist|schema cache`, 'i').test(`${error.message ?? ''} ${error.code ?? ''}`);
}

/** The question exists on this job (and org). Throws 404 otherwise. */
export async function assertQuestionOnJob(db: Db, input: { orgId: string; jobId: string; questionId: string }) {
  const { data } = await db
    .from('job_proof_questions')
    .select('id, thread_id, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('id', input.questionId)
    .maybeSingle();
  if (!data) throw new HttpError(404, 'That answer is not on this job.', 'ask_question_not_found');
  return data as { id: string; thread_id: string | null; created_at: string };
}

/** Rate an answer (1 / -1), or clear the rating with 0. One rating per person per answer. */
export async function rateAnswer(
  db: Db,
  input: { orgId: string; jobId: string; questionId: string; userId: string; rating: 1 | -1 | 0; reason?: FeedbackReason | null; comment?: string | null },
): Promise<AnswerFeedback | null> {
  await assertQuestionOnJob(db, input);
  if (input.rating === 0) {
    const { error } = await db
      .from('ask_answer_feedback')
      .delete()
      .eq('org_id', input.orgId)
      .eq('question_id', input.questionId)
      .eq('user_id', input.userId);
    if (error && !missingTable(error, 'ask_answer_feedback')) throw new HttpError(500, error.message, 'ask_feedback_failed');
    return null;
  }
  const reason = input.rating === -1 ? (input.reason ?? null) : null;
  const comment = input.rating === -1 && input.comment?.trim() ? input.comment.trim().slice(0, 1000) : null;
  const { error } = await db.from('ask_answer_feedback').upsert(
    {
      org_id: input.orgId,
      job_id: input.jobId,
      question_id: input.questionId,
      user_id: input.userId,
      rating: input.rating,
      reason,
      comment,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'question_id,user_id' },
  );
  if (error) {
    if (missingTable(error, 'ask_answer_feedback')) throw new HttpError(503, 'Feedback is not available yet.', 'ask_feedback_unavailable');
    throw new HttpError(500, error.message, 'ask_feedback_failed');
  }
  return { rating: input.rating, reason };
}

/** This person's ratings for some answers on the job, keyed by question id. */
export async function myFeedback(
  db: Db,
  input: { orgId: string; jobId: string; userId: string; questionIds: string[] },
): Promise<Record<string, AnswerFeedback>> {
  const ids = [...new Set(input.questionIds)].slice(0, 100);
  if (!ids.length) return {};
  const { data, error } = await db
    .from('ask_answer_feedback')
    .select('question_id, rating, reason')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('user_id', input.userId)
    .in('question_id', ids);
  if (error) return {};
  const out: Record<string, AnswerFeedback> = {};
  for (const row of (data ?? []) as Array<{ question_id: string; rating: number; reason: FeedbackReason | null }>) {
    out[row.question_id] = { rating: row.rating === 1 ? 1 : -1, reason: row.reason ?? null };
  }
  return out;
}

export interface PinnedAnswer {
  id: string;
  questionId: string;
  question: string;
  answer: string;
  askedAt: string;
  pinnedAt: string;
  pinnedBy: string | null;
}

/** Pin an answer to the job file (idempotent). */
export async function pinAnswer(db: Db, input: { orgId: string; jobId: string; questionId: string; userId: string }): Promise<void> {
  await assertQuestionOnJob(db, input);
  const { error } = await db
    .from('ask_pinned_answers')
    .upsert(
      { org_id: input.orgId, job_id: input.jobId, question_id: input.questionId, pinned_by: input.userId },
      { onConflict: 'question_id', ignoreDuplicates: true },
    );
  if (error) {
    if (missingTable(error, 'ask_pinned_answers')) throw new HttpError(503, 'Pinning is not available yet.', 'ask_pins_unavailable');
    throw new HttpError(500, error.message, 'ask_pin_failed');
  }
}

export async function unpinAnswer(db: Db, input: { orgId: string; jobId: string; questionId: string }): Promise<void> {
  const { error } = await db
    .from('ask_pinned_answers')
    .delete()
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('question_id', input.questionId);
  if (error && !missingTable(error, 'ask_pinned_answers')) throw new HttpError(500, error.message, 'ask_unpin_failed');
}

/** Answers pinned on this job, newest pin first, with the question and answer text. */
export async function listPinnedAnswers(db: Db, input: { orgId: string; jobId: string }): Promise<PinnedAnswer[]> {
  const { data: pins, error } = await db
    .from('ask_pinned_answers')
    .select('id, question_id, pinned_by, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !pins?.length) return [];
  const rows = pins as Array<{ id: string; question_id: string; pinned_by: string | null; created_at: string }>;
  const [{ data: questions }, { data: people }] = await Promise.all([
    db
      .from('job_proof_questions')
      .select('id, question, answer, created_at')
      .eq('org_id', input.orgId)
      .eq('job_id', input.jobId)
      .in('id', rows.map((r) => r.question_id)),
    db
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [...new Set(rows.map((r) => r.pinned_by).filter(Boolean))] as string[]),
  ]);
  const byId = new Map(((questions ?? []) as Array<{ id: string; question: string; answer: string | null; created_at: string }>).map((q) => [q.id, q]));
  const nameOf = new Map(
    ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name || p.email || null]),
  );
  return rows.flatMap((pin) => {
    const q = byId.get(pin.question_id);
    if (!q?.answer) return [];
    return [
      {
        id: pin.id,
        questionId: q.id,
        question: displayMentionText(q.question),
        answer: q.answer,
        askedAt: q.created_at,
        pinnedAt: pin.created_at,
        pinnedBy: pin.pinned_by ? (nameOf.get(pin.pinned_by) ?? null) : null,
      },
    ];
  });
}

export interface AskSearchHit {
  threadId: string;
  threadTitle: string;
  /** The matching question, or null when only the chat's title matched. */
  questionId: string | null;
  snippet: string;
  at: string;
}

/** Strip machine trailers and markdown so a snippet reads as plain text. */
export function plainAskText(text: string): string {
  return displayMentionText(String(text ?? ''))
    .replace(/⟦[^⟧]*⟧/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Up to ~140 characters of plain text around the first match. */
export function snippetAround(text: string, query: string): string {
  const plain = plainAskText(text);
  const i = plain.toLowerCase().indexOf(query.toLowerCase().trim());
  if (i < 0) return plain.slice(0, 140);
  const start = Math.max(0, i - 50);
  const end = Math.min(plain.length, i + query.length + 90);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/** Search this person's own chats on the job: titles, questions and answers. */
export async function searchAskHistory(
  db: Db,
  input: { orgId: string; jobId: string; userId: string; query: string },
): Promise<AskSearchHit[]> {
  const pattern = ilikeContains(input.query);
  if (!pattern || input.query.trim().length < 2) return [];
  const { data: threads, error } = await db
    .from('ask_threads')
    .select('id, title, last_message_at, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('owner_user_id', input.userId)
    .is('share_id', null)
    .limit(200);
  if (error || !threads?.length) return [];
  const own = threads as Array<{ id: string; title: string; last_message_at: string | null; created_at: string }>;
  const titleOf = new Map(own.map((t) => [t.id, displayMentionText(t.title) || 'Chat']));
  const { data: matches } = await db
    .from('job_proof_questions')
    .select('id, thread_id, question, answer, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .in('thread_id', own.map((t) => t.id))
    .or(`question.ilike.${pattern},answer.ilike.${pattern}`)
    .order('created_at', { ascending: false })
    .limit(30);
  const q = input.query.trim();
  const hits: AskSearchHit[] = [];
  const seenThreads = new Set<string>();
  for (const row of (matches ?? []) as Array<{ id: string; thread_id: string; question: string; answer: string | null; created_at: string }>) {
    const inQuestion = plainAskText(row.question).toLowerCase().includes(q.toLowerCase());
    hits.push({
      threadId: row.thread_id,
      threadTitle: titleOf.get(row.thread_id) ?? 'Chat',
      questionId: row.id,
      snippet: snippetAround(inQuestion ? row.question : (row.answer ?? ''), q),
      at: row.created_at,
    });
    seenThreads.add(row.thread_id);
  }
  for (const t of own) {
    if (seenThreads.has(t.id) || !(titleOf.get(t.id) ?? '').toLowerCase().includes(q.toLowerCase())) continue;
    hits.push({ threadId: t.id, threadTitle: titleOf.get(t.id) ?? 'Chat', questionId: null, snippet: '', at: t.last_message_at ?? t.created_at });
  }
  return hits.slice(0, 20);
}
