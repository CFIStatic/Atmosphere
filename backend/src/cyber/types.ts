/**
 * Shared types for the Atmosphere Cyber Defense Agent.
 *
 * This agent is defensive only: it watches the BFF, scores hostile traffic,
 * blocks bad actors, serves decoys that keep attackers away from real data,
 * and applies runtime hardening ("auto-patch"). It never generates exploits.
 */

export type ThreatSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ThreatCategory =
  | 'recon'
  | 'injection'
  | 'traversal'
  | 'auth_abuse'
  | 'scanner'
  | 'honeypot'
  | 'anomaly'
  | 'protocol';

export type DefenseAction =
  | 'observe'
  | 'deceive'
  | 'throttle'
  | 'block'
  | 'patch';

export interface ThreatSignal {
  id: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  /** Human-readable reason recorded in the event log. */
  reason: string;
  /** Contribution to the request's threat score (0–100). */
  score: number;
  /** Signature or rule that fired. */
  rule: string;
}

export interface ThreatEvent {
  id: string;
  at: string;
  ip: string;
  method: string;
  path: string;
  userAgent: string;
  signals: ThreatSignal[];
  score: number;
  severity: ThreatSeverity;
  action: DefenseAction;
  blocked: boolean;
  decoy?: string | null;
  userId?: string | null;
  requestId: string;
}

export interface BlockRecord {
  ip: string;
  reason: string;
  score: number;
  severity: ThreatSeverity;
  blockedAt: string;
  expiresAt: string | null;
  hits: number;
  lastSeenAt: string;
  /** True when the IP was caught on a honeypot / decoy path. */
  deceived: boolean;
}

export type PatchKind =
  | 'headers'
  | 'config'
  | 'blocklist'
  | 'deception'
  | 'runtime';

export interface PatchResult {
  id: string;
  at: string;
  kind: PatchKind;
  title: string;
  detail: string;
  applied: boolean;
  /** What would still be open if the patch could not be applied. */
  residualRisk?: string | null;
}

export interface CyberStatus {
  enabled: boolean;
  monitoring: boolean;
  deception: boolean;
  autoPatch: boolean;
  autoBlock: boolean;
  blockedIps: number;
  eventsLastHour: number;
  eventsTotal: number;
  patchesApplied: number;
  lastEventAt: string | null;
  lastPatchAt: string | null;
  underAttack: boolean;
  attackScore: number;
}
