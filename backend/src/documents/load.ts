/**
 * Rows from job_chat_documents, shaped for Ask.
 * A missing table returns nothing so Ask still answers while a migration is applying.
 */
import type { AskDocumentView } from './answer.js';
import type { DocumentFacts, ExtractedChunk } from './types.js';

export function viewsFromChatRows(rows: unknown): AskDocumentView[] {
  if (!Array.isArray(rows)) return [];
  const views: AskDocumentView[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const filename = String(row.filename ?? '').trim();
    if (!filename) continue;
    const chunks = chunksFrom(row.chunk_index);
    const facts = factsFrom(row.key_facts);
    views.push({
      id: String(row.id ?? filename),
      filename,
      kind: row.doc_kind ? String(row.doc_kind) : null,
      attached: Boolean(row.job_id),
      relevance: row.relevance ? String(row.relevance) : null,
      relevanceReason: row.relevance_reason ? String(row.relevance_reason) : null,
      summary: row.summary ? String(row.summary) : null,
      extractedText: typeof row.extracted_text === 'string' ? row.extracted_text : null,
      chunks,
      facts,
    });
  }
  return views;
}

function chunksFrom(value: unknown): ExtractedChunk[] {
  if (!Array.isArray(value)) return [];
  const chunks: ExtractedChunk[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { seq?: unknown; location?: unknown; text?: unknown };
    const text = String(row.text ?? '').trim();
    if (!text) continue;
    chunks.push({
      seq: Number(row.seq ?? chunks.length) || chunks.length,
      location: String(row.location ?? 'document').slice(0, 80) || 'document',
      text: text.slice(0, 4000),
    });
  }
  return chunks;
}

function factsFrom(value: unknown): DocumentFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<DocumentFacts>;
  return {
    totals: Array.isArray(row.totals) ? row.totals : [],
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    dates: Array.isArray(row.dates) ? row.dates : [],
    addresses: Array.isArray(row.addresses) ? row.addresses : [],
    parties: Array.isArray(row.parties) ? row.parties : [],
    claimNumbers: Array.isArray(row.claimNumbers) ? row.claimNumbers : [],
    rooms: Array.isArray(row.rooms) ? row.rooms : [],
  };
}
