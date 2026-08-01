import { randomBytes, randomUUID } from 'node:crypto';
import type {
  BlockRecord,
  CyberStatus,
  PatchResult,
  ThreatEvent,
  ThreatSeverity,
} from './types.js';

/**
 * In-process store for the Cyber Defense Agent.
 *
 * Events and blocks live in memory so defense works even when the database is
 * unreachable — a security agent that depends on the thing it is protecting is
 * useless during an incident. Persistence is best-effort and optional.
 *
 * Limits keep memory bounded under a spray of probes.
 */

const MAX_EVENTS = 2_000;
const MAX_PATCHES = 200;
const MAX_BLOCKS = 5_000;

function nowIso(): string {
  return new Date().toISOString();
}

export class CyberStore {
  private readonly events: ThreatEvent[] = [];
  private readonly blocks = new Map<string, BlockRecord>();
  private readonly patches: PatchResult[] = [];
  /** Ephemeral decoy "secrets" rotated so scavenged dumps go stale. */
  private decoyToken = randomBytes(24).toString('hex');
  private decoyRotatedAt = nowIso();
  private eventsTotal = 0;

  nextRequestId(): string {
    return randomUUID();
  }

  rotateDecoyToken(): { token: string; rotatedAt: string } {
    this.decoyToken = randomBytes(24).toString('hex');
    this.decoyRotatedAt = nowIso();
    return { token: this.decoyToken, rotatedAt: this.decoyRotatedAt };
  }

  getDecoyToken(): string {
    return this.decoyToken;
  }

  getDecoyRotatedAt(): string {
    return this.decoyRotatedAt;
  }

  recordEvent(event: ThreatEvent): ThreatEvent {
    this.eventsTotal += 1;
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    return event;
  }

  listEvents(limit = 100): ThreatEvent[] {
    const n = Math.max(1, Math.min(limit, MAX_EVENTS));
    return this.events.slice(-n).reverse();
  }

  eventsSince(msAgo: number): ThreatEvent[] {
    const cutoff = Date.now() - msAgo;
    return this.events.filter((e) => Date.parse(e.at) >= cutoff);
  }

  getBlock(ip: string): BlockRecord | undefined {
    const block = this.blocks.get(ip);
    if (!block) return undefined;
    if (block.expiresAt && Date.parse(block.expiresAt) <= Date.now()) {
      this.blocks.delete(ip);
      return undefined;
    }
    return block;
  }

  isBlocked(ip: string): boolean {
    return Boolean(this.getBlock(ip));
  }

  upsertBlock(input: {
    ip: string;
    reason: string;
    score: number;
    severity: ThreatSeverity;
    ttlMs: number | null;
    deceived?: boolean;
  }): BlockRecord {
    const existing = this.blocks.get(input.ip);
    const now = nowIso();
    const expiresAt =
      input.ttlMs === null ? null : new Date(Date.now() + input.ttlMs).toISOString();

    const record: BlockRecord = existing
      ? {
          ...existing,
          reason: input.reason,
          score: Math.max(existing.score, input.score),
          severity: worseSeverity(existing.severity, input.severity),
          hits: existing.hits + 1,
          lastSeenAt: now,
          expiresAt,
          deceived: existing.deceived || Boolean(input.deceived),
        }
      : {
          ip: input.ip,
          reason: input.reason,
          score: input.score,
          severity: input.severity,
          blockedAt: now,
          expiresAt,
          hits: 1,
          lastSeenAt: now,
          deceived: Boolean(input.deceived),
        };

    this.blocks.set(input.ip, record);

    // Bound the map: drop the oldest by lastSeenAt when over capacity.
    if (this.blocks.size > MAX_BLOCKS) {
      const oldest = [...this.blocks.entries()].sort(
        (a, b) => Date.parse(a[1].lastSeenAt) - Date.parse(b[1].lastSeenAt),
      )[0];
      if (oldest) this.blocks.delete(oldest[0]);
    }

    return record;
  }

  touchBlock(ip: string): void {
    const block = this.getBlock(ip);
    if (!block) return;
    block.hits += 1;
    block.lastSeenAt = nowIso();
  }

  unblock(ip: string): boolean {
    return this.blocks.delete(ip);
  }

  listBlocks(): BlockRecord[] {
    // Expire while listing so the API never shows stale entries.
    for (const ip of [...this.blocks.keys()]) {
      this.getBlock(ip);
    }
    return [...this.blocks.values()].sort(
      (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
    );
  }

  expireBlocks(): number {
    let removed = 0;
    for (const [ip, block] of this.blocks) {
      if (block.expiresAt && Date.parse(block.expiresAt) <= Date.now()) {
        this.blocks.delete(ip);
        removed += 1;
      }
    }
    return removed;
  }

  recordPatch(patch: PatchResult): PatchResult {
    this.patches.push(patch);
    if (this.patches.length > MAX_PATCHES) {
      this.patches.splice(0, this.patches.length - MAX_PATCHES);
    }
    return patch;
  }

  listPatches(limit = 50): PatchResult[] {
    const n = Math.max(1, Math.min(limit, MAX_PATCHES));
    return this.patches.slice(-n).reverse();
  }

  status(flags: {
    enabled: boolean;
    monitoring: boolean;
    deception: boolean;
    autoPatch: boolean;
    autoBlock: boolean;
  }): CyberStatus {
    const hour = this.eventsSince(60 * 60 * 1000);
    const attackScore = hour.reduce((sum, e) => sum + e.score, 0);
    const lastEvent = this.events[this.events.length - 1];
    const lastPatch = this.patches[this.patches.length - 1];

    return {
      enabled: flags.enabled,
      monitoring: flags.monitoring,
      deception: flags.deception,
      autoPatch: flags.autoPatch,
      autoBlock: flags.autoBlock,
      blockedIps: this.listBlocks().length,
      eventsLastHour: hour.length,
      eventsTotal: this.eventsTotal,
      patchesApplied: this.patches.filter((p) => p.applied).length,
      lastEventAt: lastEvent?.at ?? null,
      lastPatchAt: lastPatch?.at ?? null,
      // Sustained hostile score in the last hour — not a single probe.
      underAttack: attackScore >= 400 || hour.filter((e) => e.score >= 70).length >= 8,
      attackScore,
    };
  }
}

const SEVERITY_RANK: Record<ThreatSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function worseSeverity(a: ThreatSeverity, b: ThreatSeverity): ThreatSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Process-wide singleton — one agent watches the whole BFF. */
export const cyberStore = new CyberStore();
