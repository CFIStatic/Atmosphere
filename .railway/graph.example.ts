/**
 * DOCUMENTATION ONLY — do not import this file from deploy scripts.
 *
 * Typed inventory of Atmosphere Railway services. Railway's TypeScript
 * project-graph API is still moving; applying this live could recreate
 * services or rewrite variables. Revisit after 2026-12-01.
 *
 * Source of truth for deploys remains per-service railway.toml copied by
 * GitHub Actions. See docs/railway-iac.md.
 */

export type AtmosphereRailwayService = {
  /** Canvas / CLI name */
  name: string;
  configFile: string;
  dockerfile: string;
  role: 'sold-path' | 'leftover' | 'inert';
};

export const ATMOSPHERE_RAILWAY_SERVICES: readonly AtmosphereRailwayService[] = [
  {
    name: 'Atmosphere APIs',
    configFile: 'backend/railway.toml',
    dockerfile: 'Dockerfile',
    role: 'sold-path',
  },
  {
    name: 'Atmosphere-web',
    configFile: 'frontend/railway.toml',
    dockerfile: 'frontend/Dockerfile',
    role: 'sold-path',
  },
  {
    name: 'Field Capture',
    configFile: 'fieldcapture/railway.toml',
    dockerfile: 'fieldcapture/Dockerfile',
    role: 'sold-path',
  },
  {
    name: 'Internal Growth Metrics',
    configFile: 'internal/railway.toml',
    dockerfile: 'internal/Dockerfile',
    role: 'sold-path',
  },
  {
    name: 'Corporate Website',
    configFile: 'website/railway.toml',
    dockerfile: 'website/Dockerfile',
    role: 'sold-path',
  },
] as const;

export const RAILWAY_GRAPH_APPLY_AFTER = '2026-12-01';
export const RAILWAY_GRAPH_MUST_NOT_APPLY = true;
