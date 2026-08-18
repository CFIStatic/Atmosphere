import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isHealthProbePath,
  listenHost,
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
    assert.equal(isHealthProbePath('/api/health'), true);
    assert.equal(isHealthProbePath('/api/ready'), true);
    assert.equal(isHealthProbePath('/api/auth/login'), false);
  });
});
