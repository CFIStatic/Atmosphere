import { cyberStore } from './store.js';
import type { ThreatSeverity } from './types.js';

/**
 * Blocklist helpers — route bad actors out of Atmosphere immediately.
 *
 * Blocks are IP-based with a TTL. Honeypot hits and critical scores get longer
 * bans. Manual unblock is available through the cyber API for false positives.
 */

const HOUR = 60 * 60 * 1000;

export function ttlFor(severity: ThreatSeverity, deceived: boolean): number {
  if (deceived) return 24 * HOUR;
  switch (severity) {
    case 'critical':
      return 12 * HOUR;
    case 'high':
      return 6 * HOUR;
    case 'medium':
      return 2 * HOUR;
    case 'low':
      return 30 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

export function blockIp(input: {
  ip: string;
  reason: string;
  score: number;
  severity: ThreatSeverity;
  deceived?: boolean;
}): ReturnType<typeof cyberStore.upsertBlock> {
  const deceived = Boolean(input.deceived);
  return cyberStore.upsertBlock({
    ip: input.ip,
    reason: input.reason,
    score: input.score,
    severity: input.severity,
    ttlMs: ttlFor(input.severity, deceived),
    deceived,
  });
}

export function isIpBlocked(ip: string): boolean {
  return cyberStore.isBlocked(ip);
}

export function noteBlockedHit(ip: string): void {
  cyberStore.touchBlock(ip);
}

export function unblockIp(ip: string): boolean {
  return cyberStore.unblock(ip);
}
