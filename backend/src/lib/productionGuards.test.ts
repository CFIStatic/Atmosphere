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
  });

  it('is a no-op when not in production', async () => {
    const { assertProductionReady } = await import('./productionGuards.js');
    assert.doesNotThrow(() => assertProductionReady());
  });
});

describe('mockDriverViolations', () => {
  it('refuses ALLOW_MOCK_DRIVERS in production', async () => {
    const { mockDriverViolations } = await import('./productionGuards.js');
    const { allLeftoverSurfaces } = await import('./platformSurfaces.js');
    const errors = mockDriverViolations({
      allowMockDrivers: true,
      xactimateDriver: 'mock',
      crmSyncDriver: 'mock',
      emailMarketingProvider: 'log',
      surfaces: allLeftoverSurfaces(false),
    });
    assert.ok(errors.some((e) => /ALLOW_MOCK_DRIVERS/.test(e)));
  });

  it('allows mock leftover drivers when those surfaces are gated off', async () => {
    const { mockDriverViolations } = await import('./productionGuards.js');
    const { allLeftoverSurfaces } = await import('./platformSurfaces.js');
    const errors = mockDriverViolations({
      allowMockDrivers: false,
      xactimateDriver: 'mock',
      crmSyncDriver: 'mock',
      emailMarketingProvider: 'log',
      surfaces: allLeftoverSurfaces(false),
    });
    assert.deepEqual(errors, []);
  });

  it('fails when a leftover surface is enabled with a mock driver', async () => {
    const { mockDriverViolations } = await import('./productionGuards.js');
    const { allLeftoverSurfaces } = await import('./platformSurfaces.js');
    const surfaces = allLeftoverSurfaces(false);
    surfaces.estimator = true;
    const errors = mockDriverViolations({
      allowMockDrivers: false,
      xactimateDriver: 'mock',
      crmSyncDriver: 'mock',
      emailMarketingProvider: 'log',
      surfaces,
    });
    assert.ok(errors.some((e) => /ENABLE_ESTIMATOR/.test(e)));
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
