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
    const manifest = readJson('fieldcapture/manifest.webmanifest') as {
      name: string;
      start_url: string;
      display: string;
      id?: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toMatch(/Field Capture/);
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.id).toBe('/fieldcapture/');
    expect(manifest.icons.some((icon) => icon.src.includes('atmosphere-192.png'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'fieldcapture/sw.js'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'fieldcapture/js/host.js'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'fieldcapture/icons/atmosphere-180.png'))).toBe(true);

    const html = readFileSync(resolve(repoRoot, 'fieldcapture/index.html'), 'utf8');
    expect(html).toContain('apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('id="install-sheet"');
    expect(html).toContain('js/host.js');
    expect(html).toContain('id="host-chip"');
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
    expect(swift).toContain('https://atmosphere-web-production.up.railway.app');
    expect(swift).toContain('productionBffURL');
    expect(swift).toContain('if !isSimulator');
    expect(swift).toContain('return productionBffURL');
    expect(swift).toContain('static func displayHost()');

    const today = readFileSync(
      resolve(repoRoot, 'apps/field-ios/AtmosphereFieldCapture/UI/TodayView.swift'),
      'utf8',
    );
    expect(today).toContain('ApiConfig.displayHost()');
  });

  it('ignores a localhost ?api= when Field Capture is opened on the hosted origin', () => {
    const src = readFileSync(resolve(repoRoot, 'fieldcapture/js/host.js'), 'utf8');
    const sandbox: { FieldCaptureHost?: {
      resolveApiBase: (query: string, href: string) => string;
      displayHost: (href: string, apiBase: string) => string;
    } } = {};
    const run = new Function('window', 'globalThis', `${src}\nreturn globalThis.FieldCaptureHost;`);
    const host = run(undefined, sandbox) as {
      resolveApiBase: (query: string, href: string) => string;
      displayHost: (href: string, apiBase: string) => string;
    };
    const hosted = 'https://atmosphere-web-production.up.railway.app/fieldcapture/';
    expect(host.resolveApiBase('', hosted)).toBe('');
    expect(host.resolveApiBase('http://127.0.0.1:4000', hosted)).toBe('');
    expect(host.resolveApiBase('http://localhost:4000', hosted)).toBe('');
    expect(host.resolveApiBase('http://127.0.0.1:4000', 'http://127.0.0.1:5174/fieldcapture/')).toBe(
      'http://127.0.0.1:4000',
    );
    expect(host.displayHost(hosted, '')).toBe('atmosphere-web-production.up.railway.app');
  });
});
