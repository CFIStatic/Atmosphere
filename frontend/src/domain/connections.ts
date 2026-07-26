import type { AgentCapability, Connection, ConnectionStatus } from './types';

/**
 * Rules about connected systems.
 *
 * The interesting question is never "is this integration green?" — it is "what
 * can the business no longer do?". A restoration shop does not care that an
 * OAuth token expired; it cares that nobody is chasing receivables. These
 * helpers translate connection state into that answer, and they live here rather
 * than in the page so the translation is testable and identical everywhere it
 * is asked.
 */

/** Reachable at all — includes degraded and errored, which are still configured. */
export function isLive(connection: Connection): boolean {
  return (
    connection.status === 'connected' ||
    connection.status === 'degraded' ||
    connection.status === 'error'
  );
}

/** Configured but not working. These are the ones a human has to act on. */
export function needsAttention(connection: Connection): boolean {
  return connection.status === 'degraded' || connection.status === 'error';
}

/** Fully working. Only these count as coverage for a capability. */
export function isHealthy(connection: Connection): boolean {
  return connection.status === 'connected';
}

/**
 * Capabilities that some connection claims to power, but which currently have
 * no healthy system behind them.
 *
 * Degraded counts as *not* covered on purpose: an agent reading half-stale data
 * is more dangerous than one that knows it is blind, because it will act with
 * false confidence.
 */
export function blindCapabilities(connections: Connection[]): AgentCapability[] {
  const covered = new Set(connections.filter(isHealthy).flatMap((c) => c.powers));
  const claimed = new Set(connections.flatMap((c) => c.powers));
  return [...claimed].filter((cap) => !covered.has(cap)).sort();
}

/** Every healthy system standing behind a given capability. */
export function connectionsPowering(
  connections: Connection[],
  capability: AgentCapability,
): Connection[] {
  return connections.filter((c) => isHealthy(c) && c.powers.includes(capability));
}

export interface CoverageSummary {
  live: number;
  healthy: number;
  attention: number;
  available: number;
  total: number;
}

export function summarise(connections: Connection[]): CoverageSummary {
  return {
    live: connections.filter(isLive).length,
    healthy: connections.filter(isHealthy).length,
    attention: connections.filter(needsAttention).length,
    available: connections.filter((c) => !isLive(c)).length,
    total: connections.length,
  };
}

/**
 * Catalogue ordering within a category: working systems first, then the ones
 * most shops already run, then alphabetical. Putting a connected system below an
 * unconfigured one would bury the thing the operator came to check.
 */
export function compareForCatalogue(a: Connection, b: Connection): number {
  if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1;
  if (a.popular !== b.popular) return a.popular ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Statuses a user can act on directly, versus ones that need someone else. */
export function isActionable(status: ConnectionStatus): boolean {
  return status !== 'coming_soon';
}
