/**
 * Ask chat threads — many chats per job (project), owned by a user or progress-share.
 * Messages stay in job_proof_questions; this module lists/creates threads and migrates
 * the legacy single flat history into the first chat when a job is opened.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';

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
  const cleaned = question.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New chat';
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69)}…`;
}

function missingAskThreadsTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.code ?? ''}`;
  return /ask_threads|does not exist|schema cache/i.test(blob);
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
  return (data ?? []) as AskThreadRow[];
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
    title: (input.title?.trim() || 'New chat').slice(0, 200),
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
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, 200);
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

export async function touchAskThreadAfterMessage(
  supabase: SupabaseClient,
  input: { threadId: string; question: string; isFirstMessage: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_message_at: now,
    updated_at: now,
  };
  /* Auto-title only while the chat is still the default name — a user rename sticks. */
  if (input.isFirstMessage) {
    const { data: row } = await supabase
      .from('ask_threads')
      .select('title')
      .eq('id', input.threadId)
      .maybeSingle();
    const current = ((row as { title?: string } | null)?.title || '').trim();
    if (!current || current === 'New chat' || current === 'Earlier questions') {
      patch.title = titleFromFirstQuestion(input.question);
    }
  }
  await supabase.from('ask_threads').update(patch).eq('id', input.threadId);
}

export function presentAskThread(row: AskThreadRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}
