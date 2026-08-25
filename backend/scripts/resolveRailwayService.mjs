#!/usr/bin/env node
/**
 * Print a Railway service ID for --service flags.
 * Names with spaces (Internal Growth Metrics) fail `railway variable set --service`
 * on the CLI we use in CI; UUIDs work.
 *
 * Usage: RAILWAY_PROJECT_ID=… RAILWAY_ENVIRONMENT=production \
 *        node resolveRailwayService.mjs "Internal Growth Metrics"
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
const environment = process.env.RAILWAY_ENVIRONMENT || 'production';

export const ALIASES = {
  atmosphere: ['atmosphere apis', 'atmosphere'],
  'atmosphere apis': ['atmosphere apis', 'atmosphere'],
  'atmosphere-internal': ['internal growth metrics', 'melodious-inspiration'],
  'internal growth metrics': ['internal growth metrics', 'melodious-inspiration'],
  'atmosphere-web': ['login & dashboard', 'atmosphere-web'],
  'atmosphere web': ['login & dashboard', 'atmosphere-web'],
  'login & dashboard': ['login & dashboard', 'atmosphere-web'],
  website: ['corporate website', 'website'],
  'corporate website': ['corporate website', 'website'],
  'atmosphere-website': ['corporate website', 'website'],
  'atmosphere-field': ['field capture', 'atmosphere-field'],
  'field capture': ['field capture', 'atmosphere-field'],
  fieldcapture: ['field capture', 'atmosphere-field'],
  field: ['field capture', 'atmosphere-field'],
};

export function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function aliasesFor(want) {
  const key = norm(want);
  const names = new Set([key]);
  for (const [aliasKey, targets] of Object.entries(ALIASES)) {
    if (norm(aliasKey) !== key && !targets.map(norm).includes(key)) continue;
    names.add(norm(aliasKey));
    for (const target of targets) names.add(norm(target));
  }
  return names;
}

export function matchService(want, services) {
  const wanted = aliasesFor(want);
  return (
    services.find((s) => wanted.has(norm(s.name))) ||
    services.find((s) => [...wanted].some((alias) => norm(s.name).includes(alias))) ||
    services.find((s) => wanted.has(norm(s.id))) ||
    null
  );
}

function railway(args) {
  return spawnSync('railway', args, { encoding: 'utf8' });
}

function collectServices(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectServices(item, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  const id = node.id || node.serviceId || node.service_id;
  const name = node.name || node.serviceName || node.service_name;
  const isContainer = Array.isArray(node.services) || Array.isArray(node.environments);
  if (typeof id === 'string' && typeof name === 'string' && !isContainer) {
    out.push({ id, name });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectServices(value, out);
  }
  return out;
}

function listServices() {
  const attempts = [
    ['service', 'list', '--json', '--project', project, '--environment', environment],
    ['service', 'status', '--all', '--json', '--project', project, '--environment', environment],
    ['status', '--json', '--project', project, '--environment', environment],
  ];
  for (const args of attempts) {
    const result = railway(args);
    const raw = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(result.stdout?.trim() || result.stderr?.trim() || raw);
      const services = collectServices(parsed);
      if (services.length) return services;
    } catch {
      /* try next shape */
    }
  }
  return [];
}

function main() {
  const wantRaw = (process.argv[2] || process.env.RAILWAY_SERVICE || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(wantRaw)) {
    process.stdout.write(wantRaw);
    process.exit(0);
  }

  const services = listServices();
  if (!services.length) {
    console.error('resolveRailwayService: could not list Railway services');
    process.exit(1);
  }

  console.error(
    'resolveRailwayService: available ' +
      services.map((s) => `${s.name} (${s.id})`).join(', '),
  );

  const match = matchService(wantRaw, services);
  if (!match) {
    console.error(`resolveRailwayService: no service matching '${wantRaw}'`);
    process.exit(1);
  }

  console.error(`resolveRailwayService: ${wantRaw} -> ${match.name} ${match.id}`);
  process.stdout.write(match.id);
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main();
}
