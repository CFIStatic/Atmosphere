#!/usr/bin/env node
/**
 * After Field Capture has a public Railway domain, put that origin on the BFF
 * so CORS and invite copy-links work.
 *
 *   RAILWAY_TOKEN=… node fieldcapture/scripts/publishFieldOrigin.mjs <field-service>
 *
 * Reads the field service's RAILWAY_PUBLIC_DOMAIN (or railway domain list),
 * then appends https://<domain> to Atmosphere APIs FRONTEND_ORIGIN and sets
 * FIELD_CAPTURE_ORIGIN. Uses --skip-deploys; the next backend ship picks it up,
 * and CORS also allows atmosphere-field*.up.railway.app without this.
 */
import { spawnSync } from 'node:child_process';

const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
const environment = process.env.RAILWAY_ENVIRONMENT || 'production';
const fieldService = process.argv[2] || process.env.RAILWAY_FIELD_SERVICE || 'Field Capture';
const backendService = process.env.RAILWAY_BACKEND_SERVICE || process.env.RAILWAY_SERVICE || 'Atmosphere APIs';

function railway(args) {
  return spawnSync('railway', args, { encoding: 'utf8' });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectDomains(node, out = []) {
  if (!node) return out;
  if (typeof node === 'string' && /\.up\.railway\.app$/i.test(node)) {
    out.push(node.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectDomains(item, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (/domain/i.test(key) && typeof value === 'string' && value.includes('.')) {
      out.push(value.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    }
    if (value && typeof value === 'object') collectDomains(value, out);
  }
  return out;
}

function httpsOrigin(host) {
  const cleaned = String(host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return cleaned ? `https://${cleaned}` : '';
}

const listed = railway([
  'domain',
  'list',
  '--service',
  fieldService,
  '--project',
  project,
  '--environment',
  environment,
  '--json',
]);
const fromList = collectDomains(parseJson(listed.stdout || ''));

const vars = railway([
  'variable',
  'list',
  '--service',
  fieldService,
  '--project',
  project,
  '--environment',
  environment,
  '--json',
]);
const varBody = parseJson(vars.stdout || '') || {};
const fromVar = varBody.RAILWAY_PUBLIC_DOMAIN || varBody.railwayPublicDomain;

const host = fromList[0] || fromVar;
const origin = httpsOrigin(host);
if (!origin) {
  console.error('publishFieldOrigin: no public domain on Field Capture yet. Run `railway domain`.');
  process.exit(1);
}

const backendVars = railway([
  'variable',
  'list',
  '--service',
  backendService,
  '--project',
  project,
  '--environment',
  environment,
  '--json',
]);
const backendBody = parseJson(backendVars.stdout || '') || {};
const current = String(backendBody.FRONTEND_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
if (!current.includes(origin)) current.push(origin);

const merged = current.join(',');
const writeFrontend = spawnSync(
  'railway',
  [
    'variable',
    'set',
    'FRONTEND_ORIGIN',
    '--stdin',
    '--skip-deploys',
    '--service',
    backendService,
    '--project',
    project,
    '--environment',
    environment,
  ],
  { input: merged, encoding: 'utf8' },
);
if (writeFrontend.status !== 0) {
  console.error(writeFrontend.stderr || writeFrontend.stdout || 'could not set FRONTEND_ORIGIN');
} else {
  console.log(`FRONTEND_ORIGIN now includes ${origin}`);
}

const writeField = spawnSync(
  'railway',
  [
    'variable',
    'set',
    'FIELD_CAPTURE_ORIGIN',
    '--stdin',
    '--skip-deploys',
    '--service',
    backendService,
    '--project',
    project,
    '--environment',
    environment,
  ],
  { input: origin, encoding: 'utf8' },
);
if (writeField.status !== 0) {
  console.error(writeField.stderr || writeField.stdout || 'could not set FIELD_CAPTURE_ORIGIN');
} else {
  console.log(`FIELD_CAPTURE_ORIGIN=${origin}`);
}

if (writeFrontend.status !== 0 || writeField.status !== 0) process.exit(1);
console.log(origin);
