import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_CONFIG_FIELD,
  isUuid,
  pickConfigFileField,
  pickEnvironment,
  readGraphql,
} from '../scripts/applyRailwayConfigFile.mjs';

test('isUuid separates a resolved service id from a canvas name', () => {
  assert.equal(isUuid('d0af58bd-0eec-431d-bad3-4da4b4a2e2ae'), true);
  assert.equal(isUuid(' d0af58bd-0eec-431d-bad3-4da4b4a2e2ae '), true);
  assert.equal(isUuid('Corporate Website'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(undefined), false);
});

test('readGraphql treats a 200 carrying errors as a failure', () => {
  // Railway answers a rejected mutation with HTTP 200 and an errors array, so
  // a transport-only check would report the config file as set when it is not.
  const result = readGraphql({ errors: [{ message: 'Not Authorized' }], data: null });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /Not Authorized/);
});

test('readGraphql rejects a body with no data field', () => {
  assert.equal(readGraphql({}).ok, false);
  assert.equal(readGraphql(null).ok, false);
});

test('readGraphql passes a clean response through', () => {
  const result = readGraphql({ data: { serviceInstanceUpdate: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { serviceInstanceUpdate: true });
});

test('pickEnvironment matches the environment by name, case-insensitively', () => {
  const data = {
    environments: {
      edges: [
        { node: { id: 'env-staging', name: 'staging' } },
        { node: { id: 'env-prod', name: 'Production' } },
      ],
    },
  };
  assert.equal(pickEnvironment(data, 'production')?.id, 'env-prod');
  assert.equal(pickEnvironment(data, 'staging')?.id, 'env-staging');
  assert.equal(pickEnvironment(data, 'nope'), null);
});

test('pickEnvironment survives an empty or malformed environment list', () => {
  assert.equal(pickEnvironment({ environments: { edges: [] } }, 'production'), null);
  assert.equal(pickEnvironment({}, 'production'), null);
  assert.equal(pickEnvironment({ environments: { edges: [{ node: null }] } }, 'production'), null);
});

test('pickConfigFileField prefers the exact field the API has always used', () => {
  const fields = [{ name: 'region' }, { name: 'railwayConfigFile' }, { name: 'configFilePath' }];
  assert.equal(pickConfigFileField(fields), DEFAULT_CONFIG_FIELD);
});

test('pickConfigFileField still resolves if the field is renamed', () => {
  // A hard-coded name that the schema retired would look like a silent no-op,
  // because Railway answers a rejected mutation with HTTP 200.
  assert.equal(pickConfigFileField([{ name: 'configFilePath' }]), 'configFilePath');
  assert.equal(pickConfigFileField([{ name: 'serviceConfigFile' }]), 'serviceConfigFile');
});

test('pickConfigFileField returns null rather than guessing a wrong field', () => {
  assert.equal(pickConfigFileField([{ name: 'region' }, { name: 'builder' }]), null);
  assert.equal(pickConfigFileField([]), null);
  assert.equal(pickConfigFileField(undefined), null);
  assert.equal(pickConfigFileField([{ name: null }]), null);
});

// The repo-root railway.toml is what a service with no Config File resolves.
// It carried the backend's Dockerfile and backend/** watch paths, so a
// backend-only merge autodeployed the BFF image onto Corporate Website and
// died looking for /usr/local/bin/website-start.sh in a Node image. Keep it
// inert: no dockerfilePath to inherit, no path that can match.
const rootConfig = readFileSync(
  new URL('../../railway.toml', import.meta.url),
  'utf8',
);

test('the root railway.toml names no Dockerfile for another service to inherit', () => {
  assert.doesNotMatch(rootConfig, /^\s*dockerfilePath\s*=/m);
  assert.doesNotMatch(rootConfig, /^\s*startCommand\s*=/m);
  assert.doesNotMatch(rootConfig, /^\s*healthcheckPath\s*=/m);
});

test('the root railway.toml watches a path that cannot exist', () => {
  const patterns = rootConfig.match(/watchPatterns\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
  assert.match(patterns, /railway-root-config-is-inert/);
  for (const real of ['backend/**', 'frontend/**', 'website/**', 'internal/**', 'Dockerfile']) {
    assert.ok(!patterns.includes(real), `root watchPatterns must not match ${real}`);
  }
});

test('the sentinel watch path is absent from the repo', () => {
  // If this file is ever created, every inheriting service starts building
  // the backend image again.
  assert.equal(existsSync(new URL('../../.railway-root-config-is-inert', import.meta.url)), false);
});

test('Keys sync no longer ships ALLOW_MOCK_DRIVERS=true', () => {
  const sync = readFileSync(
    new URL('../scripts/syncGithubEnvToRailway.mjs', import.meta.url),
    'utf8',
  );
  assert.match(sync, /ENABLE_PLATFORM_APIS/);
  assert.match(sync, /variable', 'delete', 'ALLOW_MOCK_DRIVERS'/);
  const keysBlock = sync.slice(sync.indexOf('const KEYS'), sync.indexOf('const REQUIRED'));
  assert.doesNotMatch(keysBlock, /ALLOW_MOCK_DRIVERS/);
});

test('each deploy job puts its own config on the upload root', () => {
  // `railway up` reads railway.toml from the upload root. With the root file
  // inert, a job that does not copy its own config matches no watch path and
  // Railway skips the build.
  const production = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  assert.match(production, /cp backend\/railway\.toml railway\.toml/);
  assert.match(production, /cp frontend\/railway\.toml railway\.toml/);
  assert.match(production, /cp internal\/railway\.toml railway\.toml/);
  assert.doesNotMatch(production, /ALLOW_MOCK_DRIVERS:\s*'true'/);
  assert.match(production, /ENABLE_PLATFORM_APIS:\s*'false'/);

  const website = readFileSync(
    new URL('../../.github/workflows/deploy-website.yml', import.meta.url),
    'utf8',
  );
  assert.match(website, /cp website\/railway\.toml railway\.toml/);

  const fieldCapture = readFileSync(
    new URL('../../.github/workflows/repair-field-capture-config.yml', import.meta.url),
    'utf8',
  );
  assert.match(fieldCapture, /cp fieldcapture\/railway\.toml railway\.toml/);
  assert.doesNotMatch(fieldCapture, /npm install -g @railway\/cli/);
});

test('the Field Capture service has its own nginx config, not the BFF probe', () => {
  const toml = readFileSync(
    new URL('../../fieldcapture/railway.toml', import.meta.url),
    'utf8',
  );
  assert.match(toml, /dockerfilePath\s*=\s*"fieldcapture\/Dockerfile"/);
  assert.match(toml, /healthcheckPath\s*=\s*"\/healthz"/);
  assert.match(toml, /fieldcapture\/\*\*/);
  assert.doesNotMatch(toml, /healthcheckPath\s*=\s*"\/api\/health"/);
  assert.doesNotMatch(toml, /^\s*preDeployCommand\s*=/m);

  const dockerfile = readFileSync(
    new URL('../../fieldcapture/Dockerfile', import.meta.url),
    'utf8',
  );
  assert.match(dockerfile, /FROM nginx:1\.27-alpine/);
  assert.match(dockerfile, /15-validate-fieldcapture-env\.envsh/);
  assert.match(dockerfile, /NGINX_ENVSUBST_FILTER=\^\(PORT\|API_UPSTREAM\|API_RESOLVERS\)\$\$/);
});
