/**
 * Chat document upload.
 *
 * The file is sniffed and read before anything is stored. A bad, encrypted,
 * or unsupported file never lands in the bucket. Relevance decides whether
 * the row is attached to the job the office has open. Outside a job, a likely
 * match waits for the user to confirm.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { writerForOrg } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { ingestChatDocument } from '../documents/pipeline.js';
import { viewsFromChatRows } from '../documents/load.js';
import { answerFromJobDocuments, documentChunksForGrounding } from '../documents/answer.js';
import { enforceQuoteGrounding } from '../shared/askQuoteGrounding.js';
import { documentRoomRows, persistDocumentRooms } from '../documents/rooms.js';
import {
  DocumentReadError,
  KIND_LABEL,
  type DocumentFacts,
  type DocumentKind,
  type IngestedDocument,
  type JobMatchProfile,
} from '../documents/types.js';

const BUCKET = 'job-proofs';

export const chatDocumentsRouter = Router();
chatDocumentsRouter.use(requireAuth);

type Card = {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  kind: string;
  kindLabel: string;
  relevance: string;
  relevanceReason: string | null;
  summary: string | null;
  attached: boolean;
  jobId: string | null;
  contextJobId: string | null;
  suggestedJobId: string | null;
  suggestedJobTitle: string | null;
  macrosIgnored: boolean;
  createdAt: string;
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind as DocumentKind] ?? 'Document';
}

function cardFromRow(row: Record<string, unknown>, titles: Map<string, string>): Card {
  const suggested = row.suggested_job_id ? String(row.suggested_job_id) : null;
  const jobId = row.job_id ? String(row.job_id) : null;
  const kind = String(row.doc_kind ?? 'other');
  return {
    id: String(row.id),
    filename: String(row.filename ?? ''),
    mediaType: String(row.media_type ?? 'application/octet-stream'),
    byteSize: Number(row.byte_size ?? 0),
    kind,
    kindLabel: kindLabel(kind),
    relevance: String(row.relevance ?? 'not_related'),
    relevanceReason: row.relevance_reason ? String(row.relevance_reason) : null,
    summary: row.summary ? String(row.summary) : null,
    attached: Boolean(jobId),
    jobId,
    contextJobId: row.context_job_id ? String(row.context_job_id) : null,
    suggestedJobId: suggested,
    suggestedJobTitle: suggested ? titles.get(suggested) ?? null : null,
    macrosIgnored: Boolean(row.macros_ignored),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

async function jobTitles(supabase: { from: (table: string) => any }, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const titles = new Map<string, string>();
  if (!unique.length) return titles;
  const { data } = await supabase.from('crm_jobs').select('id, title').eq('org_id', orgId).in('id', unique);
  for (const row of (data ?? []) as Array<{ id?: string; title?: string | null }>) {
    if (row.id) titles.set(String(row.id), String(row.title ?? '').trim() || 'this job');
  }
  return titles;
}

async function loadJobProfile(supabase: { from: (table: string) => any }, orgId: string, jobId: string): Promise<JobMatchProfile | null> {
  const { data: job } = await supabase
    .from('crm_jobs')
    .select('id, title, description, claim_number, property_id')
    .eq('org_id', orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return null;
  let address: string | null = null;
  if (job.property_id) {
    const { data: prop } = await supabase
      .from('crm_properties')
      .select('address_line1, city, region')
      .eq('id', job.property_id)
      .maybeSingle();
    if (prop) {
      address = [prop.address_line1, prop.city, prop.region].map((part: unknown) => String(part ?? '').trim()).filter(Boolean).join(', ') || null;
    }
  }
  return {
    id: String(job.id),
    title: job.title ? String(job.title) : null,
    address,
    claimNumber: job.claim_number ? String(job.claim_number) : null,
    customerName: null,
    description: job.description ? String(job.description) : null,
    scopeText: null,
  };
}

async function loadCandidates(supabase: { from: (table: string) => any }, orgId: string): Promise<JobMatchProfile[]> {
  const { data: jobs } = await supabase
    .from('crm_jobs')
    .select('id, title, description, claim_number, property_id')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(30);
  const rows = (jobs ?? []) as Array<Record<string, unknown>>;
  const propertyIds = [...new Set(rows.map((row) => String(row.property_id ?? '')).filter(Boolean))];
  const addresses = new Map<string, string>();
  if (propertyIds.length) {
    const { data: props } = await supabase
      .from('crm_properties')
      .select('id, address_line1, city')
      .in('id', propertyIds);
    for (const prop of (props ?? []) as Array<Record<string, unknown>>) {
      const line = [prop.address_line1, prop.city].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
      if (prop.id && line) addresses.set(String(prop.id), line);
    }
  }
  return rows.map((row) => ({
    id: String(row.id),
    title: row.title ? String(row.title) : null,
    address: addresses.get(String(row.property_id ?? '')) ?? null,
    claimNumber: row.claim_number ? String(row.claim_number) : null,
    customerName: null,
    description: row.description ? String(row.description) : null,
    scopeText: null,
  }));
}

function chunkRows(orgId: string, documentId: string, jobId: string | null, ingested: IngestedDocument) {
  return ingested.extraction.chunks.slice(0, 200).flatMap((chunk) => {
    const text = chunk.text.trim().slice(0, 4000);
    if (!text) return [];
    return [{
      org_id: orgId,
      document_id: documentId,
      job_id: jobId,
      seq: chunk.seq,
      location: chunk.location.slice(0, 80) || 'document',
      text,
    }];
  });
}

/** POST /api/operations/documents — sniff, read, classify, then store. */
chatDocumentsRouter.post('/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      filename: z.string().trim().min(1).max(200),
      contentBase64: z.string().min(8).max(36_000_000),
      jobId: z.string().uuid().nullable().optional(),
      proofId: z.string().uuid().nullable().optional(),
    }).parse(req.body ?? {});
    const { supabase, orgId, userId } = await requireOrgContext(req);
    const bytes = Buffer.from(body.contentBase64, 'base64');
    if (!bytes.length) throw new HttpError(400, 'The document is empty.', 'empty');

    const job = body.jobId ? await loadJobProfile(supabase, orgId, body.jobId) : null;
    if (body.jobId && !job) throw new HttpError(404, 'No such job.', 'job_not_found');
    const candidates = job ? [] : await loadCandidates(supabase, orgId);

    let ingested: IngestedDocument;
    try {
      ingested = await ingestChatDocument({ bytes, filename: body.filename, job, candidates });
    } catch (err) {
      if (err instanceof DocumentReadError) throw new HttpError(400, err.message, err.code);
      throw err;
    }

    const id = randomUUID();
    const attach = Boolean(job && ingested.relevance.attach);
    const storagePath = `${orgId}/chat-documents/${id}/${ingested.filename}`;
    const now = new Date().toISOString();
    const row = {
      id,
      org_id: orgId,
      job_id: attach ? job!.id : null,
      context_job_id: job?.id ?? null,
      suggested_job_id: ingested.relevance.suggestedJobId,
      proof_id: body.proofId ?? null,
      filename: ingested.filename,
      media_type: ingested.mediaType,
      byte_size: bytes.length,
      content_hash: ingested.contentHash,
      storage_path: storagePath,
      status: 'ready',
      doc_kind: ingested.kind,
      relevance: ingested.relevance.verdict,
      relevance_reason: ingested.relevance.reason,
      summary: ingested.summary,
      extracted_text: ingested.extraction.text.slice(0, 200_000),
      key_facts: ingested.facts,
      chunk_index: ingested.extraction.chunks,
      extraction_error: null,
      macros_ignored: ingested.macrosIgnored,
      uploaded_by: userId,
      attached_at: attach ? now : null,
      created_at: now,
    };

    const admin = writerForOrg(orgId, supabase).raw;
    const { error } = await admin.from('job_chat_documents').insert(row);
    if (error) throw new HttpError(500, 'The document could not be saved.', 'doc_insert_failed');

    const { error: storeError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: ingested.mediaType,
      upsert: false,
    });
    if (storeError) {
      await admin.from('job_chat_documents').delete().eq('id', id).eq('org_id', orgId);
      throw new HttpError(500, 'The document could not be stored.', 'doc_store_failed');
    }

    const chunks = chunkRows(orgId, id, attach ? job!.id : null, ingested);
    if (chunks.length) {
      const { error: chunkError } = await admin.from('ask_document_chunks').insert(chunks);
      if (chunkError) {
        await admin.storage.from(BUCKET).remove([storagePath]);
        await admin.from('job_chat_documents').delete().eq('id', id).eq('org_id', orgId);
        throw new HttpError(500, 'The document could not be indexed.', 'doc_index_failed');
      }
    }

    if (attach && job) {
      await persistDocumentRooms(admin, documentRoomRows({
        orgId,
        jobId: job.id,
        documentId: id,
        rooms: ingested.facts.rooms,
      }));
    }

    const titles = await jobTitles(supabase, orgId, [ingested.relevance.suggestedJobId ?? '']);
    res.status(201).json({ document: cardFromRow(row, titles) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/operations/shared/:jobId/documents — attached files, plus uploads made in this chat. */
chatDocumentsRouter.get('/shared/:jobId/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = z.string().uuid().parse(req.params.jobId);
    const { supabase, orgId } = await requireOrgContext(req);
    const job = await loadJobProfile(supabase, orgId, jobId);
    if (!job) throw new HttpError(404, 'No such job.', 'job_not_found');
    const { data, error } = await supabase
      .from('job_chat_documents')
      .select('id, filename, media_type, byte_size, doc_kind, relevance, relevance_reason, summary, job_id, context_job_id, suggested_job_id, macros_ignored, created_at')
      .eq('org_id', orgId)
      .or(`job_id.eq.${jobId},context_job_id.eq.${jobId}`)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) {
      res.json({ documents: [] });
      return;
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const titles = await jobTitles(supabase, orgId, rows.map((row) => String(row.suggested_job_id ?? '')));
    res.json({ documents: rows.map((row) => cardFromRow(row, titles)) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/operations/documents/:id/attach — the user confirms the suggested job. */
chatDocumentsRouter.post('/documents/:id/attach', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ jobId: z.string().uuid() }).parse(req.body ?? {});
    const { supabase, orgId } = await requireOrgContext(req);
    const job = await loadJobProfile(supabase, orgId, body.jobId);
    if (!job) throw new HttpError(404, 'No such job.', 'job_not_found');
    const admin = writerForOrg(orgId, supabase).raw;
    const { data: existing, error: readError } = await admin
      .from('job_chat_documents')
      .select('id, job_id, key_facts, filename, media_type, byte_size, doc_kind, relevance, relevance_reason, summary, context_job_id, suggested_job_id, macros_ignored, created_at')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new HttpError(500, 'The document could not be read.', 'doc_read_failed');
    if (!existing) throw new HttpError(404, 'No such document.', 'not_found');
    if (existing.job_id && existing.job_id !== body.jobId) {
      throw new HttpError(409, 'This document is already attached to another job.', 'already_attached');
    }
    const now = new Date().toISOString();
    if (!existing.job_id) {
      const { error } = await admin
        .from('job_chat_documents')
        .update({
          job_id: body.jobId,
          attached_at: now,
          relevance: 'related',
          relevance_reason: 'Attached after you confirmed this job.',
          context_job_id: existing.context_job_id ?? body.jobId,
        })
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw new HttpError(500, 'The document could not be attached.', 'doc_attach_failed');
      await admin.from('ask_document_chunks').update({ job_id: body.jobId }).eq('org_id', orgId).eq('document_id', id);
      const facts = existing.key_facts as DocumentFacts | null;
      await persistDocumentRooms(admin, documentRoomRows({
        orgId,
        jobId: body.jobId,
        documentId: id,
        rooms: facts?.rooms ?? [],
      }));
    }
    const titles = await jobTitles(supabase, orgId, []);
    res.json({
      document: cardFromRow({
        ...existing,
        job_id: body.jobId,
        relevance: 'related',
        relevance_reason: existing.job_id ? existing.relevance_reason : 'Attached after you confirmed this job.',
      }, titles),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/operations/documents/ask — a question about uploaded files. */
chatDocumentsRouter.post('/documents/ask', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      question: z.string().trim().min(3).max(1000),
      documentIds: z.array(z.string().uuid()).min(1).max(8),
    }).parse(req.body ?? {});
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('job_chat_documents')
      .select('id, filename, doc_kind, relevance, relevance_reason, summary, extracted_text, key_facts, chunk_index, job_id')
      .eq('org_id', orgId)
      .in('id', body.documentIds);
    if (error) throw new HttpError(500, 'The documents could not be read.', 'doc_read_failed');
    const views = viewsFromChatRows(data ?? []);
    const direct = answerFromJobDocuments(body.question, views) ?? 'This document does not show that.';
    const answer = enforceQuoteGrounding(direct, {
      chunks: documentChunksForGrounding(views),
      question: body.question,
    }).answer;
    res.json({ answer });
  } catch (err) {
    next(err);
  }
});
