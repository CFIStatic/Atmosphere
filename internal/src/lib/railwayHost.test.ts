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
    expect(nginx).toContain('return 200 \'ok\'');
  });

  it('points API_UPSTREAM at the Atmosphere private domain, not the public URL', () => {
    const upstream = read('api.upstream').trim();
    expect(upstream).toBe(
      'http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}',
    );
  });

  it('validates PORT and API_UPSTREAM before nginx binds', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('15-validate-internal-env.sh');
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(dockerfile).not.toMatch(/VITE_DEMO/);

    const script = read('nginx/15-validate-internal-env.sh');
    expect(script).toContain('PORT');
    expect(script).toContain('API_UPSTREAM');
  });

  it('does not exclude internal sources from the repo-root Docker context', () => {
    const ignore = readFileSync(resolve(internalRoot, '../.dockerignore'), 'utf8');
    expect(ignore).not.toMatch(/^internal$/m);

    const compose = readFileSync(resolve(internalRoot, '../docker-compose.yml'), 'utf8');
    expect(compose).toContain('dockerfile: internal/Dockerfile');
    expect(compose).toContain('8081:80');
  });
});
