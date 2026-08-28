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
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$');
  });

  it('proxies /api and serves the static apps on one origin', () => {
    const nginx = read('nginx/default.conf.template');
    expect(nginx).toContain('location /api');
    expect(nginx).toContain('proxy_set_header Host $proxy_host');
    expect(nginx).toContain('proxy_ssl_server_name on');
    expect(nginx).toContain('add_header Cache-Control "no-store"');
    expect(nginx).toContain('location /verifier/');
    expect(nginx).toContain('location /fieldcapture/');
    expect(nginx).toContain('location = /healthz');
  });

  /**
   * A literal proxy_pass host is resolved once, at startup, and nginx refuses
   * to start when it is not in DNS. That turns a redeploying BFF into a dead
   * console. Proxy through a variable so a miss is a request-time 502 that
   * @api_down renders as JSON.
   */
  it('resolves the BFF per request, not once at startup', () => {
    const nginx = read('nginx/default.conf.template');
    expect(nginx).toContain('resolver ${API_RESOLVERS}');
    expect(nginx).toContain('set $api_upstream ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_pass $api_upstream$request_uri');
    // A bare ${API_UPSTREAM} in proxy_pass is the startup-resolution form.
    expect(nginx).not.toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).toContain('error_page 502 503 504 = @api_down');
    expect(nginx).toContain('backend_unreachable');
  });

  /**
   * The office console is static files; only /api needs the BFF. Railway's
   * probe must never depend on the upstream, or a cold API fails the deploy
   * and takes the login page down with it.
   */
  it('answers every platform probe locally, ahead of the /api proxy', () => {
    const nginx = read('nginx/default.conf.template');
    const apiProxy = nginx.indexOf('location /api {');
    for (const probe of ['location = /healthz', 'location = /health', 'location = /api/health']) {
      expect(nginx).toContain(probe);
      expect(nginx.indexOf(probe)).toBeLessThan(apiProxy);
    }
  });

  /**
   * Railway resolves ${{Service.VAR}} before the container starts. A reference
   * naming a service that is not on the canvas resolves to an empty string, so
   * API_UPSTREAM arrives as "http://:" and nginx exits with `invalid port in
   * upstream ":"` — which is how the console went down on 2026-08-22.
   */
  it('never lets an unusable API_UPSTREAM stop nginx from starting', () => {
    const dockerfile = read('Dockerfile');
    // .envsh is sourced by the image entrypoint; a .sh is executed in a child
    // process, so its exports would never reach envsubst.
    expect(dockerfile).toContain(
      'COPY frontend/nginx/15-validate-app-env.envsh /docker-entrypoint.d/15-validate-app-env.envsh',
    );

    const guard = read('nginx/15-validate-app-env.envsh');
    expect(guard).toContain('http://:*');
    expect(guard).toContain("*'${{'*");
    expect(guard).toContain('export API_UPSTREAM');
    expect(guard).toContain('export API_RESOLVERS');
    // Exiting is what a crash-loop is made of: the entrypoint runs with set -e.
    expect(guard).not.toMatch(/^\s*exit /m);
  });

  /**
   * The BFF service is named "Atmosphere APIs". `${{Atmosphere.…}}` matched
   * nothing, and Railway resolves an unmatched reference to an empty string
   * rather than failing, which is what produced API_UPSTREAM=http://:.
   */
  it('points API_UPSTREAM at the Atmosphere APIs private domain, not the public URL', () => {
    const upstream = readRoot('api.upstream').trim();
    expect(upstream).toBe(
      'http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}',
    );
    expect(upstream).not.toMatch(/\$\{\{Atmosphere\./);
    expect(upstream).not.toContain('https://');
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

describe('Field Capture Railway image', () => {
  it('builds an nginx image from the repo root that can proxy /api', () => {
    const dockerfile = readRoot('fieldcapture/Dockerfile');
    expect(dockerfile).toContain('COPY fieldcapture/index.html');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$');
    expect(dockerfile).toContain(
      'COPY fieldcapture/nginx/15-validate-fieldcapture-env.envsh /docker-entrypoint.d/15-validate-fieldcapture-env.envsh',
    );
  });

  it('points that canvas service at its own config, not the BFF', () => {
    const toml = readRoot('fieldcapture/railway.toml');
    expect(toml).toContain('dockerfilePath = "fieldcapture/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/healthz"');
    expect(toml).toContain('fieldcapture/**');
  });

  it('answers platform probes locally, then proxies /api to the BFF', () => {
    const nginx = readRoot('fieldcapture/nginx/default.conf.template');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('location = /api/health');
    expect(nginx).toContain('set $api_upstream ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_pass $api_upstream$request_uri');
    expect(nginx).not.toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).toContain('backend_unreachable');
    const apiProxy = nginx.indexOf('location /api {');
    for (const probe of ['location = /healthz', 'location = /health', 'location = /api/health']) {
      expect(nginx.indexOf(probe)).toBeLessThan(apiProxy);
    }
  });

  it('never lets an unusable API_UPSTREAM stop nginx from starting', () => {
    const guard = readRoot('fieldcapture/nginx/15-validate-fieldcapture-env.envsh');
    expect(guard).toContain('http://:*');
    expect(guard).toContain("*'${{'*");
    expect(guard).toContain('export API_UPSTREAM');
    expect(guard).toContain('export API_RESOLVERS');
    expect(guard).toContain('https://atmosphere-production.up.railway.app');
    expect(guard).not.toMatch(/^\s*exit /m);
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
    // Preferred over the reference: a resolved literal cannot come out empty.
    expect(office).toContain('scripts/resolveApiUpstream.mjs');
    const appJob = office.slice(office.indexOf('name: Deploy office app'));
    expect(appJob).toContain('resolveRailwayService.mjs');
    expect(appJob).toContain('Platform');
    expect(appJob).not.toMatch(publicHost);
  });

  it('takes the marketing-site upstream from that same file', () => {
    expect(site).toContain("tr -d '\\n' < api.upstream");
    expect(site).not.toMatch(publicHost);
  });

  it('applies stripe_event_forget on the backend deploy so failed checkouts can retry', () => {
    expect(office).toContain('node scripts/applyStripeEventForget.mjs');
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
    expect(nginx).toContain('set $api_upstream ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_pass $api_upstream$request_uri');
    expect(nginx).toContain('proxy_set_header Host $proxy_host');
  });
});
