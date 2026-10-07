import type { BillingOnboardingStatus } from './api';

type Loader = () => Promise<BillingOnboardingStatus>;

/**
 * One billing-onboarding GET shared by sign-in prefetch, the billing gate, and
 * the job file's action lock. Concurrent callers share the in-flight request,
 * and a result is reused for a few seconds so opening a job right after
 * sign-in does not repeat it. Failures are never cached.
 */
const REUSE_MS = 15_000;
let inflight: Promise<BillingOnboardingStatus> | null = null;
let cached: { at: number; value: BillingOnboardingStatus } | null = null;

export function getBillingOnboardingShared(load: Loader): Promise<BillingOnboardingStatus> {
  if (cached && Date.now() - cached.at < REUSE_MS) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  const p = load()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/** Warm the shared request; errors are ignored here and surface to real callers. */
export function prefetchBillingOnboarding(load: Loader): void {
  getBillingOnboardingShared(load).catch(() => {});
}

export function resetBillingOnboardingShared(): void {
  inflight = null;
  cached = null;
}
