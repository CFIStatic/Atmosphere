import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

describe('Railway corporate-website image', () => {
  it('starts nginx via its own entrypoint and never inherits node dist/index.js', () => {
    const dockerfile = read('website/Dockerfile');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/website-start.sh"]');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$$');

    const start = read('website/nginx/website-start.sh');
    expect(start).toContain("envsubst '${PORT} ${API_UPSTREAM}'");
    expect(start).toContain("exec nginx -g 'daemon off;'");
  });

  it('answers platform health probes locally so a hung BFF cannot fail the deploy', () => {
    const nginx = read('website/nginx/default.conf.template');
    expect(nginx).toContain('listen 0.0.0.0:${PORT}');
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('location = /api/health');
    expect(nginx).toContain('proxy_connect_timeout 5s');
    expect(nginx).toContain('proxy_pass ${API_UPSTREAM}');
  });

  it('points the Railway website service at this Dockerfile, not the backend one', () => {
    const toml = read('website/railway.toml');
    expect(toml).toContain('dockerfilePath = "website/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/health"');
    expect(toml).toContain('startCommand = "/usr/local/bin/website-start.sh"');
    expect(toml).toContain('website/**');
    expect(toml).not.toContain('healthcheckPath = "/api/health"');
    expect(toml).not.toContain('startCommand = "node dist/index.js"');
  });

  it('resolves the live Corporate Website service before railway variable set', () => {
    const workflow = read('.github/workflows/deploy-website.yml');
    expect(workflow).toContain('resolveRailwayService.mjs');
    expect(workflow).toContain('RAILWAY_WEBSITE_SERVICE');

    const resolver = read('backend/scripts/resolveRailwayService.mjs');
    expect(resolver).toContain("website: ['corporate website', 'website']");
    expect(resolver).toContain("'corporate website': ['corporate website', 'website']");
  });
});
