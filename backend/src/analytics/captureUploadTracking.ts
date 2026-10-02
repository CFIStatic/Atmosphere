/**
 * Minimum upload-lifecycle tracking for Atmosphere Analytics.
 *
 * job_proofs only exists once a film is filed, so an upload that never
 * arrives left no trace. These calls record start (signed URL minted), each
 * retry, the finish (proof filed) and the last upload error code in
 * capture_upload_attempts via public.record_capture_upload (service role).
 *
 * Best-effort by contract: never awaited on the crew's critical path, never
 * throws. A missing analytics row is recoverable; a failed upload is not.
 */
import { HttpError } from '../lib/errors.js';

export type CaptureUploadEvent = 'start' | 'touch' | 'complete' | 'fail';

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Error codes worth counting as an upload failure (not validation of other fields). */
export function uploadFailureCode(err: unknown): string | null {
  if (err instanceof HttpError && typeof err.code === 'string' && err.code.startsWith('upload_')) {
    return err.code.slice(0, 64);
  }
  return null;
}

export function trackCaptureUpload(
  admin: unknown,
  input: {
    orgId: unknown;
    jobId?: unknown;
    uploadKey: unknown;
    event: CaptureUploadEvent;
    errorCode?: string | null;
  },
): void {
  try {
    const client = admin as RpcClient | null | undefined;
    if (!client || typeof client.rpc !== 'function') return;
    const orgId = typeof input.orgId === 'string' && UUID.test(input.orgId) ? input.orgId : null;
    const key = typeof input.uploadKey === 'string' ? input.uploadKey.trim().slice(0, 500) : '';
    if (!orgId || !key) return;
    const jobId = typeof input.jobId === 'string' && UUID.test(input.jobId) ? input.jobId : null;
    void Promise.resolve(
      client.rpc('record_capture_upload', {
        p_org: orgId,
        p_upload_key: key,
        p_event: input.event,
        p_job: jobId,
        p_error_code: input.errorCode ?? null,
      }),
    )
      .then((res) => {
        if (res?.error && !/does not exist|42883|PGRST202/i.test(res.error.message)) {
          console.warn('[analytics] upload tracking failed:', res.error.message);
        }
      })
      .catch(() => undefined);
  } catch {
    /* tracking must never break an upload */
  }
}
