import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdminOrNull, writerForJob } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { isModelProviderConfigured } from '../lib/anthropic.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { extractScopeFromDocument } from '../verifier/scopeReader.js';
import { recordAccess } from './proofOfWork.js';

/**
 * The scope of work arrives as a document.
 *
 * Upload what the job actually has — the signed work order, the carrier
 * estimate PDF — and the model reads it into proposed scope lines. The
 * structure enforces the one rule that matters: the proposal never becomes
 * the scope by itself. Extracted lines live on the document row; only the
 * confirm step — a person, possibly after editing — creates job_scope_items,
 * and every line it creates carries the document's id as provenance.
 *
 * From there the rest of the machine already runs: the capture guide builds
 * its shot list from these lines, the analyst judges footage against them,
 * and the Verifier shows the verdicts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DOC_BUCKET = 'job-proofs';
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const scopeDocsRouter = Router();
scopeDocsRouter.use(requireAuth);
// The document rides in the JSON body; the default body cap would refuse it.
scopeDocsRouter.use(express.json({ limit: '15mb' }));

interface ExtractionJob {
  key: string;
  docId: string;
  orgId: string;
}

async function performExtraction(admin: any, job: ExtractionJob): Promise<void> {
  const write = (patch: Record<string, unknown>) =>
    admin.from('scope_documents').update(patch).eq('id', job.docId);

  if (!isModelProviderConfigured()) {
    await write({ status: 'failed', extraction_error: 'No model is configured on this server.' });
    return;
  }

  await write({ status: 'extracting' });

  const { data: doc } = await admin
    .from('scope_documents')
    .select('storage_path, media_type')
    .eq('id', job.docId)
    .maybeSingle();
  if (!doc) throw new Error('The document row disappeared.');

  const { data: blob, error } = await admin.storage
    .from(DOC_BUCKET)
    .download((doc as any).storage_path);
  if (error || !blob) throw new Error('The stored document could not be read back.');
  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

  const extraction = await extractScopeFromDocument({
    mediaType: (doc as any).media_type,
    base64,
  });
  if (!extraction) throw new Error('The model reply was not usable.');

  await write({
    status: 'extracted',
    extracted: { lines: extraction.lines, couldNotRead: extraction.couldNotRead },
    model: extraction.model,
    extraction_error: null,
  });
}

const extractionQueue = new RetryQueue<ExtractionJob>({
  run: async (job) => {
    const admin = unscopedAdminOrNull();
    if (!admin) throw new Error('Storage is not configured.');
    await performExtraction(admin, job);
  },
  onGaveUp: async (job, error) => {
    const admin = unscopedAdminOrNull();
    if (!admin) return;
    await admin
      .from('scope_documents')
      .update({
        status: 'failed',
        extraction_error: error instanceof Error ? error.message : 'Extraction failed.',
      })
      .eq('id', job.docId);
  },
});

function serializeDoc(row: any) {
  return {
    id: row.id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    status: row.status,
    extracted: row.extracted ?? null,
    extractionError: row.extraction_error ?? null,
    confirmedAt: row.confirmed_at ?? null,
    createdAt: row.created_at,
  };
}

/** POST /api/operations/shared/:jobId/scope-doc — upload, then read. */
scopeDocsRouter.post(
  '/shared/:jobId/scope-doc',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          filename: z.string().trim().min(1).max(200),
          mediaType: z.enum(['application/pdf', 'text/plain']),
          contentBase64: z.string().min(8),
        })
        .parse(req.body);
      const { supabase, orgId, userId } = await requireOrgContext(req);

      const { data: job } = await supabase
        .from('crm_jobs')
        .select('id')
        .eq('org_id', orgId)
        .eq('id', req.params.jobId)
        .maybeSingle();
      if (!job) throw new HttpError(404, 'No such job.', 'job_not_found');

      const bytes = Buffer.from(body.contentBase64, 'base64');
      if (!bytes.length) throw new HttpError(400, 'The document is empty.', 'empty_document');
      if (bytes.length > MAX_DOC_BYTES) {
        throw new HttpError(413, 'Documents are capped at 10 MB.', 'too_large');
      }

      const admin = writerForJob({ orgId, jobId: req.params.jobId }, supabase).raw;

      const { data: doc, error } = await admin
        .from('scope_documents')
        .insert({
          org_id: orgId,
          job_id: req.params.jobId,
          filename: body.filename,
          media_type: body.mediaType,
          byte_size: bytes.length,
          content_hash: createHash('sha256').update(bytes).digest('hex'),
          storage_path: `scope-docs/${orgId}/${req.params.jobId}/${Date.now()}-${body.filename.replace(/[^\w.-]+/g, '_')}`,
          uploaded_by: userId,
        })
        .select('*')
        .single();
      if (error) throw new HttpError(500, error.message, 'doc_insert_failed');

      const { error: storeError } = await admin.storage
        .from(DOC_BUCKET)
        .upload((doc as any).storage_path, bytes, { contentType: body.mediaType });
      if (storeError) {
        await admin.from('scope_documents').delete().eq('id', (doc as any).id);
        throw new HttpError(500, storeError.message, 'doc_store_failed');
      }

      extractionQueue.enqueue({ key: `scopedoc:${(doc as any).id}`, docId: (doc as any).id, orgId });

      res.status(201).json({ doc: serializeDoc(doc) });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/operations/shared/:jobId/scope-doc — the latest document + proposal. */
scopeDocsRouter.get(
  '/shared/:jobId/scope-doc',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId } = await requireOrgContext(req);
      const { data } = await supabase
        .from('scope_documents')
        .select('*')
        .eq('org_id', orgId)
        .eq('job_id', req.params.jobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      res.json({ doc: data ? serializeDoc(data) : null });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/operations/shared/:jobId/scope-doc/:docId/confirm
 *
 * The human step that turns a proposal into the scope. The lines in the body
 * are what the person kept — edited, pruned, reworded — and each created
 * scope line is stamped with the document it came from.
 */
scopeDocsRouter.post(
  '/shared/:jobId/scope-doc/:docId/confirm',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          lines: z
            .array(
              z.object({
                title: z.string().trim().min(2).max(200),
                state: z.enum(['included', 'excluded']),
                reason: z.string().trim().max(1000).nullish(),
                amount: z.number().min(0).nullish(),
              }),
            )
            .min(1)
            .max(60),
        })
        .parse(req.body);
      const { supabase, orgId, userId } = await requireOrgContext(req);

      const admin = writerForJob({ orgId, jobId: req.params.jobId }, supabase).raw;

      const { data: doc } = await admin
        .from('scope_documents')
        .select('id, job_id, filename, status')
        .eq('org_id', orgId)
        .eq('id', req.params.docId)
        .maybeSingle();
      if (!doc || (doc as any).job_id !== req.params.jobId) {
        throw new HttpError(404, 'No such document on this job.', 'not_found');
      }
      if ((doc as any).status === 'confirmed') {
        throw new HttpError(409, 'This document was already confirmed.', 'already_confirmed');
      }
      if ((doc as any).status !== 'extracted') {
        throw new HttpError(409, 'The document has not finished being read.', 'not_extracted');
      }

      for (const line of body.lines) {
        const { error } = await admin.from('job_scope_items').insert({
          org_id: orgId,
          job_id: req.params.jobId,
          state: line.state,
          title: line.title,
          reason: line.reason ?? null,
          amount: line.amount ?? null,
          created_by: userId,
          source_document_id: (doc as any).id,
        });
        if (error) throw new HttpError(500, error.message, 'scope_insert_failed');
      }

      await admin
        .from('scope_documents')
        .update({ status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString() })
        .eq('id', (doc as any).id);

      // Provenance for a job that has none. `ignoreDuplicates` rather than an
      // upsert that overwrites: a job that was synced or typed already has a
      // truthful origin, and confirming a document later does not change how
      // the job got here. This only fills the gap for jobs that predate
      // intake tracking, where this document is the earliest recorded thing
      // we know about where the job's information came from.
      await admin
        .from('job_intake')
        .upsert(
          {
            job_id: req.params.jobId,
            org_id: orgId,
            source: 'scope_document',
            source_detail: { documentId: (doc as any).id, filename: (doc as any).filename },
            entered_by: userId,
          },
          { onConflict: 'job_id', ignoreDuplicates: true },
        )
        .then(
          () => undefined,
          () => undefined,
        );

      // On the record: the scope the footage will be judged against was set
      // from this document, by this person.
      await recordAccess(supabase, {
        orgId,
        jobId: req.params.jobId,
        action: 'accepted',
        actorId: userId,
        actorLabel: 'Office',
        actorRole: 'general_contractor',
        detail: `Scope set from "${(doc as any).filename}" — ${body.lines.length} lines confirmed`,
      });

      res.json({ ok: true, created: body.lines.length });
    } catch (err) {
      next(err);
    }
  },
);
