#!/usr/bin/env node
/**
 * Print http://RAILWAY_PRIVATE_DOMAIN:PORT for the Atmosphere APIs service.
 * Used when setting Internal Growth Metrics API_UPSTREAM so nginx does not
 * depend on ${{ service.PORT }} (that key is a user variable, not runtime PORT).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
const environment = process.env.RAILWAY_ENVIRONMENT || 'production';
const want = process.argv[2] || 'Atmosphere APIs';
const fallback = 'http://atmosphere-apis.railway.internal:4000';

const resolver = fileURLToPath(new URL('./resolveRailwayService.mjs', import.meta.url));
const idResult = spawnSync(process.execPath, [resolver, want], {
  encoding: 'utf8',
  env: process.env,
});
const service = (idResult.stdout || '').trim() || want;

function run(args) {
  return spawnSync('railway', args, { encoding: 'utf8' });
}

const attempts = [
  [
    'run',
    '--service',
    service,
    '--project',
    project,
    '--environment',
    environment,
    '--',
    'sh',
    '-c',
    'printf http://$RAILWAY_PRIVATE_DOMAIN:${PORT:-4000}',
  ],
  [
    'run',
    '--service',
    service,
    '--',
    'sh',
    '-c',
    'printf http://$RAILWAY_PRIVATE_DOMAIN:${PORT:-4000}',
  ],
];

for (const args of attempts) {
  const result = run(args);
  const out = `${result.stdout || ''}`.trim();
  if (result.status === 0 && /^http:\/\/[A-Za-z0-9._-]+:\d+$/.test(out)) {
    console.error(`resolveApiUpstream: ${want} -> ${out}`);
    process.stdout.write(out);
    process.exit(0);
  }
  if (result.stderr) {
    console.error(String(result.stderr).slice(0, 400));
  }
}

console.error(`resolveApiUpstream: falling back to ${fallback}`);
process.stdout.write(fallback);
process.exit(0);
