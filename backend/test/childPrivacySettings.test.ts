import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultChildBlurSettings,
  isChildBlurEnabledForOrg,
  loadOrgChildBlurSettings,
  updateOrgChildBlurSettings,
} from '../src/childPrivacy/settings.js';

test('child blur settings are always enabled', async () => {
  assert.deepEqual(defaultChildBlurSettings('org-1'), {
    orgId: 'org-1',
    childBlurEnabled: true,
  });
  assert.equal(await isChildBlurEnabledForOrg(null, null), true);
  assert.equal(await isChildBlurEnabledForOrg(null, 'org-x'), true);
  const loaded = await loadOrgChildBlurSettings(null, 'org-2');
  assert.equal(loaded.childBlurEnabled, true);
  const updated = await updateOrgChildBlurSettings(null, 'org-3', { childBlurEnabled: false });
  assert.equal(updated.childBlurEnabled, true);
});
