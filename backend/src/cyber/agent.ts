import type { Request, Response } from 'express';
import { isHealthProbePath } from '../bootFlags.js';
import { config } from '../config.js';
import {
  aggregateScore,
  clientIp,
  detectThreats,
  isPublicAuthPath,
  isUnblockableIp,
  severityForScore,
} from './detector.js';
import { blockIp, isIpBlocked, noteBlockedHit } from './blocker.js';
import { sendDecoy } from './deception.js';
import { isDecoyPath } from './signatures.js';
import { applySecurityHeaders, getHardeningContext } from './autoPatch.js';
import { cyberStore } from './store.js';
import type { DefenseAction, ThreatEvent } from './types.js';

/**
 * Cyber Defense Agent — observe, decide, respond.
 *
 * Pipeline for every request when monitoring is on:
 *   1. Apply hardening headers.
 *   2. If the IP is blocked → refuse immediately (no real handler runs),
 *      except sign-in / recovery and hops we must not ban (private / loopback).
 *   3. Score the request against defensive signatures.
 *   4. Honeypot / decoy paths → deceive (fake success), raise score, often block.
 *   5. High score on a real path → block and refuse (never on /api/auth/*).
 *   6. Otherwise observe and continue to the real app.
 */

const BLOCK_SCORE = 70;
const OBSERVE_SCORE = 15;

export interface InspectResult {
  /** When true, the agent already wrote the response — skip the rest of the stack. */
  handled: boolean;
  event: ThreatEvent | null;
}

export async function inspectRequest(req: Request, res: Response): Promise<InspectResult> {
  if (!config.cyber.enabled || !config.cyber.monitoring) {
    return { handled: false, event: null };
  }

  if (isHealthProbePath(req.path || '/')) {
    return { handled: false, event: null };
  }

  applySecurityHeaders((name, value) => {
    if (!res.getHeader(name)) res.setHeader(name, value);
  });

  const ip = clientIp(req);
  const path = req.path || '/';
  const authPath = isPublicAuthPath(path);
  const unblockable = isUnblockableIp(ip);
  const requestId = (req.headers['x-request-id'] as string | undefined) || cyberStore.nextRequestId();
  res.setHeader('X-Request-Id', requestId);

  // Already banned — do not touch real handlers. Sign-in must still work:
  // a shared office NAT or a leftover honeypot hit must not print Forbidden
  // on /login. Private hops are the nginx front door, not a client.
  if (config.cyber.autoBlock && isIpBlocked(ip) && !authPath && !unblockable) {
    noteBlockedHit(ip);
    const event = record({
      req,
      ip,
      requestId,
      signals: [],
      score: 100,
      action: 'block',
      blocked: true,
      decoy: null,
    });
    refuse(res, 'blocked');
    return { handled: true, event };
  }

  const signals = detectThreats(req);
  const score = aggregateScore(signals);
  const decoyHit = config.cyber.deception && isDecoyPath(path);

  if (decoyHit) {
    const decoy = await sendDecoy(req, res);
    let blocked = false;
    let action: DefenseAction = 'deceive';

    if (config.cyber.autoBlock && score >= BLOCK_SCORE && !unblockable) {
      blockIp({
        ip,
        reason: signals.map((s) => s.reason).join(' ') || 'Honeypot hit',
        score,
        severity: severityForScore(score, signals),
        deceived: true,
      });
      blocked = true;
      action = 'block';
    }

    const event = record({
      req,
      ip,
      requestId,
      signals,
      score: Math.max(score, 70),
      action,
      blocked,
      decoy: decoy.kind,
    });
    return { handled: true, event };
  }

  if (signals.length === 0 || score < OBSERVE_SCORE) {
    // Quiet traffic — still attach headers, no event noise.
    if (getHardeningContext().elevated && looksLikeProbe(path, req.method)) {
      // Under attack: soft-refuse anonymous junk outside /api to shrink noise.
      if (!path.startsWith('/api/') && path !== '/' && !path.startsWith('/assets')) {
        const event = record({
          req,
          ip,
          requestId,
          signals: [
            {
              id: cyberStore.nextRequestId(),
              category: 'anomaly',
              severity: 'low',
              reason: 'Elevated posture: non-API probe refused.',
              score: 20,
              rule: 'anomaly.elevated_refuse',
            },
          ],
          score: 20,
          action: 'throttle',
          blocked: false,
          decoy: null,
        });
        res.status(404).json({ error: 'Not found', code: 'not_found' });
        return { handled: true, event };
      }
    }
    return { handled: false, event: null };
  }

  const severity = severityForScore(score, signals);
  let action: DefenseAction = 'observe';
  let blocked = false;

  if (config.cyber.autoBlock && score >= BLOCK_SCORE && !authPath && !unblockable) {
    blockIp({
      ip,
      reason: signals.map((s) => s.reason).join(' '),
      score,
      severity,
      deceived: false,
    });
    blocked = true;
    action = 'block';
    const event = record({
      req,
      ip,
      requestId,
      signals,
      score,
      action,
      blocked,
      decoy: null,
    });
    refuse(res, 'blocked');
    return { handled: true, event };
  }

  const event = record({
    req,
    ip,
    requestId,
    signals,
    score,
    action,
    blocked,
    decoy: null,
  });
  return { handled: false, event };
}

function record(input: {
  req: Request;
  ip: string;
  requestId: string;
  signals: ThreatEvent['signals'];
  score: number;
  action: DefenseAction;
  blocked: boolean;
  decoy: string | null;
}): ThreatEvent {
  const severity = severityForScore(input.score, input.signals);
  const event: ThreatEvent = {
    id: cyberStore.nextRequestId(),
    at: new Date().toISOString(),
    ip: input.ip,
    method: input.req.method || 'GET',
    path: input.req.path || '/',
    userAgent: String(input.req.headers['user-agent'] ?? '').slice(0, 300),
    signals: input.signals,
    score: input.score,
    severity,
    action: input.action,
    blocked: input.blocked,
    decoy: input.decoy,
    userId: input.req.user?.id ?? null,
    requestId: input.requestId,
  };
  cyberStore.recordEvent(event);

  if (input.score >= 40) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cyber] ${event.action} score=${event.score} ${event.method} ${event.path} ip=${event.ip} rules=${event.signals.map((s) => s.rule).join(',')}`,
    );
  }

  return event;
}

function refuse(res: Response, code: 'blocked'): void {
  res.setHeader('Cache-Control', 'no-store');
  // Generic message — do not teach attackers what tripped the wire.
  res.status(403).json({
    error: 'Forbidden',
    code,
  });
}

function looksLikeProbe(path: string, method: string): boolean {
  if ((method || 'GET').toUpperCase() !== 'GET') return true;
  return (
    path.includes('..') ||
    /\.(php|asp|aspx|jsp|cgi|sql|zip|tar|gz|bak|old)$/i.test(path) ||
    path.startsWith('/.') ||
    /wp-|phpmyadmin|adminer|cgi-bin|actuator|telescope/i.test(path)
  );
}
