import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allLeftoverSurfaces,
  leftoverSurfaceEnabled,
  leftoverSurfaceSummary,
  resolveLeftoverSurfaces,
} from './platformSurfaces.js';

describe('resolveLeftoverSurfaces', () => {
  it('defaults every leftover surface off in production', () => {
    const flags = resolveLeftoverSurfaces({}, true);
    assert.equal(flags.sales, false);
    assert.equal(flags.pm, false);
    assert.equal(flags.estimator, false);
    assert.equal(flags.computer, false);
    assert.equal(flags.finance, false);
  });

  it('defaults every leftover surface on in development', () => {
    const flags = resolveLeftoverSurfaces({}, false);
    assert.equal(flags.sales, true);
    assert.equal(flags.estimator, true);
  });

  it('ENABLE_PLATFORM_APIS=false turns development surfaces off', () => {
    const flags = resolveLeftoverSurfaces({ ENABLE_PLATFORM_APIS: 'false' }, false);
    assert.equal(flags.sales, false);
    assert.equal(flags.pm, false);
  });

  it('ENABLE_PLATFORM_APIS=true turns production surfaces on', () => {
    const flags = resolveLeftoverSurfaces({ ENABLE_PLATFORM_APIS: 'true' }, true);
    assert.equal(flags.sales, true);
    assert.equal(flags.emailMarketing, true);
  });

  it('honours a comma-separated allowlist in production', () => {
    const flags = resolveLeftoverSurfaces({ ENABLE_PLATFORM_APIS: 'sales,pm' }, true);
    assert.equal(flags.sales, true);
    assert.equal(flags.pm, true);
    assert.equal(flags.estimator, false);
    assert.equal(flags.computer, false);
  });

  it('per-surface flags win over the master switch', () => {
    const flags = resolveLeftoverSurfaces(
      { ENABLE_PLATFORM_APIS: 'true', ENABLE_SALES: 'false', ENABLE_ESTIMATOR: 'true' },
      true,
    );
    assert.equal(flags.sales, false);
    assert.equal(flags.estimator, true);
    assert.equal(flags.pm, true);
  });

  it('maps estimator aliases (mitigation, xactimate) onto the estimator surface', () => {
    const flags = resolveLeftoverSurfaces({ ENABLE_PLATFORM_APIS: 'mitigation' }, true);
    assert.equal(flags.estimator, true);
    assert.equal(flags.sales, false);
  });
});

describe('leftoverSurfaceEnabled', () => {
  it('reads a single surface', () => {
    assert.equal(leftoverSurfaceEnabled('computer', { ENABLE_COMPUTER: 'true' }, true), true);
    assert.equal(leftoverSurfaceEnabled('computer', {}, true), false);
  });
});

describe('allLeftoverSurfaces', () => {
  it('fills every known leftover key', () => {
    const on = allLeftoverSurfaces(true);
    const off = allLeftoverSurfaces(false);
    assert.equal(on.crm, true);
    assert.equal(off.crm, false);
  });
});

describe('leftoverSurfaceSummary', () => {
  it('lists only the surfaces that are on', () => {
    const flags = allLeftoverSurfaces(false);
    flags.sales = true;
    flags.pm = true;
    assert.deepEqual(leftoverSurfaceSummary(flags), ['sales', 'pm']);
  });
});
