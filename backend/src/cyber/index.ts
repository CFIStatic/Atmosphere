/**
 * Atmosphere Cyber Defense Agent — public surface.
 *
 * Monitors every request, blocks hostile IPs, serves honeypot decoys that keep
 * attackers away from real data, and auto-patches runtime hardening.
 */

export { cyberMonitor } from './monitor.js';
export { startCyberScheduler, stopCyberScheduler, triggerCyberPatch, cyberSnapshot } from './scheduler.js';
export { cyberStore, CyberStore } from './store.js';
export { detectThreats, aggregateScore, severityForScore, clientIp } from './detector.js';
export { isDecoyPath, DECOY_PATHS, SIGNATURES } from './signatures.js';
export { buildDecoy, classifyDecoy } from './deception.js';
export { blockIp, unblockIp, isIpBlocked, ttlFor } from './blocker.js';
export { runAutoPatch, getHardeningContext } from './autoPatch.js';
export type {
  ThreatEvent,
  ThreatSignal,
  BlockRecord,
  PatchResult,
  CyberStatus,
  ThreatSeverity,
  DefenseAction,
} from './types.js';
