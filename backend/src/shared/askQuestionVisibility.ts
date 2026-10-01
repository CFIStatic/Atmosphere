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
  'id, question, answer, model, grounded_on, web_sources, document_ids, created_at, thread_id';

/** Share links and grant viewers must not learn which chat uploads were in play. */
export function omitSessionDocumentIds(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || !('document_ids' in row)) return row;
    const copy = { ...(row as Record<string, unknown>) };
    delete copy.document_ids;
    return copy;
  });
}

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
  const rows = data ?? [];
  if (!questionListingKeepsOfficeOnly(input.access, input.threadId ?? null)) {
    return omitSessionDocumentIds(rows);
  }
  return rows;
}
