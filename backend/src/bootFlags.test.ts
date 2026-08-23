import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isHealthProbePath,
  listenHost,
  misresolvedServiceHint,
  resolveBackupsEnabled,
  resolveComputerUseEnabled,
} from './bootFlags.js';

describe('resolveComputerUseEnabled', () => {
  it('stays on in development without vault secrets', () => {
    assert.equal(resolveComputerUseEnabled({}, false), true);
  });

  it('turns off when COMPUTER_USE_ENABLED=false', () => {
    assert.equal(
      resolveComputerUseEnabled({ COMPUTER_USE_ENABLED: 'false' }, true),
      false,
    );
  });

  it('turns off in production when vault secrets are missing', () => {
    assert.equal(resolveComputerUseEnabled({ COMPUTER_USE_ENABLED: 'true' }, true), false);
    assert.equal(
      resolveComputerUseEnabled(
        { COMPUTER_USE_ENABLED: 'true', AI_CREDENTIALS_KEY: 'x' },
        true,
      ),
      false,
    );
  });

  it('stays on in production when both secrets are present', () => {
    assert.equal(
      resolveComputerUseEnabled(
        {
          COMPUTER_USE_ENABLED: 'true',
          AI_CREDENTIALS_KEY: 'vault',
          AGENT_TOKEN_SECRET: 'token',
        },
        true,
      ),
      true,
    );
  });
});

describe('resolveBackupsEnabled', () => {
  it('turns off in production without BACKUP_ENCRYPTION_KEY', () => {
    assert.equal(resolveBackupsEnabled({}, true), false);
    assert.equal(resolveBackupsEnabled({ BACKUP_ENABLED: 'true' }, true), false);
  });

  it('honours an explicit off switch', () => {
    assert.equal(
      resolveBackupsEnabled(
        { BACKUP_ENABLED: 'false', BACKUP_ENCRYPTION_KEY: 'k'.repeat(32) },
        true,
      ),
      false,
    );
  });

  it('stays on in production when a key is set', () => {
    assert.equal(resolveBackupsEnabled({ BACKUP_ENCRYPTION_KEY: 'secret-key' }, true), true);
  });
});

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

describe('isHealthProbePath', () => {
  it('recognises liveness and readiness probes', () => {
    assert.equal(isHealthProbePath('/'), true);
    assert.equal(isHealthProbePath('/api/health'), true);
    assert.equal(isHealthProbePath('/api/ready'), true);
    assert.equal(isHealthProbePath('/api/auth/login'), false);
  });
});

describe('misresolvedServiceHint', () => {
  it('names the Config File when the BFF boots on a static-site service', () => {
    const hint = misresolvedServiceHint({ RAILWAY_SERVICE_NAME: 'Corporate Website' });
    assert.match(hint, /Corporate Website/);
    assert.match(hint, /\/website\/railway\.toml/);
    assert.match(hint, /Do NOT add backend secrets/);
  });

  it('covers the office app and the staff site, live names and old aliases', () => {
    for (const [service, configFile] of [
      ['Login & Dashboard', '/frontend/railway.toml'],
      ['Atmosphere-web', '/frontend/railway.toml'],
      ['Internal Growth Metrics', '/internal/railway.json'],
      ['melodious-inspiration', '/internal/railway.json'],
      ['website', '/website/railway.toml'],
      ['Atmosphere-website', '/website/railway.toml'],
    ] as const) {
      assert.ok(
        misresolvedServiceHint({ RAILWAY_SERVICE_NAME: service }).includes(configFile),
        `${service} should point at ${configFile}`,
      );
    }
  });

  // A genuinely missing variable on the API service must still read as one.
  it('stays quiet on the backend service and off Railway', () => {
    assert.equal(misresolvedServiceHint({ RAILWAY_SERVICE_NAME: 'Atmosphere APIs' }), '');
    assert.equal(misresolvedServiceHint({ RAILWAY_SERVICE_NAME: '  ' }), '');
    assert.equal(misresolvedServiceHint({}), '');
  });
});
