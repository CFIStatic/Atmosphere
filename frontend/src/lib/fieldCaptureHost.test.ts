import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

describe('Railway Field Capture image', () => {
  it('serves only the phone app and never inherits node dist/index.js', () => {
    const dockerfile = read('fieldcapture/Dockerfile');
    expect(dockerfile).toContain('FROM nginx:1.27-alpine');
    expect(dockerfile).toContain('COPY fieldcapture/index.html');
    expect(dockerfile).toContain('/usr/share/nginx/html/fieldcapture');
    expect(dockerfile).toContain('ENTRYPOINT ["/docker-entrypoint.sh"]');
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$');
    expect(dockerfile).not.toContain('COPY frontend/');
    expect(dockerfile).not.toMatch(/^CMD \["node /m);

    const start = read('fieldcapture/nginx/field-start.sh');
    expect(start).toContain("exec /docker-entrypoint.sh nginx -g 'daemon off;'");
  });

  it('proxies /api and serves the app at / and /fieldcapture/', () => {
    const nginx = read('fieldcapture/nginx/default.conf.template');
    expect(nginx).toContain('location /api');
    expect(nginx).toContain('set $api_upstream ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_pass $api_upstream$request_uri');
    expect(nginx).toContain('location /fieldcapture/');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('backend_unreachable');
    expect(nginx).not.toContain('location /login');
  });

  it('answers every platform probe locally, ahead of the /api proxy', () => {
    const nginx = read('fieldcapture/nginx/default.conf.template');
    const apiProxy = nginx.indexOf('location /api {');
    for (const probe of ['location = /healthz', 'location = /health', 'location = /api/health']) {
      expect(nginx).toContain(probe);
      expect(nginx.indexOf(probe)).toBeLessThan(apiProxy);
    }
  });

  it('never lets an unusable API_UPSTREAM stop nginx from starting', () => {
    const dockerfile = read('fieldcapture/Dockerfile');
    expect(dockerfile).toContain(
      'COPY fieldcapture/nginx/15-validate-field-env.envsh /docker-entrypoint.d/15-validate-field-env.envsh',
    );
    const guard = read('fieldcapture/nginx/15-validate-field-env.envsh');
    expect(guard).toContain('http://:*');
    expect(guard).toContain("*'${{'*");
    expect(guard).toContain('export API_UPSTREAM');
    expect(guard).toContain('export API_RESOLVERS');
    expect(guard).not.toMatch(/^\s*exit /m);
  });

  it('points the Railway Field Capture service at this Dockerfile, not the backend one', () => {
    const toml = read('fieldcapture/railway.toml');
    expect(toml).toContain('dockerfilePath = "fieldcapture/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/healthz"');
    expect(toml).toContain('fieldcapture/**');
    expect(toml).not.toContain('frontend/**');
    expect(toml).not.toContain('startCommand = "node dist/index.js"');

    const json = JSON.parse(read('fieldcapture/railway.json')) as {
      build: { dockerfilePath: string };
      deploy: { healthcheckPath: string; startCommand: string };
    };
    expect(json.build.dockerfilePath).toBe('fieldcapture/Dockerfile');
    expect(json.deploy.healthcheckPath).toBe('/healthz');
    expect(json.deploy.startCommand).toBe('/usr/local/bin/field-start.sh');
  });

  it('is on the local compose stack next to the office app', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toContain('dockerfile: fieldcapture/Dockerfile');
    expect(compose).toContain('8082:80');
  });

  it('deploys Field Capture from this repo onto the private-mesh BFF', () => {
    const office = read('.github/workflows/deploy-production.yml');
    expect(office).toContain("service=\"${RAILWAY_FIELD_SERVICE:-Field Capture}\"");
    expect(office).toContain('fieldcapture/scripts/apply-railway-config.sh');
    expect(office).toContain('fieldcapture/scripts/ensure-railway-service.sh');
    expect(office).toContain('scripts/resolveApiUpstream.mjs');
    expect(office).toContain('publishFieldOrigin.mjs');

    const resolver = read('backend/scripts/resolveRailwayService.mjs');
    expect(resolver).toContain("'field capture': ['field capture', 'atmosphere-field']");
  });
});
