/**
 * Durable processing orchestration.
 *
 * Each video gets a processing job with one row per stage. Stages are
 * idempotent: a completed step with an output digest is not re-run unless
 * forced. The in-process RetryQueue drains work; DB status survives restarts
 * so a dashboard can re-kick failed jobs.
 */

import { createHash } from 'node:crypto';
import { RetryQueue } from '../../shared/retryQueue.js';
import { PROCESSING_STAGES, type ProcessingStage, type StepStatus } from '../types.js';
import { verificationConfig } from '../config.js';
import { appendAuditEvent } from '../audit/auditLog.js';

export interface PipelineContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  videoId: string;
  jobId: string;
  processingJobId: string;
  attempt: number;
  config: Record<string, unknown>;
}

export type StageHandler = (
  ctx: PipelineContext,
) => Promise<{ output?: Record<string, unknown>; digest?: string; skip?: boolean }>;

export interface OrchestratorOptions {
  handlers: Partial<Record<ProcessingStage, StageHandler>>;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

interface QueuePayload {
  key: string;
  orgId: string;
  videoId: string;
  processingJobId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex').slice(0, 32);
}

export class ProcessingOrchestrator {
  private readonly queue: RetryQueue<QueuePayload>;
  private readonly handlers: Partial<Record<ProcessingStage, StageHandler>>;

  constructor(opts: OrchestratorOptions) {
    this.handlers = opts.handlers;
    this.queue = new RetryQueue<QueuePayload>({
      delaysMs: opts.delaysMs ?? [2_000, 15_000, 60_000],
      sleep: opts.sleep,
      run: async (job, attempt) => {
        await this.runJob(job, attempt);
      },
      onGaveUp: async (job, error) => {
        const message = error instanceof Error ? error.message : String(error);
        await job.supabase
          .from('video_processing_jobs')
          .update({
            status: 'failed',
            last_error: message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.processingJobId);
        await job.supabase
          .from('verification_videos')
          .update({ status: 'failed', processing_error: message })
          .eq('id', job.videoId);
        await appendAuditEvent(job.supabase, {
          orgId: job.orgId,
          videoId: job.videoId,
          eventType: 'pipeline.gave_up',
          entityType: 'video_processing_job',
          entityId: job.processingJobId,
          payload: { error: message },
        });
      },
    });
  }

  get pending(): number {
    return this.queue.pending;
  }

  /**
   * Create (or reuse) a durable job + step rows, then enqueue execution.
   * Returns the processing job id. Idempotent on (org, idempotencyKey).
   */
  async enqueue(opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    orgId: string;
    videoId: string;
    jobId: string;
    idempotencyKey?: string;
    config?: Record<string, unknown>;
    force?: boolean;
  }): Promise<{ processingJobId: string; created: boolean; enqueued: boolean }> {
    const idempotencyKey =
      opts.idempotencyKey ??
      `${opts.videoId}:${verificationConfig.pipelineVersion}${opts.force ? `:force:${Date.now()}` : ''}`;

    const { data: existing } = await opts.supabase
      .from('video_processing_jobs')
      .select('id, status')
      .eq('org_id', opts.orgId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing && !opts.force) {
      const enqueued = this.queue.enqueue({
        key: existing.id,
        orgId: opts.orgId,
        videoId: opts.videoId,
        processingJobId: existing.id,
        supabase: opts.supabase,
      });
      return { processingJobId: existing.id, created: false, enqueued };
    }

    const { data: job, error } = await opts.supabase
      .from('video_processing_jobs')
      .insert({
        org_id: opts.orgId,
        video_id: opts.videoId,
        job_id: opts.jobId,
        idempotency_key: idempotencyKey,
        pipeline_version: verificationConfig.pipelineVersion,
        status: 'pending',
        max_attempts: verificationConfig.maxStepAttempts,
        config: opts.config ?? {},
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const steps = PROCESSING_STAGES.map((stage) => ({
      org_id: opts.orgId,
      processing_job_id: job.id,
      video_id: opts.videoId,
      stage,
      status: 'pending' as StepStatus,
    }));
    const { error: stepError } = await opts.supabase.from('video_processing_steps').insert(steps);
    if (stepError) throw new Error(stepError.message);

    await opts.supabase
      .from('verification_videos')
      .update({ status: 'queued', processing_error: null })
      .eq('id', opts.videoId)
      .eq('org_id', opts.orgId);

    await appendAuditEvent(opts.supabase, {
      orgId: opts.orgId,
      jobId: opts.jobId,
      videoId: opts.videoId,
      eventType: 'pipeline.enqueued',
      entityType: 'video_processing_job',
      entityId: job.id,
      payload: { idempotencyKey },
    });

    const enqueued = this.queue.enqueue({
      key: job.id,
      orgId: opts.orgId,
      videoId: opts.videoId,
      processingJobId: job.id,
      supabase: opts.supabase,
    });

    return { processingJobId: job.id, created: true, enqueued };
  }

  private async runJob(job: QueuePayload, attempt: number): Promise<void> {
    const { data: row, error } = await job.supabase
      .from('video_processing_jobs')
      .select('*, verification_videos!inner(job_id, status)')
      .eq('id', job.processingJobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error('Processing job not found');
    if (row.status === 'cancelled' || row.cancelled_at) return;
    if (row.status === 'completed') return;

    await job.supabase
      .from('video_processing_jobs')
      .update({
        status: 'running',
        attempt_count: attempt,
        started_at: row.started_at ?? new Date().toISOString(),
        last_error: null,
      })
      .eq('id', job.processingJobId);

    await job.supabase
      .from('verification_videos')
      .update({ status: 'processing' })
      .eq('id', job.videoId);

    const ctxBase: Omit<PipelineContext, 'attempt'> = {
      supabase: job.supabase,
      orgId: job.orgId,
      videoId: job.videoId,
      jobId: row.job_id,
      processingJobId: job.processingJobId,
      config: (row.config ?? {}) as Record<string, unknown>,
    };

    for (const stage of PROCESSING_STAGES) {
      const { data: step } = await job.supabase
        .from('video_processing_steps')
        .select('*')
        .eq('processing_job_id', job.processingJobId)
        .eq('stage', stage)
        .maybeSingle();

      if (!step) continue;
      if (step.status === 'completed' || step.status === 'skipped') continue;
      if (row.cancelled_at) return;

      await job.supabase
        .from('video_processing_jobs')
        .update({ current_stage: stage })
        .eq('id', job.processingJobId);

      await job.supabase
        .from('video_processing_steps')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          attempt_count: (step.attempt_count ?? 0) + 1,
          last_error: null,
        })
        .eq('id', step.id);

      const handler = this.handlers[stage];
      if (!handler) {
        await job.supabase
          .from('video_processing_steps')
          .update({
            status: 'skipped',
            completed_at: new Date().toISOString(),
            output: { reason: 'no_handler' },
          })
          .eq('id', step.id);
        continue;
      }

      try {
        const result = await handler({ ...ctxBase, attempt });
        const output = result.output ?? {};
        const digest = result.digest ?? digestOf(output);
        await job.supabase
          .from('video_processing_steps')
          .update({
            status: result.skip ? 'skipped' : 'completed',
            completed_at: new Date().toISOString(),
            output,
            output_digest: digest,
          })
          .eq('id', step.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await job.supabase
          .from('video_processing_steps')
          .update({ status: 'failed', last_error: message })
          .eq('id', step.id);
        throw err;
      }
    }

    await job.supabase
      .from('video_processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_stage: 'finalize_report',
      })
      .eq('id', job.processingJobId);

    await job.supabase
      .from('verification_videos')
      .update({ status: 'completed', processing_error: null })
      .eq('id', job.videoId);

    await appendAuditEvent(job.supabase, {
      orgId: job.orgId,
      jobId: row.job_id,
      videoId: job.videoId,
      eventType: 'pipeline.completed',
      entityType: 'video_processing_job',
      entityId: job.processingJobId,
      payload: { attempt },
    });
  }
}

/** Build an idempotency key for a video + pipeline version. */
export function pipelineIdempotencyKey(videoId: string, version = verificationConfig.pipelineVersion): string {
  return `${videoId}:${version}`;
}
