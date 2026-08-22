import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

describe('Railway corporate-website image', () => {
  it('starts nginx via the image entrypoint and never inherits node dist/index.js', () => {
    const dockerfile = read('website/Dockerfile');
    expect(dockerfile).toContain('ENTRYPOINT ["/docker-entrypoint.sh"]');
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$$');
    expect(dockerfile).toContain('SITE_ORIGIN=https://website-production-7e3f.up.railway.app');
    expect(dockerfile).toContain('15-validate-website-env.sh');
    expect(dockerfile).toContain('chmod -x /docker-entrypoint.d/15-validate-website-env.sh');
    expect(dockerfile).not.toContain('ENTRYPOINT ["/usr/local/bin/website-start.sh"]');

    const start = read('website/nginx/website-start.sh');
    expect(start).toContain('exec /docker-entrypoint.sh nginx -g \'daemon off;\'');
    expect(start).toContain('/docker-entrypoint.d/15-validate-website-env.sh');
    expect(start).not.toContain('exec nginx -g');
  });

  it('rewrites interpolated-empty API_UPSTREAM so nginx can bind', () => {
    const script = read('website/nginx/15-validate-website-env.sh');
    expect(script).toContain('invalid port in upstream');
    expect(script).toContain('http://:');
    expect(script).toContain('BusyBox ash');
    expect(script).toContain('https://atmosphere-production.up.railway.app');
    expect(script).toContain('http://[A-Za-z0-9._-]*');
    expect(script).not.toMatch(/^chmod/m);
    expect(script).not.toContain('grep -Eq');

    const out = execFileSync(
      'sh',
      [
        '-c',
        'API_UPSTREAM="http://:"; . ./website/nginx/15-validate-website-env.sh; printf %s "$API_UPSTREAM"',
      ],
      { encoding: 'utf8', cwd: repoRoot },
    );
    expect(out).toBe('https://atmosphere-production.up.railway.app');

    const underSetE = execFileSync(
      'sh',
      [
        '-c',
        'set -e; API_UPSTREAM="http://:"; . ./website/nginx/15-validate-website-env.sh; printf %s "$API_UPSTREAM"',
      ],
      { encoding: 'utf8', cwd: repoRoot },
    );
    expect(underSetE).toBe('https://atmosphere-production.up.railway.app');

    const kept = execFileSync(
      'sh',
      [
        '-c',
        'API_UPSTREAM="http://atmosphere.railway.internal:8080"; . ./website/nginx/15-validate-website-env.sh; printf %s "$API_UPSTREAM"',
      ],
      { encoding: 'utf8', cwd: repoRoot },
    );
    expect(kept).toBe('http://atmosphere.railway.internal:8080');
  });

  it('answers platform health probes locally so a hung BFF cannot fail the deploy', () => {
    const nginx = read('website/nginx/default.conf.template');
    expect(nginx).toContain('listen ${PORT}');
    expect(nginx).not.toContain('listen 0.0.0.0:${PORT}');
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
    expect(toml).toContain('healthcheckTimeout = 120');
    expect(toml).toContain('startCommand = "/usr/local/bin/website-start.sh"');
    expect(toml).toContain('website/**');
    expect(toml).not.toContain('healthcheckPath = "/api/health"');
    expect(toml).not.toContain('startCommand = "node dist/index.js"');
  });

  it('resolves the live Corporate Website service before railway variable set', () => {
    const workflow = read('.github/workflows/deploy-website.yml');
    expect(workflow).toContain('resolveRailwayService.mjs');
    expect(workflow).toContain('RAILWAY_WEBSITE_SERVICE');
    expect(workflow).toContain('website/scripts/apply-railway-config.sh');
    expect(workflow).toContain('RAILWAY_UP_STAMP_FILE');
    expect(workflow).toContain('website/.railway-up-stamp');
    expect(workflow).toContain("API_UPSTREAM='http://:'");
    expect(workflow).toContain('cursor/fix-website-healthcheck-e3e4');
    expect(workflow).toContain('cancel-in-progress: true');

    const resolver = read('backend/scripts/resolveRailwayService.mjs');
    expect(resolver).toContain("website: ['corporate website', 'website']");
    expect(resolver).toContain("'corporate website': ['corporate website', 'website']");
  });

  it('applies nginx + GET /health onto the Railway service from CI', () => {
    const script = read('website/scripts/apply-railway-config.sh');
    expect(script).toContain('website/Dockerfile');
    expect(script).toContain('/usr/local/bin/website-start.sh');
    expect(script).toContain("healthcheck_path=\"/health\"");
    expect(script).toContain("healthcheck_timeout=\"120\"");
    expect(script).toContain('Corporate Website');
    expect(script).toContain('not node dist/index.js');

    const json = JSON.parse(read('website/railway.json')) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string; startCommand: string; healthcheckTimeout: number };
    };
    expect(json.build.dockerfilePath).toBe('website/Dockerfile');
    expect(json.deploy.healthcheckPath).toBe('/health');
    expect(json.deploy.startCommand).toBe('/usr/local/bin/website-start.sh');
    expect(json.deploy.healthcheckTimeout).toBe(120);
  });

  it('does not treat in-window Railway probe retries as a finished failure', () => {
    const up = read('backend/scripts/railwayUp.sh');
    expect(up).toContain('Deployment failed|Healthcheck failed|healthcheck failure');
    expect(up).not.toMatch(/grep -qi 'failed with service unavailable'/);
  });
});
