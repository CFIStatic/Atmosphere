import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
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
    expect(nginx).toContain('location /verifier/');
    expect(nginx).toContain('location /fieldcapture/');
    expect(nginx).toContain('location = /healthz');
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
