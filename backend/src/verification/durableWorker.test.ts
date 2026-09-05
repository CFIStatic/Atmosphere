import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProcessingOrchestrator } from './pipeline/orchestrator.js';

/**
 * In-memory video_processing_jobs store with CAS leases.
 * Simulates the outbox a restarted process reads — no RetryQueue leftovers.
 */
function memoryProcessingDb() {
  const jobs = new Map<string, Record<string, unknown>>();
  const steps = new Map<string, Record<string, unknown>>();
  const videos = new Map<string, Record<string, unknown>>();
  let nowMs = Date.now();

  function matchesOr(filter: string, row: Record<string, unknown>): boolean {
    const parts = filter.split(',');
    return parts.some((part) => {
      const eqOwner = part.match(/^lease_owner\.eq\.(.+)$/);
      if (eqOwner) return row.lease_owner === eqOwner[1];
      if (part === 'lease_until.is.null') return !row.lease_until;
      const lt = part.match(/^lease_until\.lt\.(.+)$/);
      if (lt) {
        const until = typeof row.lease_until === 'string' ? Date.parse(row.lease_until) : NaN;
        return !Number.isFinite(until) || until < Date.parse(lt[1]);
      }
      return false;
    });
  }

  const supabase = {
    from(table: string) {
      const api: any = {
        _filters: {} as Record<string, unknown>,
        _in: null as string[] | null,
        _or: null as string | null,
        select() {
          return api;
        },
        in(_col: string, vals: string[]) {
          api._in = vals;
          return api;
        },
        or(filter: string) {
          api._or = filter;
          return api;
        },
        order() {
          return api;
        },
        limit(n: number) {
          if (table === 'video_processing_jobs') {
            const rows = [...jobs.values()].filter((row) => {
              if (api._in && !api._in.includes(String(row.status))) return false;
              if (api._or && !matchesOr(api._or, row)) return false;
              return true;
            });
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        eq(col: string, val: unknown) {
          api._filters[col] = val;
          return api;
        },
        maybeSingle: async () => {
          if (table === 'video_processing_jobs' && api._filters.id) {
            const job = jobs.get(String(api._filters.id));
            if (!job) return { data: null, error: null };
            return {
              data: {
                ...job,
                verification_videos: videos.get(String(job.video_id)) ?? {
                  job_id: job.job_id,
                  status: 'queued',
                },
              },
              error: null,
            };
          }
          if (table === 'video_processing_jobs' && api._filters.idempotency_key) {
            for (const job of jobs.values()) {
              if (job.idempotency_key === api._filters.idempotency_key) {
                return { data: job, error: null };
              }
            }
            return { data: null, error: null };
          }
          if (table === 'video_processing_steps') {
            for (const step of steps.values()) {
              if (
                step.processing_job_id === api._filters.processing_job_id &&
                step.stage === api._filters.stage
              ) {
                return { data: step, error: null };
              }
            }
          }
          return { data: null, error: null };
        },
        insert(row: Record<string, unknown> | Record<string, unknown>[]) {
          if (table === 'video_processing_jobs') {
            const r = Array.isArray(row) ? row[0]! : row;
            const id = (r.id as string) ?? `job-${jobs.size + 1}`;
            jobs.set(id, { ...r, id, status: r.status ?? 'pending', attempt_count: 0 });
            return {
              select() {
                return {
                  single: async () => ({ data: jobs.get(id), error: null }),
                };
              },
            };
          }
          if (table === 'video_processing_steps') {
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) {
              const id = `step-${steps.size + 1}`;
              steps.set(id, { ...r, id, status: 'pending', attempt_count: 0 });
            }
            return { error: null };
          }
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          const chain: any = {
            _id: null as string | null,
            _or: null as string | null,
            _stepCol: null as string | null,
            _stepVal: null as string | null,
            eq(col: string, val: string) {
              if (col === 'id') chain._id = val;
              else {
                chain._stepCol = col;
                chain._stepVal = val;
              }
              return chain;
            },
            or(filter: string) {
              chain._or = filter;
              return chain;
            },
            select() {
              return chain;
            },
            apply() {
              if (table === 'video_processing_jobs' && chain._id) {
                const job = jobs.get(chain._id);
                if (!job) return null;
                if (chain._or && !matchesOr(chain._or, job)) return null;
                const next = { ...job, ...patch };
                jobs.set(chain._id, next);
                return next;
              }
              if (table === 'verification_videos' && chain._id) {
                const next = { ...(videos.get(chain._id) ?? {}), ...patch, id: chain._id };
                videos.set(chain._id, next);
                return next;
              }
              if (table === 'video_processing_steps') {
                if (chain._id) {
                  const step = steps.get(chain._id);
                  if (step) steps.set(chain._id, { ...step, ...patch });
                  return steps.get(chain._id) ?? null;
                }
                if (chain._stepCol) {
                  for (const [id, step] of steps) {
                    if (step[chain._stepCol] === chain._stepVal) {
                      steps.set(id, { ...step, ...patch });
                    }
                  }
                }
              }
              return null;
            },
            maybeSingle: async () => {
              const row = chain.apply();
              return { data: row, error: null };
            },
            then(resolve: (v: unknown) => void) {
              chain.apply();
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
      return api;
    },
  };

  return { supabase, jobs, steps, videos, advance: (ms: number) => (nowMs += ms) };
}

function handlers() {
  return {
    validate_video: async () => ({ output: { ok: true } }),
    extract_metadata: async () => ({ output: {} }),
    extract_frames: async () => ({ output: { frameCount: 0 } }),
    score_frame_quality: async () => ({ output: {} }),
    deduplicate_frames: async () => ({ output: {} }),
    classify_scenes: async () => ({ output: {} }),
    analyze_frames: async () => ({ output: {} }),
    compare_timeline: async () => ({ output: {} }),
    generate_verifications: async () => ({ output: {} }),
    calculate_confidence: async () => ({ output: {} }),
    finalize_report: async () => ({ output: { done: true } }),
  };
}

async function drained(q: { pending: number }) {
  const tick = () => new Promise((r) => setImmediate(r));
  for (let i = 0; i < 400 && q.pending > 0; i += 1) await tick();
}

describe('verification durable outbox', () => {
  it('completes a job after simulated restart with an empty in-memory queue', async () => {
    const db = memoryProcessingDb();
    db.videos.set('vid-1', { id: 'vid-1', job_id: 'job-1', status: 'uploaded' });

    const writer = new ProcessingOrchestrator({
      delaysMs: [],
      sleep: async () => undefined,
      handlers: handlers(),
    });
    const enq = await writer.enqueue({
      supabase: db.supabase,
      orgId: 'org-1',
      videoId: 'vid-1',
      jobId: 'job-1',
      idempotencyKey: 'vid-1:durable',
    });
    await drained(writer);
    // Force a crash mid-flight: row is back to pending, lease expired, memory gone.
    const stored = db.jobs.get(enq.processingJobId);
    assert.ok(stored);
    db.jobs.set(enq.processingJobId, {
      ...stored,
      status: 'running',
      lease_owner: 'pid-crashed',
      lease_until: new Date(Date.now() - 5_000).toISOString(),
      completed_at: null,
    });
    for (const [id, step] of db.steps) {
      if (step.processing_job_id === enq.processingJobId && step.stage === 'finalize_report') {
        db.steps.set(id, { ...step, status: 'pending', completed_at: null });
      }
    }

    const recovered = new ProcessingOrchestrator({
      delaysMs: [],
      sleep: async () => undefined,
      handlers: handlers(),
    });
    assert.equal(recovered.pending, 0);
    const claimed = await recovered.claimAndRun(db.supabase);
    assert.equal(claimed, true);
    assert.equal(db.jobs.get(enq.processingJobId)?.status, 'completed');
  });

  it('refuses to steal a live lease from another replica', async () => {
    const db = memoryProcessingDb();
    db.jobs.set('held-1', {
      id: 'held-1',
      org_id: 'org-1',
      video_id: 'vid-1',
      status: 'running',
      lease_owner: 'other-replica',
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
      attempt_count: 1,
    });
    const orch = new ProcessingOrchestrator({
      delaysMs: [],
      sleep: async () => undefined,
      handlers: handlers(),
    });
    const claimed = await orch.claimAndRun(db.supabase);
    assert.equal(claimed, false);
    assert.equal(db.jobs.get('held-1')?.lease_owner, 'other-replica');
  });
});
