/**
 * Ask chat threads — many chats per job (project), owned by a user or progress-share.
 * Messages stay in job_proof_questions; this module lists/creates threads and migrates
 * the legacy single flat history into the first chat when a job is opened.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import { completeAskText } from '../lib/askModel.js';
import type { DurableJobNote } from './askMemory.js';
import { displayMentionText } from './mentions.js';

export type AskThreadOwner =
  | { kind: 'user'; userId: string }
  | { kind: 'share'; shareId: string };

export type AskThreadRow = {
  id: string;
  org_id: string;
  job_id: string;
  owner_user_id: string | null;
  share_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export function titleFromFirstQuestion(question: string): string {
  const cleaned = displayMentionText(question).replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New chat';
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69)}…`;
}

/** A stored title still has the raw chip or an id fragment. */
export function askThreadTitleIsRaw(title: string): boolean {
  return /@\[|mention:/i.test(String(title ?? ''));
}

const TITLE_WORDS = /^(?:(\S+)\s+){1,5}\S+$/;

/**
 * A model title is 2 to 6 words, with no ids and no mention markup.
 * The prompt asks for 3 to 6; two words still beat a raw question.
 */
export function acceptModelAskTitle(raw: string): string | null {
  const cleaned = displayMentionText(raw)
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (/mention:|@\[/i.test(cleaned)) return null;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(cleaned)) return null;
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6);
  if (words.length < 2) return null;
  const title = words.join(' ');
  return TITLE_WORDS.test(title) ? title : null;
}

type AskTitleComplete = (input: {
  system: string;
  user: string;
  maxTokens?: number;
  mode?: 'interactive';
  signal?: AbortSignal;
}) => Promise<{ text: string } | null>;

/** Short title from the first exchange. Null keeps the cleaned question. */
export async function modelAskThreadTitle(input: {
  question: string;
  answer?: string | null;
  complete?: AskTitleComplete;
}): Promise<string | null> {
  const question = displayMentionText(input.question).replace(/\s+/g, ' ').trim().slice(0, 500);
  const answer = displayMentionText(input.answer ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!question) return null;
  const complete = input.complete ?? ((req) => completeAskText(req));
  try {
    const result = await complete({
      system:
        'Name this chat in 3 to 6 words. Use the person\'s name, never an id. No quotes, no mention markup, no trailing punctuation.',
      user: `Question: ${question}\nAnswer: ${answer || '(none yet)'}`,
      maxTokens: 24,
      mode: 'interactive',
      signal: AbortSignal.timeout(4000),
    });
    return acceptModelAskTitle(result?.text ?? '');
  } catch {
    return null;
  }
}

function missingAskThreadsTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.code ?? ''}`;
  return /ask_threads|does not exist|schema cache/i.test(blob);
}

function missingMemorySchema(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.code ?? ''}`;
  return /ask_job_notes|rolling_summary|summary_through|does not exist|schema cache/i.test(blob);
}

function noteKey(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ownerFilter(query: any, owner: AskThreadOwner) {
  if (owner.kind === 'user') return query.eq('owner_user_id', owner.userId).is('share_id', null);
  return query.eq('share_id', owner.shareId).is('owner_user_id', null);
}

export async function listAskThreads(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; owner: AskThreadOwner },
): Promise<AskThreadRow[]> {
  let q = supabase
    .from('ask_threads')
    .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId);
  q = ownerFilter(q, input.owner);
  const { data, error } = await q
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (missingAskThreadsTable(error)) return [];
    throw new HttpError(500, error.message, 'ask_threads_list_failed');
  }
  return backfillRawAskTitles(supabase, (data ?? []) as AskThreadRow[]);
}

/**
 * Rewrite ask_threads.title when it still contains a mention token.
 * Does not update job_proof_questions or any custody table.
 */
async function backfillRawAskTitles(
  supabase: SupabaseClient,
  rows: AskThreadRow[],
): Promise<AskThreadRow[]> {
  const cleaned = rows.map((row) =>
    askThreadTitleIsRaw(row.title) ? { ...row, title: titleFromFirstQuestion(row.title) } : row,
  );
  await Promise.all(
    rows.filter((row) => askThreadTitleIsRaw(row.title)).map(async (row) => {
      const title = titleFromFirstQuestion(row.title);
      if (!title || title === row.title) return;
      try {
        await supabase.from('ask_threads').update({ title }).eq('id', row.id);
      } catch {
        // The list response is already cleaned for display.
      }
    }),
  );
  return cleaned;
}

export async function createAskThread(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    jobId: string;
    owner: AskThreadOwner;
    title?: string;
  },
): Promise<AskThreadRow> {
  const row = {
    org_id: input.orgId,
    job_id: input.jobId,
    owner_user_id: input.owner.kind === 'user' ? input.owner.userId : null,
    share_id: input.owner.kind === 'share' ? input.owner.shareId : null,
    title: (displayMentionText(input.title ?? '').replace(/\s+/g, ' ').trim() || 'New chat').slice(0, 200),
  };
  const { data, error } = await supabase
    .from('ask_threads')
    .insert(row)
    .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
    .single();
  if (error) {
    if (missingAskThreadsTable(error)) {
      throw new HttpError(503, 'Ask history is not available yet.', 'ask_threads_unavailable');
    }
    throw new HttpError(500, error.message, 'ask_threads_create_failed');
  }
  return data as AskThreadRow;
}

/**
 * When the user has no threads yet, create one and attach legacy flat Q&A
 * (asked by them, or unowned rows on this job) so the old single thread becomes chat #1.
 */
export async function ensureAskThreads(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; owner: AskThreadOwner },
): Promise<AskThreadRow[]> {
  const existing = await listAskThreads(supabase, input);
  if (existing.length) return existing;

  const thread = await createAskThread(supabase, {
    orgId: input.orgId,
    jobId: input.jobId,
    owner: input.owner,
    title: 'Earlier questions',
  });

  // Backfill legacy questions into the first thread.
  let orphanQuery = supabase
    .from('job_proof_questions')
    .select('id, question, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .is('thread_id', null)
    .order('created_at', { ascending: true })
    .limit(100);

  if (input.owner.kind === 'user') {
    // Own questions, plus unowned legacy rows (asked_by null) so the flat history migrates.
    orphanQuery = orphanQuery.or(`asked_by.eq.${input.owner.userId},asked_by.is.null`);
  }
  // Share guests: only attach null asked_by rows that have never been claimed by a user thread.
  // (Share-scoped ask will set thread_id going forward; legacy guest rows are asked_by null.)

  const { data: orphans, error: orphanError } = await orphanQuery;
  if (orphanError && !missingAskThreadsTable(orphanError)) {
    // Non-fatal — still return the empty new thread.
    return [thread];
  }

  const rows = (orphans ?? []) as Array<{ id: string; question: string; created_at: string }>;
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await supabase.from('job_proof_questions').update({ thread_id: thread.id }).in('id', ids);
    const firstQ = rows[0]?.question;
    const title = firstQ ? titleFromFirstQuestion(firstQ) : 'Earlier questions';
    const lastAt = rows[rows.length - 1]?.created_at ?? null;
    const { data: updated } = await supabase
      .from('ask_threads')
      .update({
        title,
        last_message_at: lastAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', thread.id)
      .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
      .single();
    return [updated ?? { ...thread, title, last_message_at: lastAt }];
  }

  // No legacy messages — keep a blank "New chat" instead of "Earlier questions".
  const { data: blank } = await supabase
    .from('ask_threads')
    .update({ title: 'New chat', updated_at: new Date().toISOString() })
    .eq('id', thread.id)
    .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
    .single();
  return [blank ?? { ...thread, title: 'New chat' }];
}

export async function getAskThreadForOwner(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; threadId: string; owner: AskThreadOwner },
): Promise<AskThreadRow> {
  let q = supabase
    .from('ask_threads')
    .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
    .eq('id', input.threadId)
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId);
  q = ownerFilter(q, input.owner);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (missingAskThreadsTable(error)) {
      throw new HttpError(503, 'Ask history is not available yet.', 'ask_threads_unavailable');
    }
    throw new HttpError(500, error.message, 'ask_threads_lookup_failed');
  }
  if (!data) throw new HttpError(404, 'Chat not found.', 'ask_thread_not_found');
  return data as AskThreadRow;
}


export async function renameAskThread(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; threadId: string; owner: AskThreadOwner; title: string },
): Promise<AskThreadRow> {
  const title = displayMentionText(input.title).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) throw new HttpError(400, 'Chat name cannot be empty.', 'ask_thread_title_empty');

  // Ownership check first.
  await getAskThreadForOwner(supabase, {
    orgId: input.orgId,
    jobId: input.jobId,
    threadId: input.threadId,
    owner: input.owner,
  });

  const { data, error } = await supabase
    .from('ask_threads')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', input.threadId)
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .select('id, org_id, job_id, owner_user_id, share_id, title, created_at, updated_at, last_message_at')
    .single();
  if (error) {
    if (missingAskThreadsTable(error)) {
      throw new HttpError(503, 'Ask history is not available yet.', 'ask_threads_unavailable');
    }
    throw new HttpError(500, error.message, 'ask_threads_rename_failed');
  }
  return data as AskThreadRow;
}

function scopeOwnedThread(
  query: any,
  input: { threadId: string; orgId?: string; jobId?: string; owner?: AskThreadOwner },
) {
  let q = query.eq('id', input.threadId);
  if (input.orgId) q = q.eq('org_id', input.orgId);
  if (input.jobId) q = q.eq('job_id', input.jobId);
  if (input.owner) q = ownerFilter(q, input.owner);
  return q;
}

export async function touchAskThreadAfterMessage(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    orgId?: string;
    jobId?: string;
    owner?: AskThreadOwner;
    question: string;
    answer?: string | null;
    isFirstMessage: boolean;
    complete?: AskTitleComplete;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_message_at: now,
    updated_at: now,
  };
  /* Auto-title only while the chat is still the default name — a user rename sticks. */
  let wroteAuto = false;
  if (input.isFirstMessage) {
    const { data: row } = await scopeOwnedThread(
      supabase.from('ask_threads').select('title'),
      input,
    ).maybeSingle();
    const current = ((row as { title?: string } | null)?.title || '').trim();
    if (!current || current === 'New chat' || current === 'Earlier questions' || askThreadTitleIsRaw(current)) {
      patch.title = titleFromFirstQuestion(input.question);
      wroteAuto = true;
    }
  }
  await scopeOwnedThread(supabase.from('ask_threads').update(patch), input);
  if (!wroteAuto || typeof patch.title !== 'string') return;
  const refined = await modelAskThreadTitle({
    question: input.question,
    answer: input.answer,
    complete: input.complete,
  });
  if (!refined || refined === patch.title) return;
  const { data: again } = await scopeOwnedThread(
    supabase.from('ask_threads').select('title'),
    input,
  ).maybeSingle();
  const nowTitle = ((again as { title?: string } | null)?.title || '').trim();
  if (nowTitle !== patch.title) return;
  await scopeOwnedThread(
    supabase.from('ask_threads').update({ title: refined, updated_at: new Date().toISOString() }),
    input,
  );
}

export type AskThreadMemoryState = {
  summary: string | null;
  throughId: string | null;
};

/** Rolling summary stored on the thread. Missing columns mean the migration is not applied yet. */
export async function loadAskThreadMemory(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; threadId: string; owner: AskThreadOwner },
): Promise<AskThreadMemoryState> {
  const { data, error } = await scopeOwnedThread(
    supabase.from('ask_threads').select('rolling_summary, summary_through_question_id'),
    input,
  ).maybeSingle();
  if (error || !data) return { summary: null, throughId: null };
  const row = data as { rolling_summary?: string | null; summary_through_question_id?: string | null };
  return {
    summary: row.rolling_summary ?? null,
    throughId: row.summary_through_question_id ?? null,
  };
}

/** Notes for this job and owner, including notes from older threads on the same job. */
export async function loadAskJobNotes(
  supabase: SupabaseClient,
  input: { orgId: string; jobId: string; owner: AskThreadOwner },
): Promise<DurableJobNote[]> {
  let q = supabase
    .from('ask_job_notes')
    .select('note, source_question_id, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId);
  q = input.owner.kind === 'user' ? q.eq('owner_user_id', input.owner.userId) : q.eq('share_id', input.owner.shareId);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(24);
  if (error || !data) return [];
  return (data as Array<{ note?: string; source_question_id?: string | null; created_at?: string | null }>).flatMap(
    (row) => {
      const note = (row.note ?? '').trim();
      if (!note) return [];
      return [
        {
          note,
          sourceQuestionId: row.source_question_id ?? null,
          at: row.created_at ?? null,
        },
      ];
    },
  );
}

/**
 * Save a regenerated summary and any new notes. Updates ask_threads metadata
 * and inserts notes. Does not update job_proof_questions.
 */
export async function persistAskThreadMemory(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    jobId: string;
    threadId: string;
    owner: AskThreadOwner;
    summary: string;
    summaryThroughId: string | null;
    coveredCount: number;
    previousSummary: string | null;
    previousThroughId: string | null;
    notes: DurableJobNote[];
    existingNotes: DurableJobNote[];
  },
): Promise<void> {
  try {
    const next = input.summary.trim();
    const prev = (input.previousSummary ?? '').trim();
    const throughChanged = (input.summaryThroughId ?? null) !== (input.previousThroughId ?? null);
    if (next && (next !== prev || throughChanged)) {
      const { error } = await scopeOwnedThread(
        supabase.from('ask_threads').update({
          rolling_summary: next,
          summary_through_question_id: input.summaryThroughId,
          summary_turn_count: input.coveredCount,
          summarized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        input,
      );
      if (error && !missingMemorySchema(error)) return;
    }
    const have = new Set(input.existingNotes.map((note) => noteKey(note.note)));
    for (const note of input.notes) {
      const key = noteKey(note.note);
      if (!key || have.has(key)) continue;
      have.add(key);
      const { error } = await supabase.from('ask_job_notes').insert({
        org_id: input.orgId,
        job_id: input.jobId,
        thread_id: input.threadId,
        owner_user_id: input.owner.kind === 'user' ? input.owner.userId : null,
        share_id: input.owner.kind === 'share' ? input.owner.shareId : null,
        note: note.note.slice(0, 400),
        source_question_id: note.sourceQuestionId,
        ...(note.at ? { created_at: note.at } : {}),
      });
      if (error && error.code !== '23505' && !missingMemorySchema(error)) return;
    }
  } catch {
    // Memory is an aid. The custody row is already stored.
  }
}

export function presentAskThread(row: AskThreadRow) {
  return {
    id: row.id,
    title: displayMentionText(row.title).replace(/\s+/g, ' ').trim() || 'Chat',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}
