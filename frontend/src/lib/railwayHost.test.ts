import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

/** Files above frontend/ — the upstream is shared by every front door. */
function readRoot(rel: string) {
  return read(`../${rel}`);
}

describe('Railway office-app image', () => {
  it('builds from the repo root so Verifier and Field Capture are in the image', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('COPY verifier /verifier');
    expect(dockerfile).toContain('COPY fieldcapture /fieldcapture');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$$');
  });

  it('proxies /api and serves the static apps on one origin', () => {
    const nginx = read('nginx/default.conf.template');
    expect(nginx).toContain('location /api');
    expect(nginx).toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_set_header Host $proxy_host');
    expect(nginx).toContain('proxy_ssl_server_name on');
    expect(nginx).toContain('add_header Cache-Control "no-store"');
    expect(nginx).toContain('location /verifier/');
    expect(nginx).toContain('location /fieldcapture/');
    expect(nginx).toContain('location = /healthz');
  });

  it('points API_UPSTREAM at the public BFF host, never a service reference', () => {
    // A ${{Atmosphere.*}} reference stopped resolving when the BFF service was
    // renamed to "Atmosphere APIs": the office image failed /healthz on deploy
    // and the stale replica kept serving 502s ("Cannot reach the Atmosphere
    // API" on signup). The staff site is live on the public host — the private
    // mesh 504s from these nginx containers — so every front door uses it.
    const upstream = readRoot('api.upstream').trim();
    expect(upstream).toBe('https://atmosphere-production.up.railway.app');
  });

  it('points the Railway app service at this Dockerfile, not the backend one', () => {
    const toml = read('railway.toml');
    expect(toml).toContain('dockerfilePath = "frontend/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/healthz"');
    expect(toml).toContain('frontend/**');
    expect(toml).toContain('verifier/**');
    expect(toml).toContain('fieldcapture/**');
  });

  it('does not exclude the app sources from the repo-root Docker context', () => {
    const ignore = readFileSync(resolve(repoRoot, '../.dockerignore'), 'utf8');
    expect(ignore).not.toMatch(/^frontend$/m);
    expect(ignore).not.toMatch(/^verifier$/m);
    expect(ignore).not.toMatch(/^fieldcapture$/m);

    const compose = readFileSync(resolve(repoRoot, '../docker-compose.yml'), 'utf8');
    expect(compose).toContain('dockerfile: frontend/Dockerfile');
    expect(compose).toContain('API_UPSTREAM: http://backend:4000');
  });
});

/**
 * Office console and marketing site are nginx front doors onto one BFF.
 * They share api.upstream at the repo root (currently the public BFF host —
 * the private mesh 504s from these nginx containers; see that file's test
 * above), so the value changes in exactly one place, never inline in a
 * workflow. The staff site deploy sets the same public host explicitly.
 */
describe('every front door takes /api upstream from the shared file', () => {
  const office = readRoot('.github/workflows/deploy-production.yml');
  const site = readRoot('.github/workflows/deploy-website.yml');
  const publicHost = /API_UPSTREAM.*https:\/\/[a-z0-9-]+\.up\.railway\.app/;

  it('takes the office upstream from the shared root file', () => {
    expect(office).toContain("tr -d '\\n' < api.upstream");
    const appJob = office.slice(office.indexOf('name: Deploy office app'));
    expect(appJob).toContain('resolveRailwayService.mjs');
    expect(appJob).toContain('Login & Dashboard');
    expect(appJob).not.toMatch(publicHost);
  });

  it('takes the marketing-site upstream from that same file', () => {
    expect(site).toContain("tr -d '\\n' < api.upstream");
    expect(site).not.toMatch(publicHost);
  });

  it('deploys the staff site from this repo to the public BFF', () => {
    expect(office).toContain("service=\"${RAILWAY_INTERNAL_SERVICE:-Internal Growth Metrics}\"");
    expect(office).toContain('upstream="https://atmosphere-production.up.railway.app"');
    expect(office).toContain('cp internal/railway.toml railway.toml');
  });

  it('never bakes a public https upstream into the website image', () => {
    const dockerfile = readRoot('website/Dockerfile');
    expect(dockerfile).toContain('ENV API_UPSTREAM=http://127.0.0.1:4000');
    expect(dockerfile).not.toMatch(/API_UPSTREAM=https:\/\//);
  });

  it('keeps the website proxy addressing its upstream by host', () => {
    const nginx = readRoot('website/nginx/default.conf.template');
    expect(nginx).toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_set_header Host $proxy_host');
  });
});
