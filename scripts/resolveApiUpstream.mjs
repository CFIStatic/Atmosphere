#!/usr/bin/env node
/**
 * Print the BFF's private-mesh URL for a front door's API_UPSTREAM.
 *
 * api.upstream holds a Railway reference (`${{ "Atmosphere APIs".* }}`) that
 * Railway resolves on its side. When the service in that reference is renamed
 * the reference resolves to an *empty string* instead of failing: the front
 * door receives `API_UPSTREAM=http://:` and its nginx will not start
 * ("invalid port in upstream"). Reading the BFF's own variables here and
 * writing the resolved literal removes that whole failure mode — the service
 * is matched by the same alias table `railway variable set --service` uses.
 *
 * Usage: RAILWAY_PROJECT_ID=… RAILWAY_ENVIRONMENT=production \
 *        node scripts/resolveApiUpstream.mjs <backend-service-id>
 *
 * Prints nothing and exits 1 when the lookup fails, so callers can fall back
 * to api.upstream.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The BFF image listens here unless Railway overrides PORT. */
export const DEFAULT_API_PORT = '4000';

/** Build `http://host:port` from a Railway service's variables, or ''. */
export function upstreamFrom(vars) {
  if (!vars || typeof vars !== 'object') return '';
  const domain = String(vars.RAILWAY_PRIVATE_DOMAIN ?? '').trim();
  // An unresolved reference is as useless as an empty one.
  if (!domain || domain.includes('${{')) return '';
  const port = String(vars.PORT ?? '').trim();
  return `http://${domain}:${/^\d+$/.test(port) ? port : DEFAULT_API_PORT}`;
}

function readVariables(service) {
  const args = [
    'variables',
    '--service',
    service,
    '--environment',
    process.env.RAILWAY_ENVIRONMENT || 'production',
    '--json',
  ];
  if (process.env.RAILWAY_PROJECT_ID) args.push('--project', process.env.RAILWAY_PROJECT_ID);
  const result = spawnSync('railway', args, { encoding: 'utf8' });
  try {
    return JSON.parse(result.stdout?.trim() || '');
  } catch {
    return null;
  }
}

function main() {
  const service = (process.argv[2] || process.env.RAILWAY_BACKEND_SERVICE || '').trim();
  if (!service) {
    console.error('resolveApiUpstream: usage: resolveApiUpstream.mjs <backend-service-id>');
    process.exit(1);
  }

  const upstream = upstreamFrom(readVariables(service));
  if (!upstream) {
    console.error(
      `resolveApiUpstream: no RAILWAY_PRIVATE_DOMAIN on '${service}' — falling back to api.upstream`,
    );
    process.exit(1);
  }

  console.error(`resolveApiUpstream: ${service} -> ${upstream}`);
  process.stdout.write(upstream);
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main();
}
