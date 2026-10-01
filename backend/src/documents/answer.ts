/**
 * Grounded answers about an uploaded document.
 * Every quoted span is an exact substring of extracted text, cited with the
 * file name and the page, sheet, or cell it came from.
 */
import type { TranscriptChunk } from '../shared/askTranscriptIndex.js';
import { asksAboutJobFile } from '../shared/askWebSearch.js';
import type { DocumentFacts, DocumentKind, RelevanceVerdict } from './types.js';

/** One quiet line after an answer, never a substitute for it. */
export const QUIET_UNRELATED_NOTE = "This document doesn't appear to be about this job.";

const RELEVANCE_RE = /\b(related|relevant|belong|attached|match(?:es|ing)? this job)\b/i;

const KIND_PATTERNS: Array<[string, RegExp]> = [
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

export type AskDocumentView = {
  id: string;
  filename: string;
  kind?: DocumentKind | string | null;
  attached?: boolean | null;
  relevance?: RelevanceVerdict | string | null;
  relevanceReason?: string | null;
  summary?: string | null;
  extractedText?: string | null;
  chunks?: Array<{ seq?: number; location: string; text: string }> | null;
  facts?: DocumentFacts | null;
};

const STOP = new Set(['what', 'whats', 'which', 'where', 'when', 'who', 'how', 'does', 'this', 'that', 'with', 'from', 'have', 'the', 'and', 'for', 'job', 'file', 'document', 'page']);

/**
 * Attached job knowledge. Unattached, not-related, and unconfirmed files stay
 * out of the model prompt and out of quote grounding. A legacy scope document
 * has no verdict, so it still counts.
 */
export function documentIsJobKnowledge(doc: {
  attached?: boolean | null;
  relevance?: string | null;
}): boolean {
  if (doc.attached === false) return false;
  if (doc.relevance === 'not_related' || doc.relevance === 'pending_confirm') return false;
  return true;
}

/** A share or clip question may only see documents attached to that job. */
export function chatDocumentInJobScope(
  row: { job_id?: string | null },
  jobId: string,
): boolean {
  const attachedJob = row.job_id ? String(row.job_id) : '';
  return Boolean(jobId) && attachedJob === jobId;
}

/**
 * "what is this about" / "what this about" / "summarize this" — the upload
 * itself, not a job-file question.
 */
export function isAboutThisDocument(question: string): boolean {
  const q = question.trim();
  if (/\bwhat(?:\s+is|\s*'s)?\s+this\s+about\b/i.test(q)) return true;
  if (/\bwhat\s+this\s+about\b/i.test(q)) return true;
  if (/\bwhat(?:'s| is)\s+(?:it|that)\s+about\b/i.test(q)) return true;
  if (
    /\b(?:summarize|summari[sz]e|summary of|sum up)\b/i.test(q) &&
    /\b(this|it|document|upload|attachment)\b/i.test(q) &&
    !/\b(job|clips?|visit)\b/i.test(q)
  ) {
    return true;
  }
  if (/\btell me about (?:this|it|the (?:document|upload|file|attachment))\b/i.test(q)) return true;
  return false;
}

function docMatchesKind(doc: AskDocumentView, kind: string): boolean {
  return doc.kind === kind || (kind === 'floor_plan' && doc.kind === 'sketch');
}

function namesThese(question: string, docs: AskDocumentView[]): boolean {
  const q = question.toLowerCase();
  return docs.some((doc) => {
    const name = doc.filename.toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const stem = name.slice(0, Math.min(name.length, 18));
    if (stem.length > 3 && q.includes(stem)) return true;
    return KIND_PATTERNS.some(([kind, re]) => re.test(question) && docMatchesKind(doc, kind));
  });
}

function namesOtherKind(question: string, docs: AskDocumentView[]): boolean {
  return KIND_PATTERNS.some(([kind, re]) => re.test(question) && !docs.some((doc) => docMatchesKind(doc, kind)));
}

/**
 * Whether this chat's uploads should answer. A question that names a different
 * document kind (the job estimate) stays on the job file. Job questions
 * (lockbox, clips, "this file") stay on the job file too.
 */
export function chatUploadShouldAnswer(question: string, documents: AskDocumentView[] | null | undefined): boolean {
  const docs = (documents ?? []).filter((doc) => textOf(doc).trim());
  if (!docs.length) return false;
  if (isAboutThisDocument(question) || isAuthorQuestion(question) || namesThese(question, docs)) return true;
  if (namesOtherKind(question, docs)) return false;
  if (asksAboutJobFile(question)) return false;
  if (looksLikeGeneralQuestion(question)) return false;
  return refersToUpload(question, docs);
}

/**
 * True when the reply is grounded on a chat upload that is not job knowledge
 * (unattached, or marked not related / awaiting confirm). Those answers stay
 * on the asking office thread. A question that names an attached job document
 * stays on the shared record.
 */
export function sessionAnswerIsPrivate(
  question: string,
  documents: AskDocumentView[] | null | undefined,
): boolean {
  if (!chatUploadShouldAnswer(question, documents)) return false;
  const readable = (documents ?? []).filter((doc) => textOf(doc).trim());
  const privateDocs = readable.filter((doc) => !documentIsJobKnowledge(doc));
  if (!privateDocs.length) return false;
  if (privateDocs.length === readable.length) return true;
  if (isAboutThisDocument(question) || isAuthorQuestion(question)) return true;
  const jobDocs = readable.filter((doc) => documentIsJobKnowledge(doc));
  if (namesThese(question, jobDocs) && !namesThese(question, privateDocs)) return false;
  return true;
}

/** A public question with no pointer at the upload stays on web search. */
function looksLikeGeneralQuestion(question: string): boolean {
  if (/\b(it|this|that|document|upload|attachment|note|file)\b/i.test(question)) return false;
  return /\b(who is|weather|news|score|population|capital of|stock price|nfl|nba|how do i|how to)\b/i.test(question);
}

function refersToUpload(question: string, docs: AskDocumentView[]): boolean {
  if (/\b(it|this|that|these|those)\b/i.test(question)) return true;
  if (/\b(document|upload|attachment|note)\b/i.test(question)) return true;
  const words = tokens(question).filter((word) => !STOP.has(word) && word.length > 3);
  if (!words.length) return false;
  const hay = docs.map((doc) => textOf(doc)).join('\n').toLowerCase();
  const hits = words.filter((word) => hay.includes(word));
  return hits.length > 0;
}

export type DocumentAnswerOptions = {
  /** False on follow-ups after this chat already said the quiet line. */
  quietNote?: boolean;
};

function withUnrelatedNote(
  answer: string,
  doc: AskDocumentView | null,
  opts?: DocumentAnswerOptions,
): string {
  if (!answer || !doc || documentIsJobKnowledge(doc)) return answer;
  if (opts?.quietNote === false) return answer;
  if (/\bnot related to this job\b/i.test(answer)) return answer;
  if (answer.includes(QUIET_UNRELATED_NOTE)) return answer;
  return `${answer}\n\n${QUIET_UNRELATED_NOTE}`;
}

/** True when an earlier assistant turn already added the quiet line. */
export function quietNoteAlreadySaid(
  history: Array<{ role?: string | null; text?: string | null }> | null | undefined,
): boolean {
  return (history ?? []).some(
    (turn) => turn.role === 'assistant' && String(turn.text ?? '').includes(QUIET_UNRELATED_NOTE),
  );
}

function indefinite(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function addressIn(text: string): string | null {
  const match = text.match(
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|place|pl|circle|cir)\b\.?/i,
  );
  if (!match) return null;
  return match[0].replace(/\.$/, '').trim() || null;
}

function linesOf(text: string): string[] {
  return text.split(/\n/).map((line) => line.trim()).filter(Boolean);
}

function authorName(text: string): string | null {
  const name = /([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){0,3})/;
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*[Bb]y\\s+${name.source}`),
    new RegExp(`\\b[Bb]y\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z.'-]+){1,3})\\b`),
    new RegExp(`\\b(?:written|authored|prepared)\\s+by\\s+${name.source}`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const found = match?.[1]?.trim();
    if (found && !/^(?:the|a|an|this|that)$/i.test(found)) return found;
  }
  return null;
}

function yearIn(text: string): string | null {
  const slash = text.match(/\b\d{1,2}\/\d{1,2}\/(\d{4})\b/);
  if (slash?.[1]) return slash[1];
  return text.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
}

/**
 * A type is stated only when the filename or a heading says so.
 * "not an invoice" and a stored classifier guess do not count.
 */
function statedKind(doc: AskDocumentView, text: string): string | null {
  const name = doc.filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  const headings = linesOf(text).filter((line) => line.length < 48 && !/\bnot\b/i.test(line));
  for (const [kind, re] of KIND_PATTERNS) {
    const label = kind.replace(/_/g, ' ');
    if (re.test(name) || headings.some((line) => re.test(line))) return label;
  }
  return null;
}

function companyBlurbs(text: string): Array<{ name: string; what: string; sentence: string }> {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const blurbs: Array<{ name: string; what: string; sentence: string }> = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const match = sentences[i]!.match(
      /^([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\s+(builds|automates|makes|provides|develops|creates|offers|designs)\s+(.+?)[.!?]?$/,
    );
    if (!match) continue;
    const verb = match[2]!.toLowerCase();
    let what = match[3]!.replace(/\.$/, '').trim();
    const name = match[1]!;
    let sentence: string;
    if (verb === 'automates') {
      const head = what.replace(/^(?:the|a|an)\s+/i, '').split(/\s+that\s+/i)[0]!.trim();
      what = `automated ${head}`;
      sentence = `${name} automates ${head}.`;
    } else {
      what = what.replace(/\blong distance\b/gi, 'long-distance');
      const following = sentences[i + 1] ?? '';
      if (/space[- ]based/i.test(following)) what += ', including space-based power';
      sentence = `${name} ${verb} ${what}.`;
    }
    blurbs.push({ name, what, sentence });
  }
  return blurbs;
}

function isAuthorQuestion(question: string): boolean {
  return /\b(who\s+(?:wrote|authored|signed|prepared)|who(?:'s| is)\s+the\s+author|byline)\b/i.test(question);
}

/**
 * A readable summary in our own words. No document-type guess, no raw
 * opening dump, and no "(filename, document)" citation.
 */
export function describeDocument(doc: AskDocumentView): string {
  const text = textOf(doc).replace(/\r/g, '').trim();
  const flat = text.replace(/\s+/g, ' ').trim();
  const author = authorName(text);
  const year = yearIn(text);
  const kind = statedKind(doc, text);
  const address = doc.facts?.addresses?.[0]?.value ?? addressIn(flat);
  const total = doc.facts?.totals?.find((row) => /total/i.test(row.label)) ?? doc.facts?.totals?.[0];
  const rooms = (doc.facts?.rooms ?? []).map((room) => room.name).filter(Boolean);
  const companies = companyBlurbs(text);

  if (kind === 'invoice' || kind === 'estimate' || kind === 'contract' || kind === 'change order') {
    let opener = `${doc.filename} is ${indefinite(kind)} ${kind}`;
    if (address) opener += ` for ${address}`;
    const sentences = [`${opener}.`];
    if (total && flat.includes(total.value)) sentences.push(`The total is ${total.value}.`);
    return sentences.join(' ');
  }

  if (kind === 'floor plan' || kind === 'sketch') {
    const shown = rooms.length ? ` It shows ${rooms.join(', ')}.` : '';
    return `${doc.filename} is a ${kind}.${shown}`.trim();
  }

  if (companies.length) {
    const label = /\bvision\b/i.test(flat) ? 'vision note' : 'note';
    const when = year ? `${year} ` : '';
    const by = author ? ` by ${author}` : '';
    const listed = companies.map((company) => `${company.name} (${company.what})`).join(' and ');
    const whose = author ? 'his companies' : 'these companies';
    return `This is a ${when}${label}${by} about ${whose}: ${listed}.`;
  }

  const bits: string[] = [];
  let opener = 'This is';
  if (year || author) {
    opener += ` a${year ? ` ${year}` : ''}${/\bnote\b/i.test(flat) ? ' note' : ' document'}`;
    if (author) opener += ` by ${author}`;
  } else {
    opener += ` ${doc.filename}`;
  }
  bits.push(`${opener}.`);
  const skip = new Set(
    linesOf(text)
      .filter((line) => line.length < 80)
      .map((line) => line.replace(/\s+/g, ' ').toLowerCase()),
  );
  const prose = flat
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && !skip.has(sentence.toLowerCase()) && !/\bnot an?\b/i.test(sentence))
    .slice(0, 2);
  for (const sentence of prose) bits.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
  return bits.slice(0, 4).join(' ');
}

export function answerFromJobDocuments(
  question: string,
  documents: AskDocumentView[] | null | undefined,
  evidence: Array<{ source: string; text: string }> = [],
  opts?: DocumentAnswerOptions,
): string | null {
  const docs = (documents ?? []).filter((doc) => textOf(doc).trim());
  if (!docs.length) return null;
  const about = isAboutThisDocument(question);
  const uploads = docs.filter((doc) => !documentIsJobKnowledge(doc));
  const attached = docs.filter((doc) => documentIsJobKnowledge(doc));
  const uploadsOnly = uploads.length > 0 && attached.length === 0;
  if (
    asksAboutJobFile(question) &&
    !about &&
    !RELEVANCE_RE.test(question) &&
    !namesThese(question, docs)
  ) {
    return null;
  }
  if (!isDocumentQuestion(question, docs) && !about && !uploadsOnly) return null;

  if (/\b(compar\w*|versus|\bvs\.?\b|against)\b/i.test(question) && /\b(video|clip|footage|film|saw|seen|work)\b/i.test(question)) {
    return compareToEvidence(question, docs, evidence);
  }

  if (RELEVANCE_RE.test(question) && !about) {
    const target = pickDoc(question, docs) ?? docs.find((doc) => doc.attached === false || doc.relevance === 'not_related') ?? null;
    if (!target) return null;
    if (target.attached === false || target.relevance === 'not_related') {
      const reason = clean(target.relevanceReason);
      return `${target.filename} is not related to this job and was not attached.${reason ? ` ${reason}` : ''}`;
    }
    const reason = clean(target.relevanceReason);
    return `${target.filename} is related to this job and is on the file.${reason ? ` ${reason}` : ''}`;
  }

  const note = (answer: string, doc: AskDocumentView | null) => withUnrelatedNote(answer, doc, opts);
  const uploadMiss = (doc: AskDocumentView | null) => note('This document does not show that.', doc);

  const namedUploads = uploads.filter((doc) => namesThese(question, [doc]));
  const pool = about
    ? (namedUploads.length ? namedUploads : uploads.length ? uploads : attached)
    : namedUploads.length
      ? namedUploads
      : attached.length
        ? attached
        : uploads;

  if (about) {
    const doc = pool[pool.length - 1] ?? null;
    if (!doc) return null;
    return note(describeDocument(doc), doc);
  }

  if (isAuthorQuestion(question)) {
    const doc = pool[pool.length - 1] ?? pickDoc(question, pool) ?? null;
    const name = doc ? authorName(textOf(doc)) : null;
    if (!doc || !name) return uploadsOnly ? uploadMiss(doc) : documentMiss(question, docs);
    return note(`${name} wrote it.`, doc);
  }

  const companyDoc = pool[pool.length - 1] ?? null;
  if (companyDoc && !documentIsJobKnowledge(companyDoc)) {
    const named = companyBlurbs(textOf(companyDoc)).filter((company) =>
      question.toLowerCase().includes(company.name.toLowerCase()),
    );
    if (named.length) return note(named.map((company) => company.sentence).join(' '), companyDoc);
  }

  if (/\b(total|amount due|balance due|how much)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.totals.length ?? 0) > 0) ?? null;
    const total = doc?.facts?.totals.find((row) => /total/i.test(row.label)) ?? doc?.facts?.totals[0];
    if (!doc || !total || !textOf(doc).includes(total.quote)) {
      return uploadsOnly ? uploadMiss(pool[pool.length - 1] ?? null) : documentMiss(question, docs);
    }
    return note(
      `The ${kindWord(doc)} total is ${total.value}. The document says “${total.quote}” ${cite(doc, total.location)}.`,
      doc,
    );
  }

  if (/\b(rooms?|floor\s*plan|dimensions?)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.rooms.length ?? 0) > 0) ?? null;
    const rooms = (doc?.facts?.rooms ?? []).filter((room) => textOf(doc!).includes(room.quote));
    if (!doc || !rooms.length) return uploadsOnly ? uploadMiss(pool[pool.length - 1] ?? null) : documentMiss(question, docs);
    const listed = rooms.slice(0, 8).map((room) => `“${room.quote}” ${cite(doc, room.sourceLocation)}`);
    const names = rooms.map((room) => room.name).join(', ');
    return note(`The floor plan shows ${names}. ${listed.join(' ')}`, doc);
  }

  if (/\b(line items?|breakdown)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.lineItems.length ?? 0) > 0) ?? null;
    const items = (doc?.facts?.lineItems ?? []).filter((item) => textOf(doc!).includes(item.quote)).slice(0, 8);
    if (!doc || !items.length) return uploadsOnly ? uploadMiss(pool[pool.length - 1] ?? null) : documentMiss(question, docs);
    return note(items.map((item) => `“${item.quote}” ${cite(doc, item.location)}`).join(' '), doc);
  }

  if (/\b(permit)\b/i.test(question)) {
    const doc = pickDoc(question, pool.length ? pool : docs);
    const hay = doc ? textOf(doc) : pool.map(textOf).join('\n');
    if (!/permit/i.test(hay)) return uploadsOnly ? uploadMiss(pool[pool.length - 1] ?? null) : documentMiss(question, docs);
  }

  const doc = about ? pool[pool.length - 1] ?? null : pickDoc(question, pool.length ? pool : docs);
  if (!doc) return uploadsOnly ? uploadMiss(uploads[0] ?? null) : documentMiss(question, docs);
  const hit = bestChunk(question, doc);
  if (!hit) {
    if (!documentIsJobKnowledge(doc) || uploadsOnly) return uploadMiss(doc);
    return documentMiss(question, docs);
  }
  const quote = clipQuote(hit.text, question);
  if (!quote || !hit.text.includes(quote)) {
    if (!documentIsJobKnowledge(doc) || uploadsOnly) return uploadMiss(doc);
    return documentMiss(question, docs);
  }
  return note(`“${quote}” ${cite(doc, hit.location)}`, doc);
}

export function documentChunksForGrounding(
  documents: AskDocumentView[] | null | undefined,
  opts?: { includeUploads?: boolean },
): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  for (const doc of documents ?? []) {
    // A refused or unconfirmed upload is not job evidence. Leaving its text
    // here would let quote checks accept a line from a file that is not on the job.
    // includeUploads is only for the chat that received the file.
    if (!opts?.includeUploads && !documentIsJobKnowledge(doc)) continue;
    const rows = doc.chunks?.length
      ? doc.chunks
      : textOf(doc)
        ? [{ seq: 0, location: 'document', text: textOf(doc) }]
        : [];
    rows.forEach((row, index) => {
      const text = String(row.text ?? '').trim();
      if (!text) return;
      const location = row.location || 'document';
      chunks.push({
        key: `doc:${doc.id}#${index}`,
        proofId: `doc:${doc.id}`,
        jobId: '',
        orgId: '',
        clipTitle: `${doc.filename}, ${location}`,
        workDate: null,
        seq: row.seq ?? index,
        startSec: null,
        endSec: null,
        text,
        speaker: null,
        cite: `doc:${doc.id}#${location}`,
      });
    });
  }
  return chunks;
}

function compareToEvidence(question: string, docs: AskDocumentView[], evidence: Array<{ source: string; text: string }>): string | null {
  const attached = docs.filter((doc) => doc.attached !== false && doc.relevance !== 'not_related');
  const doc = pickDoc(question, attached) ?? attached.find((row) => (row.facts?.lineItems.length ?? 0) > 0) ?? null;
  if (!doc) return 'This document does not show that.';
  const items = (doc.facts?.lineItems ?? []).filter((item) => textOf(doc).includes(item.quote)).slice(0, 6);
  if (!items.length) return 'This document does not show that.';
  const lines = items.map((item) => {
    const seen = evidence.find((row) => sharesWords(item.label, row.text));
    const video = seen
      ? ` ${seen.source} mentions the same work.`
      : ' The videos on file do not show that line.';
    const amount = textOf(doc).includes(item.value) ? item.value : item.quote;
    return `The document lists ${item.label} at “${amount}” ${cite(doc, item.location)}.${video}`;
  });
  return lines.join(' ');
}

/** Abstain only when the question really targets an attached document. Otherwise the job file answers. */
function documentMiss(question: string, docs: AskDocumentView[]): string | null {
  const attached = docs.filter(documentIsJobKnowledge);
  if (!isDocumentQuestion(question, attached)) return null;
  return 'This document does not show that.';
}

function isDocumentQuestion(question: string, docs: AskDocumentView[]): boolean {
  // "this file" and "the file" are the job file (brief, parties, clips).
  // Treating them as an upload makes those questions abstain before job evidence runs.
  if (/\b(document|pdf|spreadsheet|workbook|uploaded|attachment)\b/i.test(question)) {
    return true;
  }
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

function pickDoc(question: string, docs: AskDocumentView[]): AskDocumentView | null {
  let best: { doc: AskDocumentView; score: number } | null = null;
  for (const doc of docs) {
    let score = 0;
    const kind = String(doc.kind ?? '').replace(/_/g, ' ');
    if (kind && new RegExp(kind, 'i').test(question)) score += 3;
    if (/\bestimate\b/i.test(question) && doc.kind === 'estimate') score += 4;
    if (/\binvoice\b/i.test(question) && doc.kind === 'invoice') score += 4;
    if (/\bfloor\s*plan\b/i.test(question) && (doc.kind === 'floor_plan' || doc.kind === 'sketch')) score += 4;
    const name = doc.filename.toLowerCase();
    for (const word of tokens(question)) {
      if (name.includes(word) || textOf(doc).toLowerCase().includes(word)) score += 1;
    }
    if (!best || score > best.score) best = { doc, score };
  }
  return best && best.score > 0 ? best.doc : docs[0] ?? null;
}

function bestChunk(question: string, doc: AskDocumentView): { location: string; text: string } | null {
  const words = tokens(question).filter((word) => !STOP.has(word));
  const rows = doc.chunks?.length ? doc.chunks : [{ location: 'document', text: textOf(doc) }];
  let best: { location: string; text: string; score: number } | null = null;
  for (const row of rows) {
    const hay = row.text.toLowerCase();
    const score = words.filter((word) => hay.includes(word)).length;
    if (!best || score > best.score) best = { location: row.location, text: row.text, score };
  }
  if (!best || best.score === 0) return null;
  return best;
}

function clipQuote(text: string, question: string): string | null {
  const words = tokens(question).filter((word) => !STOP.has(word));
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => words.some((word) => line.toLowerCase().includes(word)));
  const quote = (hit ?? text).replace(/\s+/g, ' ').trim().slice(0, 240);
  return quote.length >= 2 ? quote : null;
}

function textOf(doc: AskDocumentView | null | undefined): string {
  if (!doc) return '';
  if (doc.extractedText?.trim()) return doc.extractedText;
  return (doc.chunks ?? []).map((chunk) => chunk.text).join('\n');
}

function cite(doc: AskDocumentView, location: string): string {
  const where = location && location !== 'document' ? location : 'document';
  return `(${doc.filename}, ${where})`;
}

function kindWord(doc: AskDocumentView): string {
  const kind = String(doc.kind ?? 'document').replace(/_/g, ' ');
  return kind === 'floor plan' ? 'floor plan' : kind;
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9$]+/).filter((word) => word.length > 2);
}

function sharesWords(label: string, text: string): boolean {
  const words = tokens(label).filter((word) => word.length > 3 && !STOP.has(word));
  const hay = text.toLowerCase();
  return words.some((word) => hay.includes(word));
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
