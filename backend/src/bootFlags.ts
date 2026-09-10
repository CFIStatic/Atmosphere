/**
 * Boot-time helpers that must be safe to evaluate without importing the full
 * config singleton (tests, and production deploys that omit optional secrets).
 */

/**
 * Railway (and most PaaS healthchecks) probe IPv4. Listening on 127.0.0.1
 * or IPv6-only `::` makes the process look down: "service unavailable".
 */
export function listenHost(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.HOST?.trim();
  if (!raw || raw === 'localhost' || raw === '127.0.0.1' || raw === '::1') {
    return '0.0.0.0';
  }
  return raw;
}

/**
 * How this process participates in sold-path queue work.
 *
 *   all   — default. HTTP + durable worker (one Railway service).
 *   http  — API only. Writes outbox rows; does not claim or run them.
 *   queue — worker + health. Same image; set WORKER_ROLE=queue on a
 *           second Railway service if you split API from processing.
 */
export type WorkerRole = 'all' | 'http' | 'queue';

export function resolveWorkerRole(env: NodeJS.Dict<string> = process.env): WorkerRole {
  const raw = (env.WORKER_ROLE ?? env.ATMOSPHERE_WORKER_ROLE ?? 'all').trim().toLowerCase();
  if (raw === 'http' || raw === 'api') return 'http';
  if (raw === 'queue' || raw === 'worker') return 'queue';
  return 'all';
}

export function shouldRunSoldPathWorkers(role: WorkerRole = resolveWorkerRole()): boolean {
  return role !== 'http';
}

export function isHealthProbePath(path: string): boolean {
  return (
    path === '/' ||
    path === '/health' ||
    path === '/ready' ||
    path === '/api' ||
    path === '/api/' ||
    path === '/api/health' ||
    path === '/api/ready'
  );
}
