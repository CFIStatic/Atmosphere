#!/usr/bin/env node
/**
 * Point a Railway service's **Config File** at its own railway.toml.
 *
 * This is the one setting `railway environment edit --service-config` and
 * `railway up` cannot stand in for. Without it a service resolves the repo-root
 * `/railway.toml` on GitHub autodeploys — and that config names the repo-root
 * `Dockerfile`, so the service does not just inherit the backend's start
 * command and probe, it builds and runs the BFF. The marketing site then dies
 * on `Missing required environment variable: SUPABASE_URL` and burns the full
 * 300s `/api/health` probe before Railway calls it "Deployment failed during
 * network process". See docs/production.md.
 *
 * The CLI has no flag for it, so this goes through the public GraphQL API
 * (serviceInstance.railwayConfigFile) with the same RAILWAY_TOKEN the deploy
 * jobs already carry.
 *
 *   RAILWAY_TOKEN=… node backend/scripts/applyRailwayConfigFile.mjs \
 *     "Corporate Website" /website/railway.toml
 *
 * Safe to re-run: it reads the current value first and does nothing when it
 * already matches. Never deploys. Warns instead of failing — a token without
 * the right scope must not take a deploy job down, because `railway up` still
 * ships the site correctly on its own.
 *
 * Pass --strict to exit non-zero when the setting could not be confirmed.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { matchService } from './resolveRailwayService.mjs';

const API_URL = process.env.RAILWAY_API_URL || 'https://backboard.railway.com/graphql/v2';

/** Railway accepts both spellings of the Config File path; the API stores it bare. */
export function normalizeConfigFile(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '');
}

export function sameConfigFile(a, b) {
  return normalizeConfigFile(a) === normalizeConfigFile(b);
}

/** Environments are matched by name, falling back to the only one there is. */
export function matchEnvironment(want, environments) {
  const wanted = String(want || '')
    .trim()
    .toLowerCase();
  if (!environments.length) return null;
  return (
    environments.find((e) => String(e.id) === want) ||
    environments.find((e) => String(e.name).toLowerCase() === wanted) ||
    (environments.length === 1 ? environments[0] : null)
  );
}

/** `{ edges: [{ node }] }` or a plain array, depending on the API version. */
export function flattenConnection(connection) {
  if (!connection) return [];
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection.edges)) {
    return connection.edges.map((edge) => edge?.node).filter(Boolean);
  }
  return [];
}

async function graphql(query, variables, token) {
  // Personal tokens authenticate as Bearer; project/team tokens use their own
  // header. Try both rather than making the caller know which one they minted.
  const headers = [{ Authorization: `Bearer ${token}` }, { 'Project-Access-Token': token }];
  let lastError = null;
  for (const auth of headers) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      lastError = new Error(
        `Railway API returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
      );
      continue;
    }
    if (payload?.errors?.length) {
      lastError = new Error(payload.errors.map((e) => e?.message).join('; '));
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`Railway API ${response.status}: ${text.slice(0, 200)}`);
      continue;
    }
    return payload.data;
  }
  throw lastError ?? new Error('Railway API call failed');
}

const PROJECT_QUERY = `
  query ProjectSurfaces($id: String!) {
    project(id: $id) {
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    }
  }
`;

const INSTANCE_QUERY = `
  query ServiceInstanceConfig($environmentId: String!, $serviceId: String!) {
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
      railwayConfigFile
    }
  }
`;

const UPDATE_MUTATION = `
  mutation SetConfigFile($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
  }
`;

async function main(argv) {
  const strict = argv.includes('--strict');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const wantService = (positional[0] || process.env.RAILWAY_SERVICE || '').trim();
  const wantConfig = normalizeConfigFile(positional[1] || process.env.RAILWAY_CONFIG_FILE);

  if (!wantService || !wantConfig) {
    console.error(
      'usage: applyRailwayConfigFile.mjs "<service>" <path/to/railway.toml> [--strict]',
    );
    return 2;
  }

  const token = process.env.RAILWAY_TOKEN?.trim();
  const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
  const environmentName = process.env.RAILWAY_ENVIRONMENT || 'production';

  const give = (message) => {
    console.error(`applyRailwayConfigFile: ${message}`);
    if (strict) return 1;
    console.error(
      `applyRailwayConfigFile: warn: Config File on "${wantService}" is unverified. ` +
        `Set it by hand (Settings -> Config-as-code -> Config File = /${wantConfig}) or its ` +
        'GitHub autodeploys will keep building the repo-root backend Dockerfile.',
    );
    return 0;
  };

  if (!token) return give('RAILWAY_TOKEN is not set');

  let data;
  try {
    data = await graphql(PROJECT_QUERY, { id: project }, token);
  } catch (error) {
    return give(`could not read project ${project}: ${error.message}`);
  }

  const environments = flattenConnection(data?.project?.environments);
  const services = flattenConnection(data?.project?.services);
  const environment = matchEnvironment(environmentName, environments);
  if (!environment) return give(`no environment named "${environmentName}" in project ${project}`);

  const service = matchService(wantService, services);
  if (!service) {
    return give(
      `no service matching "${wantService}" (have: ${services.map((s) => s.name).join(', ') || 'none'})`,
    );
  }

  const ids = { environmentId: environment.id, serviceId: service.id };

  let current = null;
  try {
    const instance = await graphql(INSTANCE_QUERY, ids, token);
    current = instance?.serviceInstance?.railwayConfigFile ?? null;
  } catch (error) {
    // Not fatal — the update below is idempotent, so go ahead and write.
    console.error(`applyRailwayConfigFile: could not read current value: ${error.message}`);
  }

  if (sameConfigFile(current, wantConfig)) {
    console.log(`Config File on "${service.name}" is already /${wantConfig}.`);
    return 0;
  }

  try {
    await graphql(UPDATE_MUTATION, { ...ids, input: { railwayConfigFile: wantConfig } }, token);
  } catch (error) {
    return give(`could not set Config File on "${service.name}": ${error.message}`);
  }

  try {
    const instance = await graphql(INSTANCE_QUERY, ids, token);
    const applied = instance?.serviceInstance?.railwayConfigFile ?? null;
    if (!sameConfigFile(applied, wantConfig)) {
      return give(`Config File on "${service.name}" reads back as ${applied ?? 'unset'}`);
    }
  } catch (error) {
    return give(`could not confirm Config File on "${service.name}": ${error.message}`);
  }

  console.log(
    `Config File on "${service.name}" (${environmentName}) is now /${wantConfig} — ` +
      'GitHub autodeploys no longer resolve the repo-root backend config.',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`applyRailwayConfigFile: ${error?.stack || error}`);
      process.exit(process.argv.includes('--strict') ? 1 : 0);
    });
}
