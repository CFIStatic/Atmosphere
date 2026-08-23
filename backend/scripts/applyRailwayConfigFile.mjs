#!/usr/bin/env node
/**
 * Point a Railway service at its own config-as-code file.
 *
 *   RAILWAY_TOKEN=… node backend/scripts/applyRailwayConfigFile.mjs \
 *     "Corporate Website" website/railway.toml
 *
 * Why this exists. Every other setting we care about can be stamped onto a
 * service with `railway environment edit --service-config` (see
 * website/scripts/apply-railway-config.sh). The Config File *path* cannot —
 * it is a service-instance setting, not a value inside the config — so it has
 * only ever been settable by hand in Settings → Config-as-code. A service
 * where nobody set it resolves the repo-root /railway.toml on every GitHub
 * autodeploy, and config-as-code outranks the stamped settings, so the stamp
 * silently loses:
 *
 *   - build.dockerfilePath  → the backend Dockerfile, not this service's
 *   - build.watchPatterns   → backend/**, so backend-only commits rebuild it
 *   - deploy.healthcheck*   → the backend's 300s /api/health probe
 *
 * That is how Corporate Website came to build the Work Verification BFF image
 * (tsc, ffmpeg, node:22) from a commit that only touched backend/src, and then
 * fail its pre-deploy command in four seconds — the command is an nginx path
 * that does not exist in the backend image. See docs/production.md.
 *
 * Best effort by design: a wrong token, an older API shape, or a service the
 * token cannot see prints why and exits non-zero. Callers warn and carry on —
 * this hardens a deploy, it must never be the thing that breaks one.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// backboard.railway.com is current; .app is the older host some tokens still
// answer on. Try both before deciding the API is unreachable.
const ENDPOINTS = process.env.RAILWAY_API_URL
  ? [process.env.RAILWAY_API_URL]
  : ['https://backboard.railway.com/graphql/v2', 'https://backboard.railway.app/graphql/v2'];

// Account tokens authenticate with Bearer; project tokens use their own
// header. CI uses an account token, but keep both so a project token works.
const authHeaders = (token) => [
  { Authorization: `Bearer ${token}` },
  { 'Project-Access-Token': token },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID.test(String(value || '').trim());
}

/**
 * Railway returns 200 with an `errors` array for a bad query, so a transport
 * check alone is not enough to call a request successful.
 */
export function readGraphql(body) {
  if (body?.errors?.length) {
    const message = body.errors.map((e) => e?.message || String(e)).join('; ');
    return { ok: false, message };
  }
  if (!body || typeof body !== 'object' || !('data' in body)) {
    return { ok: false, message: 'response had no data field' };
  }
  return { ok: true, data: body.data };
}

async function post(endpoint, headers, query, variables) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  const read = readGraphql(body);
  if (!read.ok) return { ok: false, message: `HTTP ${res.status}: ${read.message}` };
  return read;
}

/** Walk endpoints × auth shapes once, and keep the last real error to report. */
async function graphql(token, query, variables) {
  let last = 'no attempt made';
  for (const endpoint of ENDPOINTS) {
    for (const headers of authHeaders(token)) {
      let result;
      try {
        result = await post(endpoint, headers, query, variables);
      } catch (err) {
        last = `${endpoint}: ${err?.message || err}`;
        continue;
      }
      if (result.ok) return result;
      last = `${endpoint}: ${result.message}`;
    }
  }
  return { ok: false, message: last };
}

const ENVIRONMENTS = `
  query environments($projectId: String!) {
    environments(projectId: $projectId) {
      edges { node { id name } }
    }
  }
`;

const UPDATE = `
  mutation serviceInstanceUpdate(
    $serviceId: String!
    $environmentId: String
    $input: ServiceInstanceUpdateInput!
  ) {
    serviceInstanceUpdate(
      serviceId: $serviceId
      environmentId: $environmentId
      input: $input
    )
  }
`;

export function pickEnvironment(data, wanted) {
  const edges = data?.environments?.edges || [];
  const nodes = edges.map((edge) => edge?.node).filter((node) => node?.id);
  const want = String(wanted || '').toLowerCase();
  return nodes.find((node) => String(node.name || '').toLowerCase() === want) || null;
}

function resolveService(name) {
  if (isUuid(name)) return name.trim();
  const result = spawnSync(process.execPath, [join(here, 'resolveRailwayService.mjs'), name], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const id = (result.stdout || '').trim();
  return isUuid(id) ? id : null;
}

async function main() {
  const serviceArg = (process.argv[2] || process.env.RAILWAY_SERVICE || '').trim();
  // The dashboard writes this field as `/website/railway.toml`; the API
  // stores it repo-relative. Strip the leading slash so both spellings land
  // on the same value — if a path ever fails to take, check this first.
  const configPath = (process.argv[3] || '').trim().replace(/^\/+/, '');
  const token = process.env.RAILWAY_TOKEN;
  const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
  const environment = process.env.RAILWAY_ENVIRONMENT || 'production';

  if (!serviceArg || !configPath) {
    console.error('usage: applyRailwayConfigFile.mjs <service name or id> <path/to/railway.toml>');
    process.exit(2);
  }
  if (!token) {
    console.error('applyRailwayConfigFile: RAILWAY_TOKEN is not set');
    process.exit(1);
  }

  const serviceId = resolveService(serviceArg);
  if (!serviceId) {
    console.error(`applyRailwayConfigFile: could not resolve service '${serviceArg}' to an id`);
    process.exit(1);
  }

  const envs = await graphql(token, ENVIRONMENTS, { projectId: project });
  if (!envs.ok) {
    console.error(`applyRailwayConfigFile: could not list environments — ${envs.message}`);
    process.exit(1);
  }
  const env = pickEnvironment(envs.data, environment);
  if (!env) {
    console.error(`applyRailwayConfigFile: no environment named '${environment}' in ${project}`);
    process.exit(1);
  }

  const updated = await graphql(token, UPDATE, {
    serviceId,
    environmentId: env.id,
    input: { railwayConfigFile: configPath },
  });
  if (!updated.ok) {
    console.error(`applyRailwayConfigFile: could not set the config file — ${updated.message}`);
    process.exit(1);
  }

  console.log(
    `applyRailwayConfigFile: ${serviceArg} (${serviceId}) now reads /${configPath} on ${environment}.`,
  );
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
