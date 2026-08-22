import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowlistedPlatformScope } from './platformAccess.js';
import { platformScopeAtLeast } from './platformAdmin.js';

describe('platform admin allowlist', () => {
  it('grants ops scope to jack@jettx.ai by default', () => {
    assert.equal(allowlistedPlatformScope('jack@jettx.ai'), 'ops');
    assert.equal(allowlistedPlatformScope('Jack@JettX.ai'), 'ops');
  });

  it('denies unrelated emails', () => {
    assert.equal(allowlistedPlatformScope('stranger@example.com'), null);
    assert.equal(allowlistedPlatformScope(null), null);
  });
});

describe('platformScopeAtLeast', () => {
  it('orders support < admin < ops', () => {
    assert.equal(platformScopeAtLeast('ops', 'support'), true);
    assert.equal(platformScopeAtLeast('ops', 'admin'), true);
    assert.equal(platformScopeAtLeast('admin', 'ops'), false);
    assert.equal(platformScopeAtLeast('support', 'admin'), false);
    assert.equal(platformScopeAtLeast('support', 'support'), true);
  });
});
