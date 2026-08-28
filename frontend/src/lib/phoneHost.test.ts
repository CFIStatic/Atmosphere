import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson(rel: string) {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf8')) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string }[];
  };
}

describe('phone home-screen manifests', () => {
  it('installs the office console as a standalone app', () => {
    const manifest = readJson('frontend/public/manifest.webmanifest');
    expect(manifest.name).toBe('Atmosphere');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  });

  it('installs Field Capture as a standalone app', () => {
    const manifest = readJson('fieldcapture/manifest.webmanifest');
    expect(manifest.name).toMatch(/Field Capture/);
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((icon) => icon.src.includes('atmosphere-192.png'))).toBe(true);
  });

  it('shows the Atmosphere bars and name in the hosted dashboard tab', () => {
    const html = readFileSync(resolve(repoRoot, 'frontend/index.html'), 'utf8');
    expect(html).toMatch(/<title>Atmosphere<\/title>/);
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/icons/favicon.svg"');
    expect(html).toContain('apple-mobile-web-app-title" content="Atmosphere"');
    expect(html).toContain('og:site_name" content="Atmosphere"');

    const favicon = readFileSync(resolve(repoRoot, 'frontend/public/icons/favicon.svg'), 'utf8');
    expect(favicon).toContain('viewBox="0 0 22 22"');
    expect(favicon.match(/<rect/g)?.length).toBe(5);
    expect(favicon).toContain('#F2670C');

    for (const rel of [
      'frontend/public/favicon.ico',
      'frontend/public/icons/favicon-32.png',
      'frontend/public/icons/atmosphere-180.png',
      'frontend/public/icons/atmosphere-192.png',
      'frontend/public/icons/atmosphere-512.png',
    ]) {
      expect(existsSync(resolve(repoRoot, rel))).toBe(true);
    }
  });

  it('tunnels the Vite app so a phone can open HTTPS', () => {
    const script = readFileSync(resolve(repoRoot, 'scripts/host-phone.sh'), 'utf8');
    expect(script).toContain('trycloudflare.com');
    expect(script).toContain('/fieldcapture/');
    expect(script).toContain('5174');
  });

  it('points native Field Capture at the production BFF so day films are read internally', () => {
    const swift = readFileSync(
      resolve(repoRoot, 'apps/field-ios/AtmosphereFieldCapture/Network/ApiConfig.swift'),
      'utf8',
    );
    expect(swift).toContain('https://atmosphere-production.up.railway.app');
    expect(swift).toContain('productionBffURL');
    expect(swift).toContain('isLoopback(host), !isSimulator { return productionBffURL }');
  });

  it('points the standalone Field Capture web host at the live office API', () => {
    const core = readFileSync(resolve(repoRoot, 'fieldcapture/js/capture-core.js'), 'utf8');
    const app = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');
    expect(core).toContain('https://atmosphere-web-production.up.railway.app');
    expect(core).toContain('field-capture(?:-[a-z0-9]+)*\\.up\\.railway\\.app');
    expect(core).toContain('function resolveApiBase');
    expect(app).toContain('Core.resolveApiBase');
    expect(app.indexOf('var Core = window.FieldCaptureCore')).toBeGreaterThan(-1);
    expect(app.indexOf('Core.resolveApiBase')).toBeGreaterThan(
      app.indexOf('var Core = window.FieldCaptureCore'),
    );
    expect(app).toContain('Core.loginWithPassword');
    expect(app).not.toContain('Core.joinCrew');
    expect(app).toContain("Core.resolveOfficePlatformHref('/verifier-library')");
    expect(core).toContain('function resolveOfficePlatformHref');
  });
});
