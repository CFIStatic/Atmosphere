import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { cyberStore } from './store.js';
import type { PatchResult } from './types.js';

/**
 * Auto-patcher — runtime hardening for the Atmosphere BFF.
 *
 * "Patch" here means defensive configuration and state fixes the agent can
 * apply without a deploy: rotate decoy credentials so stolen dumps go stale,
 * expire dead blocks, raise attack posture flags, and audit config for known
 * weak defaults. It does not download remote code or run shell patches.
 */

export interface HardeningContext {
  /** Extra security headers the monitor should attach on every response. */
  securityHeaders: Record<string, string>;
  /** When under attack, reject unauthenticated probes more aggressively. */
  elevated: boolean;
  elevatedUntil: number | null;
}

const hardening: HardeningContext = {
  securityHeaders: {
    'X-Atmosphere-Defense': '1',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  },
  elevated: false,
  elevatedUntil: null,
};

export function getHardeningContext(): HardeningContext {
  if (hardening.elevatedUntil && Date.now() > hardening.elevatedUntil) {
    hardening.elevated = false;
    hardening.elevatedUntil = null;
  }
  return hardening;
}

export function applySecurityHeaders(setHeader: (name: string, value: string) => void): void {
  const ctx = getHardeningContext();
  for (const [name, value] of Object.entries(ctx.securityHeaders)) {
    setHeader(name, value);
  }
}

/**
 * Run one auto-patch cycle. Safe to call from the scheduler or after a spike.
 */
export function runAutoPatch(reason: string): PatchResult[] {
  const results: PatchResult[] = [];

  results.push(rotateDecoys(reason));
  results.push(expireBlocks(reason));
  results.push(auditConfig(reason));
  results.push(elevateIfNeeded(reason));
  results.push(ensureHeaders(reason));

  return results;
}

function rotateDecoys(reason: string): PatchResult {
  const { rotatedAt } = cyberStore.rotateDecoyToken();
  const patch: PatchResult = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'deception',
    title: 'Rotated decoy credentials',
    detail: `Ephemeral honeypot secrets rotated (${reason}) at ${rotatedAt}. Scraped dumps are now stale.`,
    applied: true,
  };
  cyberStore.recordPatch(patch);
  return patch;
}

function expireBlocks(reason: string): PatchResult {
  const removed = cyberStore.expireBlocks();
  const patch: PatchResult = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'blocklist',
    title: 'Expired stale IP blocks',
    detail: `Removed ${removed} expired block(s) (${reason}). Active offenders remain banned.`,
    applied: true,
  };
  cyberStore.recordPatch(patch);
  return patch;
}

function auditConfig(reason: string): PatchResult {
  const findings: string[] = [];

  if (!config.isProduction) {
    findings.push('Running in development — production hardenings (secure cookies, backup key) are relaxed by design.');
  }
  if (config.isProduction && config.billing.allowClientMetering) {
    findings.push('ALLOW_CLIENT_METERING is on in production — clients could under-report usage.');
  }
  if (config.webAccess.allowPrivateAddresses) {
    findings.push('WEB_ACCESS_ALLOW_PRIVATE is on — SSRF guard is intentionally loosened for local sites.');
  }
  if (!config.supabase.serviceRoleKey) {
    findings.push('SUPABASE_SERVICE_ROLE_KEY unset — privileged schedulers stay off (safe default).');
  }
  if (config.backups.enabled && !config.backups.encryptionKey && !config.isProduction) {
    findings.push('Backup encryption key unset in development — archives would be written in the clear.');
  }

  const patch: PatchResult = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'config',
    title: 'Configuration hardening audit',
    detail:
      findings.length === 0
        ? `No weak-config findings (${reason}).`
        : `Findings (${reason}): ${findings.join(' ')}`,
    applied: findings.length === 0,
    residualRisk: findings.length ? findings.join(' ') : null,
  };
  cyberStore.recordPatch(patch);
  return patch;
}

function elevateIfNeeded(reason: string): PatchResult {
  const status = cyberStore.status({
    enabled: true,
    monitoring: true,
    deception: true,
    autoPatch: true,
    autoBlock: true,
  });

  if (status.underAttack) {
    hardening.elevated = true;
    hardening.elevatedUntil = Date.now() + 30 * 60 * 1000;
    const patch: PatchResult = {
      id: randomUUID(),
      at: new Date().toISOString(),
      kind: 'runtime',
      title: 'Elevated defense posture',
      detail: `Under-attack score ${status.attackScore} in the last hour (${reason}). Decoy tarpits stay on; blocked IPs remain refused.`,
      applied: true,
    };
    cyberStore.recordPatch(patch);
    return patch;
  }

  const patch: PatchResult = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'runtime',
    title: 'Defense posture normal',
    detail: `Attack score ${status.attackScore} — no elevation (${reason}).`,
    applied: true,
  };
  cyberStore.recordPatch(patch);
  return patch;
}

function ensureHeaders(reason: string): PatchResult {
  // Headers are applied per-response by the monitor; this records that the
  // patch set is loaded.
  const names = Object.keys(hardening.securityHeaders).join(', ');
  const patch: PatchResult = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'headers',
    title: 'Security response headers armed',
    detail: `Active headers (${reason}): ${names}`,
    applied: true,
  };
  cyberStore.recordPatch(patch);
  return patch;
}
