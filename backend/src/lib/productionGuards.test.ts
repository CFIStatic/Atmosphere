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
    const errors = mockDriverViolations({ allowMockDrivers: true });
    assert.ok(errors.some((e) => /ALLOW_MOCK_DRIVERS/.test(e)));
  });

  it('passes when mock drivers are not allowed', async () => {
    const { mockDriverViolations } = await import('./productionGuards.js');
    assert.deepEqual(mockDriverViolations({ allowMockDrivers: false }), []);
  });
});
