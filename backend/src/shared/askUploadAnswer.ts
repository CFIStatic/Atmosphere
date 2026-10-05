/**
 * Answers about files attached in this chat, the way a general chat assistant
 * reads an attachment: a plain answer in its own words, no job-match note.
 *
 * - Same Ask completion (completeAskText, interactive) and model settings as
 *   the rest of Ask. Nothing here picks a model or provider.
 * - The file text goes only into this prompt. The job-file prompt never sees
 *   an unattached upload.
 * - Every quote is checked against the file text and dropped when it is not
 *   an exact substring. A reply with no prose left is not used.
 */
import { completeAskText } from '../lib/askModel.js';
import type { MeasuredUsage } from '../lib/anthropic.js';
import { documentChunksForGrounding, QUIET_UNRELATED_NOTE, type AskDocumentView } from '../documents/answer.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import { CHAT_VOICE_RULES, normalizeAskProse, trimChatFiller } from './askProse.js';

/** Per-file and total caps on file text sent with one question. */
const FILE_CHARS = 60_000;
const TOTAL_CHARS = 120_000;

export const UPLOAD_ANSWER_SYSTEM = `You are Chat in Atmosphere. The person attached one or more files in this chat and is asking about them.

Rules:
1. Answer the question directly and naturally, in your own words, the way a capable assistant answers about an attachment. The first sentence is the answer.
2. "What is this about", "summarize this", and similar get a real summary: 2 to 4 sentences on what the file is, who wrote it when it says so, and its main points. Do not paste the opening lines back and do not list the raw text.
3. Do not comment on whether the file is related to this job, matches the job, or belongs on the job file.
4. Do not call the file an invoice, estimate, or any other type unless its text or filename says so.
5. Facts about the file come only from the file text and the earlier turns. When the file does not say, say so in one short sentence.
6. Quote only when the exact words matter, at most two short quotes. Copy a quote exactly from the file text, put it in “ ”, and follow it with the file name and location, like “Total: $4,280.00” (Estimate.pdf, page 1). Never paraphrase inside quotation marks. A document has no speakers: never attach a speaker to a quote.
7. Never answer with only a quote. The answer is prose.
8. If the message is not about the files (a greeting, a thanks, a general question), answer it briefly and plainly without forcing the file into it.
9. Plain prose in short paragraphs. Use bullets only for a real list. No sources line, no follow-up list, no machine markup.

${CHAT_VOICE_RULES}`;

type Turn = { role?: string | null; text?: string | null };

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function fileText(doc: AskDocumentView): string {
  const chunks = (doc.chunks ?? []).filter((chunk) => trim(chunk.text));
  if (chunks.length > 1) {
    return chunks.map((chunk) => `[${chunk.location || 'document'}]\n${trim(chunk.text)}`).join('\n\n');
  }
  return trim(doc.extractedText) || trim(chunks[0]?.text);
}

/** Drops the job-match line older answers carried. */
export function withoutLegacyUploadNote(text: string): string {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !line.includes(QUIET_UNRELATED_NOTE))
    .join('\n')
    .trim();
}

export function formatUploadAnswerRequest(input: {
  question: string;
  documents: AskDocumentView[];
  history?: Turn[] | null;
}): string {
  let budget = TOTAL_CHARS;
  const files = input.documents.flatMap((doc) => {
    const text = fileText(doc);
    if (!text || budget <= 0) return [];
    const slice = text.slice(0, Math.min(FILE_CHARS, budget));
    budget -= slice.length;
    const cut = slice.length < text.length ? '\n[The rest of this file is not shown.]' : '';
    return [`=== File: ${doc.filename} ===\n${slice}${cut}`];
  });
  const history = (input.history ?? [])
    .map((turn) => ({
      role: turn.role === 'assistant' ? 'Assistant' : 'User',
      text: turn.role === 'assistant' ? withoutLegacyUploadNote(trim(turn.text)) : trim(turn.text),
    }))
    .filter((turn) => turn.text)
    .slice(-8)
    .map((turn) => `${turn.role}: ${turn.text.slice(0, 2000)}`)
    .join('\n');
  return [
    `Files attached in this chat:\n\n${files.join('\n\n')}`,
    history ? `Earlier in this chat:\n${history}` : '',
    `Question: ${input.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Prose left once quotes, citations, and trailers are taken out. */
function hasProse(answer: string): boolean {
  const body = answer
    .replace(/⟦[^⟧]*⟧/g, ' ')
    .replace(/“[^”]*”|"[^"\n]*"/g, ' ')
    .replace(/\([^()\n]*\)/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  return body.split(/\s+/).filter((word) => word.length > 1).length >= 3;
}

export async function answerChatUploadsWithModel(input: {
  question: string;
  documents: AskDocumentView[];
  history?: Turn[] | null;
  apiKey?: string | null;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  /** Test hook. Defaults to the shared Ask completion. */
  complete?: typeof completeAskText;
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null } | null> {
  const documents = input.documents.filter((doc) => fileText(doc));
  if (!documents.length) return null;
  const complete = input.complete ?? completeAskText;
  const completed = await complete({
    system: UPLOAD_ANSWER_SYSTEM,
    user: formatUploadAnswerRequest({ question: input.question, documents, history: input.history }),
    anthropicApiKey: input.apiKey ?? null,
    mode: 'interactive',
    fetchFn: input.fetchFn,
    signal: input.signal,
  });
  const raw = trim(completed?.text);
  if (!completed || !raw) return null;
  const prose = trimChatFiller(
    normalizeAskProse(withoutLegacyUploadNote(raw.replace(/⟦(?:sources|followups|quotes)[^⟧]*⟧/gi, ''))),
    { question: input.question },
  ).trim();
  const answer = enforceQuoteGrounding(prose, {
    chunks: documentChunksForGrounding(documents, { includeUploads: true }),
    question: input.question,
  }).answer.trim();
  if (!answer || !hasProse(answer)) return null;
  return { answer, model: completed.model ?? null, usage: completed.usage ?? null };
}
