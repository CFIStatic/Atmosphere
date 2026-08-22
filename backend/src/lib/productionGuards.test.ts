import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * productionGuards reads the already-evaluated `config` singleton. Flipping
 * NODE_ENV mid-suite would poison every other test that imports config, so
 * these tests only cover the development (no-op) path and the module shape.
 * Full boot-fail coverage is the checklist in docs/production.md.
 */

describe('productionGuards module', () => {
  it('exports assertProductionReady', async () => {
    const mod = await import('./productionGuards.js');
    assert.equal(typeof mod.assertProductionReady, 'function');
    assert.equal(typeof mod.evaluateProductionGuards, 'function');
  });

  it('is a no-op when not in production', async () => {
    const { assertProductionReady, evaluateProductionGuards } = await import(
      './productionGuards.js'
    );
    assert.doesNotThrow(() => assertProductionReady());
    assert.deepEqual(evaluateProductionGuards(), { errors: [], warnings: [] });
  });
});

describe('logger', () => {
  it('emits JSON lines', async () => {
    const { logger } = await import('./logger.js');
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      logger.info('unit_test_log', { ok: true });
    } finally {
      console.log = original;
    }
    assert.ok(lines.length >= 1);
    const parsed = JSON.parse(lines[lines.length - 1]!) as {
      msg: string;
      level: string;
      ok: boolean;
    };
    assert.equal(parsed.msg, 'unit_test_log');
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.ok, true);
  });
});
