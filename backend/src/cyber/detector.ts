import type { Request } from 'express';
import { SIGNATURES, isDecoyPath } from './signatures.js';
import type { ThreatSeverity, ThreatSignal } from './types.js';
import { randomUUID } from 'node:crypto';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

/**
 * Office writes carry user-typed titles, notes, and messages. Those strings
 * can look like SQL ("select from inventory", "drop table saws") without
 * being an attack. Body-injection signatures stay on for login and probe
 * surfaces; they must not 403 a job-file rename.
 */
const USER_CONTENT_API =
  /^\/api\/(operations|jobs|evidence-portal|crm|pm|sales)(\/|$)/i;

export function isUserContentApiPath(path: string): boolean {
  return USER_CONTENT_API.test(path);
}

/**
 * Score an inbound request against defensive signatures.
 *
 * Returns signals only — the agent decides whether to observe, deceive, or
 * block. Bodies are inspected as a short redacted string so we never log
 * secrets while still catching injection probes.
 */
export function detectThreats(req: Request): ThreatSignal[] {
  const signals: ThreatSignal[] = [];
  const path = decodeSafe(req.path || '/');
  const query = decodeSafe(typeof req.url === 'string' ? req.url.split('?')[1] ?? '' : '');
  const userAgent = String(req.headers['user-agent'] ?? '');
  const bodyText = redactBody(req.body);

  for (const sig of SIGNATURES) {
    if (sig.rule === 'protocol.unexpected_method') {
      if (!ALLOWED_METHODS.has((req.method || '').toUpperCase())) {
        signals.push(toSignal(sig));
      }
      continue;
    }

    if (sig.path && sig.path.test(path)) {
      signals.push(toSignal(sig));
      continue;
    }
    if (sig.query && query && sig.query.test(query)) {
      signals.push(toSignal(sig));
      continue;
    }
    if (sig.userAgent && sig.userAgent.test(userAgent)) {
      signals.push(toSignal(sig));
      continue;
    }
    if (sig.body && bodyText && sig.body.test(bodyText)) {
      if (sig.rule === 'injection.body' && isUserContentApiPath(path)) {
        continue;
      }
      signals.push(toSignal(sig));
      continue;
    }
    if (sig.header) {
      const value = headerValue(req, sig.header.name);
      if (value && sig.header.pattern.test(value)) {
        signals.push(toSignal(sig));
      }
    }
  }

  // Decoy paths always count even if the regex set drifts — keep them loud.
  if (isDecoyPath(path) && !signals.some((s) => s.rule === 'honeypot.path')) {
    signals.push({
      id: randomUUID(),
      category: 'honeypot',
      severity: 'high',
      reason: 'Request hit a registered decoy path.',
      score: 70,
      rule: 'honeypot.path',
    });
  }

  // Burst of 404-shaped probes on non-API paths from the same request is
  // handled at the agent layer via path class; here we only add a light signal
  // when someone aims outside /api and / (SPA) with a suspicious extension.
  if (/\.(php|asp|aspx|jsp|cgi)$/i.test(path) && !path.startsWith('/api/')) {
    signals.push({
      id: randomUUID(),
      category: 'recon',
      severity: 'medium',
      reason: 'Legacy server-script extension probe on a Node API.',
      score: 35,
      rule: 'recon.legacy_extension',
    });
  }

  return dedupeSignals(signals);
}

export function aggregateScore(signals: ThreatSignal[]): number {
  if (signals.length === 0) return 0;
  // Soft-cap overlapping signatures so one request cannot score past 100.
  const raw = signals.reduce((sum, s) => sum + s.score, 0);
  return Math.min(100, raw);
}

export function severityForScore(score: number, signals: ThreatSignal[]): ThreatSeverity {
  const fromSignals = signals.reduce<ThreatSeverity>((worst, s) => {
    return rank(s.severity) > rank(worst) ? s.severity : worst;
  }, 'info');

  let fromScore: ThreatSeverity = 'info';
  if (score >= 85) fromScore = 'critical';
  else if (score >= 70) fromScore = 'high';
  else if (score >= 40) fromScore = 'medium';
  else if (score >= 15) fromScore = 'low';

  return rank(fromSignals) >= rank(fromScore) ? fromSignals : fromScore;
}

function toSignal(sig: (typeof SIGNATURES)[number]): ThreatSignal {
  return {
    id: randomUUID(),
    category: sig.category,
    severity: sig.severity,
    reason: sig.reason,
    score: sig.score,
    rule: sig.rule,
  };
}

function dedupeSignals(signals: ThreatSignal[]): ThreatSignal[] {
  const seen = new Set<string>();
  const out: ThreatSignal[] = [];
  for (const s of signals) {
    if (seen.has(s.rule)) continue;
    seen.add(s.rule);
    out.push(s);
  }
  return out;
}

function rank(s: ThreatSeverity): number {
  switch (s) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(',');
  return raw;
}

/**
 * Bodies can hold passwords and tokens. We only keep a short, key-redacted
 * string for signature matching — never stored on the event.
 */
function redactBody(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body.slice(0, 2_000);
  if (typeof body !== 'object') return String(body).slice(0, 2_000);

  try {
    const clone = JSON.parse(JSON.stringify(body)) as unknown;
    scrub(clone);
    return JSON.stringify(clone).slice(0, 2_000);
  } catch {
    return '';
  }
}

const SECRET_KEYS = /pass(word)?|secret|token|authorization|api[_-]?key|cookie|credential|pin/i;

function scrub(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) scrub(item);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SECRET_KEYS.test(key)) {
      obj[key] = '[redacted]';
    } else {
      scrub(obj[key]);
    }
  }
}

export function clientIp(req: Request): string {
  // trust proxy is set on the app; Express already resolves req.ip.
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  // Normalize IPv4-mapped IPv6.
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
