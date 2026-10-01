/**
 * Grounded answers about an uploaded document.
 * Every quoted span is an exact substring of extracted text, cited with the
 * file name and the page, sheet, or cell it came from.
 */
import type { TranscriptChunk } from '../shared/askTranscriptIndex.js';
import type { DocumentFacts, DocumentKind, RelevanceVerdict } from './types.js';

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

export function answerFromJobDocuments(
  question: string,
  documents: AskDocumentView[] | null | undefined,
  evidence: Array<{ source: string; text: string }> = [],
): string | null {
  const docs = (documents ?? []).filter((doc) => textOf(doc).trim());
  if (!docs.length || !isDocumentQuestion(question, docs)) return null;

  if (/\b(compar\w*|versus|\bvs\.?\b|against)\b/i.test(question) && /\b(video|clip|footage|film|saw|seen|work)\b/i.test(question)) {
    return compareToEvidence(question, docs, evidence);
  }

  if (/\b(related|relevant|belong|attached|match(?:es|ing)? this job)\b/i.test(question)) {
    const target = pickDoc(question, docs) ?? docs.find((doc) => doc.attached === false || doc.relevance === 'not_related') ?? null;
    if (!target) return null;
    if (target.attached === false || target.relevance === 'not_related') {
      const reason = clean(target.relevanceReason);
      return `${target.filename} is not related to this job and was not attached.${reason ? ` ${reason}` : ''}`;
    }
    const reason = clean(target.relevanceReason);
    return `${target.filename} is related to this job and is on the file.${reason ? ` ${reason}` : ''}`;
  }

  const attached = docs.filter((doc) => doc.attached !== false && doc.relevance !== 'not_related' && doc.relevance !== 'pending_confirm');
  const pool = attached.length ? attached : [];

  if (/\b(total|amount due|balance due|how much)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.totals.length ?? 0) > 0) ?? null;
    const total = doc?.facts?.totals.find((row) => /total/i.test(row.label)) ?? doc?.facts?.totals[0];
    if (!doc || !total || !textOf(doc).includes(total.quote)) {
      return documentMiss(question, docs);
    }
    return `The ${kindWord(doc)} total is ${total.value}. The document says “${total.quote}” ${cite(doc, total.location)}.`;
  }

  if (/\b(rooms?|floor\s*plan|dimensions?)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.rooms.length ?? 0) > 0) ?? null;
    const rooms = (doc?.facts?.rooms ?? []).filter((room) => textOf(doc!).includes(room.quote));
    if (!doc || !rooms.length) return documentMiss(question, docs);
    const listed = rooms.slice(0, 8).map((room) => `“${room.quote}” ${cite(doc, room.sourceLocation)}`);
    const names = rooms.map((room) => room.name).join(', ');
    return `The floor plan shows ${names}. ${listed.join(' ')}`;
  }

  if (/\b(line items?|breakdown)\b/i.test(question)) {
    const doc = pickDoc(question, pool) ?? pool.find((row) => (row.facts?.lineItems.length ?? 0) > 0) ?? null;
    const items = (doc?.facts?.lineItems ?? []).filter((item) => textOf(doc!).includes(item.quote)).slice(0, 8);
    if (!doc || !items.length) return documentMiss(question, docs);
    return items.map((item) => `“${item.quote}” ${cite(doc, item.location)}`).join(' ');
  }

  if (/\b(permit)\b/i.test(question)) {
    const doc = pickDoc(question, pool.length ? pool : docs);
    const hay = doc ? textOf(doc) : pool.map(textOf).join('\n');
    if (!/permit/i.test(hay)) return documentMiss(question, docs);
  }

  const doc = pickDoc(question, pool.length ? pool : docs);
  if (!doc || doc.attached === false || doc.relevance === 'not_related') {
    if (doc && (doc.attached === false || doc.relevance === 'not_related')) {
      return `${doc.filename} is not related to this job and was not attached.`;
    }
    return documentMiss(question, docs);
  }
  const hit = bestChunk(question, doc);
  if (!hit) return documentMiss(question, docs);
  const quote = clipQuote(hit.text, question);
  if (!quote || !hit.text.includes(quote)) return documentMiss(question, docs);
  return `“${quote}” ${cite(doc, hit.location)}`;
}

export function documentChunksForGrounding(documents: AskDocumentView[] | null | undefined): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  for (const doc of documents ?? []) {
    // A refused or unconfirmed upload is not job evidence. Leaving its text
    // here would let quote checks accept a line from a file that is not on the job.
    if (!documentIsJobKnowledge(doc)) continue;
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
