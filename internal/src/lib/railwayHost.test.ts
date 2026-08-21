import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const internalRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string) {
  return readFileSync(resolve(internalRoot, rel), 'utf8');
}

describe('Railway internal-site image', () => {
  it('starts nginx, not the backend node process', () => {
    const toml = read('railway.toml');
    expect(toml).toContain('dockerfilePath = "internal/Dockerfile"');
    expect(toml).toContain('healthcheckPath = "/healthz"');
    expect(toml).toContain('startCommand = "/docker-entrypoint.sh nginx -g \'daemon off;\'"');
    expect(toml).not.toMatch(/^startCommand = "node /m);
    expect(toml).toMatch(/healthcheckTimeout = 1\d{2}/);

    const json = JSON.parse(read('railway.json')) as {
      build: { builder: string; dockerfilePath: string };
      deploy: { healthcheckPath: string; startCommand: string; healthcheckTimeout: number };
    };
    expect(json.build.builder).toBe('DOCKERFILE');
    expect(json.build.dockerfilePath).toBe('internal/Dockerfile');
    expect(json.deploy.healthcheckPath).toBe('/healthz');
    expect(json.deploy.startCommand).toBe("/docker-entrypoint.sh nginx -g 'daemon off;'");
    expect(json.deploy.healthcheckTimeout).toBe(120);
  });

  it('applies the json config onto the Railway service from CI', () => {
    const script = read('scripts/apply-railway-config.sh');
    expect(script).toContain('build.dockerfilePath');
    expect(script).toContain('deploy.startCommand');
    expect(script).toContain('deploy.healthcheckPath');
    expect(script).toContain('/healthz');
    expect(script).toContain('internal/Dockerfile');
    expect(script).toContain('Internal Growth Metrics');
    expect(script).toContain('API_UPSTREAM');
    expect(script).toContain('api.upstream');
  });

  it('answers platform probes locally so a down BFF cannot fail the replica', () => {
    const nginx = read('nginx/default.conf.template');
    const healthz = nginx.indexOf('location = /healthz');
    const health = nginx.indexOf('location = /health');
    const apiHealth = nginx.indexOf('location = /api/health');
    const apiProxy = nginx.indexOf('location /api');
    expect(healthz).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(-1);
    expect(apiHealth).toBeGreaterThan(-1);
    expect(apiProxy).toBeGreaterThan(apiHealth);
    expect(nginx).toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).not.toContain('resolver');
    expect(nginx).toContain('return 200 \'ok\'');
    expect(nginx).toContain('proxy_set_header Origin');
    expect(nginx).toContain('error_page 502 503 504 = @api_down');
    expect(nginx).toContain('backend_unreachable');
  });

  it('points API_UPSTREAM at Atmosphere APIs, not loopback', () => {
    const upstream = read('api.upstream').trim();
    expect(upstream).toBe('https://atmosphere-production.up.railway.app');
    expect(upstream).not.toContain('127.0.0.1');
    expect(upstream).not.toContain('localhost');
  });

  it('validates PORT and API_UPSTREAM before nginx binds', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('15-validate-internal-env.sh');
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(dockerfile).not.toMatch(/VITE_DEMO/);

    const script = read('nginx/15-validate-internal-env.sh');
    expect(script).toContain('PORT');
    expect(script).toContain('API_UPSTREAM');
    expect(script).toContain('127.0.0.1');
    expect(script).toContain('https://');
    expect(script).not.toContain('wget');
    expect(script).not.toContain('NGINX_RESOLVER');
    expect(dockerfile).not.toMatch(/API_UPSTREAM=http:\/\/127\.0\.0\.1/);
  });

  it('does not exclude internal sources from the repo-root Docker context', () => {
    const ignore = readFileSync(resolve(internalRoot, '../.dockerignore'), 'utf8');
    expect(ignore).not.toMatch(/^internal$/m);

    const compose = readFileSync(resolve(internalRoot, '../docker-compose.yml'), 'utf8');
    expect(compose).toContain('dockerfile: internal/Dockerfile');
    expect(compose).toContain('8081:80');
  });
});
