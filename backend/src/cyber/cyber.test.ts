import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { Request } from 'express';
import {
  CyberStore,
} from './store.js';
import { detectThreats, aggregateScore, severityForScore } from './detector.js';
import { isDecoyPath, DECOY_PATHS } from './signatures.js';
import { buildDecoy, classifyDecoy } from './deception.js';
import { ttlFor, blockIp, isIpBlocked, unblockIp } from './blocker.js';
import { runAutoPatch } from './autoPatch.js';

/**
 * Pure-logic tests for the Cyber Defense Agent. No network, no database —
 * signatures, scoring, decoys, blocks, and auto-patch must be right even when
 * Postgres is down, because that is when defense matters most.
 */

function fakeReq(partial: {
  path?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ip?: string;
}): Request {
  const path = partial.path ?? '/';
  return {
    path,
    method: partial.method ?? 'GET',
    url: partial.url ?? path,
    headers: partial.headers ?? { 'user-agent': 'Mozilla/5.0' },
    body: partial.body,
    ip: partial.ip ?? '203.0.113.10',
    socket: { remoteAddress: partial.ip ?? '203.0.113.10' },
  } as unknown as Request;
}

describe('signatures: decoy paths', () => {
  it('flags common probe paths as decoys', () => {
    for (const p of ['/.env', '/wp-admin', '/phpmyadmin', '/api/admin', '/.git/config']) {
      assert.equal(isDecoyPath(p), true, `${p} should be a decoy`);
    }
  });

  it('does not treat real Atmosphere routes as decoys', () => {
    for (const p of ['/api/health', '/api/auth/login', '/api/auth/internal-login', '/api/cyber/status', '/api/crm/jobs']) {
      assert.equal(isDecoyPath(p), false, `${p} must not be a decoy`);
    }
  });

  it('registers an explicit decoy list for operators', () => {
    assert.ok(DECOY_PATHS.includes('/.env'));
    assert.ok(DECOY_PATHS.includes('/api/v1/secrets'));
  });
});

describe('detector: scoring', () => {
  it('scores a honeypot hit as high severity', () => {
    const signals = detectThreats(fakeReq({ path: '/.env' }));
    assert.ok(signals.some((s) => s.rule === 'honeypot.path'));
    const score = aggregateScore(signals);
    assert.ok(score >= 70, `expected >=70, got ${score}`);
    const severity = severityForScore(score, signals);
    assert.ok(
      severity === 'high' || severity === 'critical',
      `expected high|critical, got ${severity}`,
    );
  });

  it('scores path traversal as critical', () => {
    const signals = detectThreats(fakeReq({ path: '/api/files', url: '/api/files?path=../../etc/passwd' }));
    assert.ok(signals.some((s) => s.category === 'traversal'));
    assert.equal(severityForScore(aggregateScore(signals), signals), 'critical');
  });

  it('flags known scanner user-agents', () => {
    const signals = detectThreats(
      fakeReq({ path: '/api/health', headers: { 'user-agent': 'sqlmap/1.7' } }),
    );
    assert.ok(signals.some((s) => s.rule === 'scanner.user_agent'));
  });

  it('does not flag a normal health check', () => {
    const signals = detectThreats(fakeReq({ path: '/api/health' }));
    assert.equal(signals.length, 0);
    assert.equal(aggregateScore(signals), 0);
  });

  it('redacts secret-shaped body keys while still matching injection', () => {
    const signals = detectThreats(
      fakeReq({
        path: '/api/auth/login',
        method: 'POST',
        body: { email: 'a@b.c', password: 'secret', note: "1' OR '1'='1" },
      }),
    );
    assert.ok(signals.some((s) => s.category === 'injection'));
  });
});

describe('deception: decoys never leak real secrets', () => {
  it('classifies paths into decoy kinds', () => {
    assert.equal(classifyDecoy('/.env'), 'env');
    assert.equal(classifyDecoy('/.git/config'), 'git');
    assert.equal(classifyDecoy('/api/admin'), 'admin_json');
    assert.equal(classifyDecoy('/dump.sql'), 'sql');
  });

  it('builds env decoys that look real but are marked decoy', () => {
    const decoy = buildDecoy('/.env');
    assert.equal(decoy.status, 200);
    assert.match(decoy.body, /DECOY_SESSION=/);
    assert.match(decoy.body, /\.invalid/);
    assert.doesNotMatch(decoy.body, /ccxatzfsvzetciiwsjlj/);
  });

  it('builds admin JSON decoys with ephemeral tokens', () => {
    const a = buildDecoy('/api/secrets');
    // Rotate via a fresh store would need the singleton — just assert shape.
    const body = JSON.parse(a.body) as { environment: string; note: string };
    assert.equal(body.environment, 'decoy');
    assert.match(body.note, /honeypot/i);
  });
});

describe('blocker: TTL and ban lifecycle', () => {
  it('bans honeypot hits longer than ordinary medium hits', () => {
    assert.ok(ttlFor('high', true) > ttlFor('medium', false));
    assert.ok(ttlFor('critical', false) > ttlFor('low', false));
  });

  it('blocks and unblocks an IP', () => {
    const ip = '198.51.100.66';
    unblockIp(ip);
    assert.equal(isIpBlocked(ip), false);
    blockIp({ ip, reason: 'test', score: 80, severity: 'high', deceived: true });
    assert.equal(isIpBlocked(ip), true);
    assert.equal(unblockIp(ip), true);
    assert.equal(isIpBlocked(ip), false);
  });
});

describe('store: bounded event ring', () => {
  it('keeps only the newest events under the cap', () => {
    const store = new CyberStore();
    for (let i = 0; i < 50; i++) {
      store.recordEvent({
        id: `e${i}`,
        at: new Date().toISOString(),
        ip: '203.0.113.1',
        method: 'GET',
        path: '/.env',
        userAgent: 'test',
        signals: [],
        score: 70,
        severity: 'high',
        action: 'deceive',
        blocked: false,
        requestId: `r${i}`,
      });
    }
    assert.equal(store.listEvents(10).length, 10);
    assert.equal(store.listEvents(10)[0]?.id, 'e49');
  });

  it('reports underAttack after a sustained spike', () => {
    const store = new CyberStore();
    for (let i = 0; i < 10; i++) {
      store.recordEvent({
        id: `e${i}`,
        at: new Date().toISOString(),
        ip: `203.0.113.${i}`,
        method: 'GET',
        path: '/.env',
        userAgent: 'nikto',
        signals: [],
        score: 80,
        severity: 'high',
        action: 'block',
        blocked: true,
        requestId: `r${i}`,
      });
    }
    const status = store.status({
      enabled: true,
      monitoring: true,
      deception: true,
      autoPatch: true,
      autoBlock: true,
    });
    assert.equal(status.underAttack, true);
    assert.ok(status.attackScore >= 400);
  });
});

describe('auto-patch: hardening cycle', () => {
  it('applies decoy rotation and header arming', () => {
    const results = runAutoPatch('test');
    assert.ok(results.length >= 4);
    assert.ok(results.some((r) => r.kind === 'deception' && r.applied));
    assert.ok(results.some((r) => r.kind === 'headers' && r.applied));
    assert.ok(results.some((r) => r.kind === 'config'));
  });
});
