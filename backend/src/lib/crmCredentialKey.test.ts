import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import {
  DEV_CRM_CREDENTIAL_KEY,
  resolveCrmCredentialKeyMaterial,
} from './crmCredentialKey.js';

test('production uses only CRM_CREDENTIAL_KEY', () => {
  assert.equal(
    resolveCrmCredentialKeyMaterial({
      NODE_ENV: 'production',
      CRM_CREDENTIAL_KEY: ' dedicated-key ',
      INTEGRATIONS_CREDENTIAL_KEY: 'shared',
      INTEGRATION_SECRETS_KEY: 'other-shared',
      DEVICE_PEPPER: 'pepper-secret',
    }),
    'dedicated-key',
  );
});

test('production fails closed when CRM_CREDENTIAL_KEY is missing', () => {
  const env = {
    NODE_ENV: 'production',
    INTEGRATIONS_CREDENTIAL_KEY: 'shared',
    INTEGRATION_SECRETS_KEY: 'other-shared',
    DEVICE_PEPPER: 'pepper-secret',
  };
  assert.throws(
    () => resolveCrmCredentialKeyMaterial(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /CRM_CREDENTIAL_KEY/);
      assert.equal(err.message.includes('pepper-secret'), false);
      assert.equal(err.message.includes('shared'), false);
      return true;
    },
  );
  assert.throws(() =>
    resolveCrmCredentialKeyMaterial({
      NODE_ENV: 'production',
      CRM_CREDENTIAL_KEY: '   ',
      DEVICE_PEPPER: 'pepper-secret',
    }),
  );
});

test('non-production uses the documented placeholder only when unset', () => {
  assert.equal(
    resolveCrmCredentialKeyMaterial({ NODE_ENV: 'development', DEVICE_PEPPER: 'pepper' }),
    DEV_CRM_CREDENTIAL_KEY,
  );
  assert.equal(
    resolveCrmCredentialKeyMaterial({ DEVICE_PEPPER: 'pepper' }),
    DEV_CRM_CREDENTIAL_KEY,
  );
  assert.equal(
    resolveCrmCredentialKeyMaterial({
      NODE_ENV: 'test',
      CRM_CREDENTIAL_KEY: 'local-key',
      DEVICE_PEPPER: 'pepper',
      INTEGRATIONS_CREDENTIAL_KEY: 'shared',
    }),
    'local-key',
  );
  assert.notEqual(DEV_CRM_CREDENTIAL_KEY, 'atmosphere-dev-pepper-do-not-use-in-production');
});

test('config wires CRM_CREDENTIAL_KEY and does not reuse the device pepper', () => {
  const fromEnv = process.env.CRM_CREDENTIAL_KEY?.trim();
  if (fromEnv) {
    assert.equal(config.crmCredentials.keyMaterial, fromEnv);
    return;
  }
  assert.equal(config.crmCredentials.keyMaterial, DEV_CRM_CREDENTIAL_KEY);
  assert.notEqual(config.crmCredentials.keyMaterial, config.device.pepper);
});
