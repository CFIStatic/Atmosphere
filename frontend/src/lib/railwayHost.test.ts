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
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|NGINX_RESOLVER)$$');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/office-start.sh"]');

    const start = read('nginx/office-start.sh');
    expect(start).toContain('exec /docker-entrypoint.sh');
    expect(start).toContain('is_usable_upstream');
    expect(start).toContain('invalid port in upstream');
    expect(start).toContain('http://:');
    expect(start).toContain('NGINX_RESOLVER');
    expect(start).toContain('[fd12::10]');
    expect(start).not.toContain('exec nginx -g');
  });

  it('proxies /api with runtime DNS so a BFF redeploy cannot 504 Sign in', () => {
    const nginx = read('nginx/default.conf.template');
    expect(nginx).toContain('location /api');
    expect(nginx).toContain('resolver ${NGINX_RESOLVER}');
    expect(nginx).toContain('ipv6=on');
    expect(nginx).toContain('set $api_upstream "${API_UPSTREAM}"');
    expect(nginx).toContain('proxy_pass $api_upstream');
    expect(nginx).toContain('proxy_set_header Host $proxy_host');
    expect(nginx).toContain('proxy_ssl_server_name on');
    expect(nginx).toContain('error_page 502 503 504 = @api_down');
    expect(nginx).toContain('add_header Cache-Control "no-store"');
    expect(nginx).toContain('location /verifier/');
    expect(nginx).toContain('location /fieldcapture/');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('location = /api/health');
  });

  it('points API_UPSTREAM at Atmosphere APIs, not the old Atmosphere name or the public URL', () => {
    const upstream = readRoot('api.upstream').trim();
    expect(upstream).toBe(
      'http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}',
    );
    expect(upstream).not.toContain('${{Atmosphere.');
    expect(upstream).not.toContain('https://');
  });

  it('points the Railway app service at this Dockerfile, not the backend one', () => {
    const toml = read('railway.toml');
    expect(toml).toContain('dockerfilePath = "frontend/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/healthz"');
    expect(toml).toContain('startCommand = "/usr/local/bin/office-start.sh"');
    expect(toml).toContain('frontend/**');
    expect(toml).toContain('verifier/**');
    expect(toml).toContain('fieldcapture/**');
    expect(toml).not.toContain('startCommand = "node dist/index.js"');
  });

  it('applies nginx + GET /healthz onto the Railway service from CI', () => {
    const script = read('scripts/apply-railway-config.sh');
    expect(script).toContain('frontend/Dockerfile');
    expect(script).toContain('/usr/local/bin/office-start.sh');
    expect(script).toContain('healthcheck_path="/healthz"');
    expect(script).toContain('Login & Dashboard');
    expect(script).toContain('not node dist/index.js');

    const json = JSON.parse(read('railway.json')) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string; startCommand: string; healthcheckTimeout: number };
    };
    expect(json.build.dockerfilePath).toBe('frontend/Dockerfile');
    expect(json.deploy.healthcheckPath).toBe('/healthz');
    expect(json.deploy.startCommand).toBe('/usr/local/bin/office-start.sh');
    expect(json.deploy.healthcheckTimeout).toBe(60);
  });

  it('smokes /healthz and a JSON 503 login on the office image in CI', () => {
    const ci = readRoot('.github/workflows/ci.yml');
    expect(ci).toContain('atmosphere-app:ci');
    expect(ci).toContain('/healthz');
    expect(ci).toContain('/api/auth/login');
    expect(ci).toContain('backend_unreachable');
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
 * Pointed at the public https host, /api leaves the mesh and 502s. They share
 * api.upstream at the repo root. The staff site in internal/ is the exception:
 * its nginx 504s on the private mesh, so that deploy uses the public BFF.
 */
describe('every front door proxies /api over the private mesh', () => {
  const office = readRoot('.github/workflows/deploy-production.yml');
  const site = readRoot('.github/workflows/deploy-website.yml');
  const publicHost = /API_UPSTREAM.*https:\/\/[a-z0-9-]+\.up\.railway\.app/;

  it('takes the office upstream from the shared root file', () => {
    expect(office).toContain("tr -d '\\n' < api.upstream");
    const appJob = office.slice(office.indexOf('name: Deploy office app'));
    expect(appJob).toContain('resolveRailwayService.mjs');
    expect(appJob).toContain('Login & Dashboard');
    expect(appJob).toContain('frontend/scripts/apply-railway-config.sh');
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
