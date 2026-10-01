/**
 * Answers about a chat upload that is not on the job stay in the asking
 * office thread. Grant viewers, share links, and job-wide listings must not
 * receive that prose.
 */

export type AskQuestionAudience = 'org' | 'viewer' | 'share';

/**
 * Office members reloading their own thread keep private rows so follow-ups
 * still see the upload. Every other listing drops them.
 */
export function questionListingKeepsOfficeOnly(
  access: AskQuestionAudience,
  threadId: string | null | undefined,
): boolean {
  return access === 'org' && Boolean(threadId);
}

type EqQuery = {
  eq: (column: string, value: boolean) => EqQuery;
};

export function excludeOfficeOnlyRows<Q extends EqQuery>(
  query: Q,
  access: AskQuestionAudience,
  threadId: string | null | undefined,
): Q {
  if (questionListingKeepsOfficeOnly(access, threadId)) return query;
  return query.eq('office_only', false) as Q;
}

const QUESTION_COLUMNS =
  'id, question, answer, model, grounded_on, web_sources, created_at, thread_id';

/**
 * Last 30 stored Ask turns for a job. Shared, grant, and unthreaded reads
 * omit answers that quote an unattached or unrelated upload.
 */
export async function listSharedProofQuestions(
  supabase: { from: (table: string) => any },
  input: {
    orgId: string;
    jobId: string;
    threadId?: string | null;
    access: AskQuestionAudience;
  },
): Promise<unknown[]> {
  let query = supabase
    .from('job_proof_questions')
    .select(QUESTION_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId);
  if (input.threadId) query = query.eq('thread_id', input.threadId);
  query = excludeOfficeOnlyRows(query, input.access, input.threadId ?? null);
  const { data } = await query.order('created_at', { ascending: false }).limit(30);
  return data ?? [];
}
