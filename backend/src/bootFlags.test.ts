import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isHealthProbePath,
  listenHost,
  resolveWorkerRole,
  shouldRunSoldPathWorkers,
} from './bootFlags.js';

describe('listenHost', () => {
  it('binds all interfaces so Railway IPv4 healthchecks can connect', () => {
    assert.equal(listenHost({}), '0.0.0.0');
    assert.equal(listenHost({ HOST: '127.0.0.1' }), '0.0.0.0');
    assert.equal(listenHost({ HOST: 'localhost' }), '0.0.0.0');
  });

  it('honours an explicit non-loopback HOST', () => {
    assert.equal(listenHost({ HOST: '::' }), '::');
  });
});

describe('resolveWorkerRole', () => {
  it('defaults to all so one Railway service still processes work', () => {
    assert.equal(resolveWorkerRole({}), 'all');
    assert.equal(resolveWorkerRole({ WORKER_ROLE: 'ALL' }), 'all');
    assert.equal(shouldRunSoldPathWorkers('all'), true);
  });

  it('splits http vs queue for a dedicated worker replica', () => {
    assert.equal(resolveWorkerRole({ WORKER_ROLE: 'http' }), 'http');
    assert.equal(resolveWorkerRole({ WORKER_ROLE: 'api' }), 'http');
    assert.equal(resolveWorkerRole({ WORKER_ROLE: 'queue' }), 'queue');
    assert.equal(resolveWorkerRole({ ATMOSPHERE_WORKER_ROLE: 'worker' }), 'queue');
    assert.equal(shouldRunSoldPathWorkers('http'), false);
    assert.equal(shouldRunSoldPathWorkers('queue'), true);
  });
});

describe('isHealthProbePath', () => {
  it('recognises liveness and readiness probes', () => {
    assert.equal(isHealthProbePath('/'), true);
    assert.equal(isHealthProbePath('/api/health'), true);
    assert.equal(isHealthProbePath('/api/ready'), true);
    assert.equal(isHealthProbePath('/api/auth/login'), false);
  });
});
