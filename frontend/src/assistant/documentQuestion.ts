/**
 * Same rule as backend `isDocumentQuestion`. A job question about totals,
 * rooms, or whether something is related stays on the job Ask path unless it
 * clearly targets a document attached to this job.
 */
export type DocumentAskTarget = {
  id: string;
  filename: string;
  kind?: string | null;
  attached?: boolean | null;
  relevance?: string | null;
  jobId?: string | null;
};

const DOCUMENT_ASK_LIMIT = 8;

export function documentsInJobScope(docs: DocumentAskTarget[], jobId: string | null): DocumentAskTarget[] {
  if (!jobId) return [];
  return docs.filter((doc) => {
    if (doc.attached === false) return false;
    if (doc.jobId !== jobId) return false;
    if (doc.relevance === 'not_related' || doc.relevance === 'pending_confirm') return false;
    return true;
  });
}

export function isDocumentQuestion(question: string, docs: DocumentAskTarget[]): boolean {
  if (/\b(document|pdf|spreadsheet|workbook|uploaded|attachment)\b/i.test(question)) return true;
  if (/\b(?:uploaded|attached)\s+files?\b/i.test(question)) return true;
  const q = question.toLowerCase();
  if (docs.some((doc) => {
    const name = doc.filename.toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const stem = name.slice(0, Math.min(name.length, 18));
    return stem.length > 3 && q.includes(stem);
  })) return true;
  const kinds: Array<[string, RegExp]> = [
    ['estimate', /\bestimate\b/i],
    ['invoice', /\binvoice\b/i],
    ['contract', /\bcontract\b/i],
    ['change_order', /\bchange\s+order\b/i],
    ['floor_plan', /\bfloor\s*plan\b/i],
    ['sketch', /\bsketch\b/i],
    ['permit', /\bpermit\b/i],
    ['scope', /\bscope\b/i],
    ['photo', /\bphoto\b/i],
  ];
  return kinds.some(([kind, re]) => re.test(question) && docs.some((doc) => (
    doc.kind === kind || (kind === 'floor_plan' && doc.kind === 'sketch')
  )));
}

/** Ids for the document Ask route, or null when the job Ask path should run. */
export function documentAskIds(
  question: string,
  docs: DocumentAskTarget[],
  jobId: string | null,
): string[] | null {
  const inScope = documentsInJobScope(docs, jobId);
  if (!inScope.length || !isDocumentQuestion(question, inScope)) return null;
  return inScope.slice(0, DOCUMENT_ASK_LIMIT).map((doc) => doc.id);
}
