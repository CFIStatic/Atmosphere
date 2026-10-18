/**
 * Documents on the job and files uploaded in a chat: what Chat may read and quote.
 */
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import {
  answerFromJobDocuments,
  chatUploadShouldAnswer,
  documentChunksForGrounding,
  documentIsJobKnowledge,
  QUIET_UNRELATED_NOTE,
  type AskDocumentView,
} from '../documents/answer.js';
import { normalizeAskProse } from './askProse.js';
import { trim } from './jobFileAskRecord.js';
import type { JobFileAskTurn, JobFileAskContext } from './jobFileAskRecord.js';

export function documentViews(file: JobFileAskContext): AskDocumentView[] {
  return (file.documents ?? []).flatMap((doc) => {
    const filename = trim(doc.filename);
    const text = trim(doc.extractedText);
    if (!filename && !text) return [];
    return [{
      id: trim(doc.id) || filename || 'document',
      filename: filename || 'document',
      kind: doc.kind,
      attached: doc.attached,
      relevance: doc.relevance,
      relevanceReason: doc.relevanceReason,
      summary: doc.summary,
      extractedText: doc.extractedText,
      chunks: doc.chunks,
      facts: doc.facts,
    }];
  });
}

/**
 * A document miss is final only when the question names an upload.
 * "Who is invited on the file?" must not stop at "This document does not show that."
 */
export function keepDocumentAnswer(question: string, answer: string): boolean {
  if (
    /\b(document|pdf|spreadsheet|workbook|uploaded|attachment|estimate|invoice|contract|change\s+order|floor\s*plan|sketch|permit|photo)\b/i.test(
      question,
    )
  ) {
    return true;
  }
  // "this file" / "the file" are the job. Do not let an upload hit or abstain replace it.
  if (/\b(?:this|the)\s+file\b/i.test(question)) return false;
  return !/^this document does not show that\.?$/i.test(answer.trim());
}

/**
 * Answers from files the office user uploaded in this chat, including ones
 * that are not on the job. Job questions and questions about a different
 * document kind fall through so the job file stays first.
 */
export function readableUploads(documents: AskDocumentView[] | null | undefined): AskDocumentView[] {
  return (documents ?? []).filter((doc) => trim(doc.extractedText) || (doc.chunks ?? []).some((chunk) => trim(chunk.text)));
}

/** No model: a deterministic answer from the upload text (never a text dump). */
export function answerFromChatUploads(
  question: string,
  documents: AskDocumentView[] | null | undefined,
): string | null {
  const readable = readableUploads(documents);
  if (!chatUploadShouldAnswer(question, readable)) return null;
  const direct = answerFromJobDocuments(question, readable, []);
  if (!direct) return 'This document does not show that.';
  return enforceQuoteGrounding(normalizeAskProse(direct), {
    chunks: documentChunksForGrounding(readable, { includeUploads: true }),
    question,
  }).answer;
}

export function privateUploadText(doc: AskDocumentView): string {
  const extracted = trim(doc.extractedText);
  if (extracted) return extracted;
  return (doc.chunks ?? []).map((chunk) => trim(chunk.text)).filter(Boolean).join('\n');
}

export function normalizedAskText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when prose repeats an unattached upload: its filename or a real span of
 * its text. Job-file answers must not be stored on the shared record in that case.
 */
export function answerQuotesPrivateUpload(
  answer: string,
  documents: AskDocumentView[] | null | undefined,
): boolean {
  const prose = normalizedAskText(answer);
  if (!prose) return false;
  for (const doc of documents ?? []) {
    if (documentIsJobKnowledge(doc)) continue;
    const filename = normalizedAskText(doc.filename ?? '');
    if (filename.length > 3 && prose.includes(filename)) return true;
    const body = privateUploadText(doc);
    if (!body) continue;
    const flat = normalizedAskText(body);
    if (flat.length >= 24 && prose.includes(flat.slice(0, 120))) return true;
    for (const line of body.split(/\n/)) {
      const row = normalizedAskText(line);
      if (row.length >= 24 && prose.includes(row.slice(0, 120))) return true;
    }
  }
  return false;
}

/** Drop earlier upload answers before a job or public question reaches the model. */
export function historyWithoutPrivateUploads(
  history: JobFileAskTurn[] | null | undefined,
  documents: AskDocumentView[] | null | undefined,
): JobFileAskTurn[] | undefined {
  if (!history?.length) return history ?? undefined;
  const hasPrivateDocs = (documents ?? []).some((doc) => !documentIsJobKnowledge(doc));
  const hasOfficeOnly = history.some((turn) => turn.officeOnly === true);
  if (!hasPrivateDocs && !hasOfficeOnly) return history;
  const quiet = normalizedAskText(QUIET_UNRELATED_NOTE);
  return history.filter((turn) => {
    if (turn.officeOnly === true) return false;
    if (!hasPrivateDocs) return true;
    const text = normalizedAskText(turn.text ?? '');
    if (text.includes(quiet)) return false;
    return !answerQuotesPrivateUpload(turn.text ?? '', documents);
  });
}

/** Deterministic document answers. Quotes are exact substrings, cited with the file and location. */
export function answerFromAttachedDocuments(question: string, file: JobFileAskContext): string | null {
  const views = documentViews(file);
  if (!views.length) return null;
  const evidence = (file.clips ?? []).map((clip) => ({
    source: [clip.workDate, clip.phase, clip.company].filter(Boolean).join(' · ') || 'Video',
    text: [clip.summary, clip.narration, clip.transcript].map(trim).filter(Boolean).join('\n'),
  }));
  const direct = answerFromJobDocuments(question, views, evidence);
  if (!direct) return null;
  return enforceQuoteGrounding(direct, {
    chunks: documentChunksForGrounding(views),
    question,
  }).answer;
}
