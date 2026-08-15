import { readFileSync } from 'node:fs';
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

  it('tunnels the Vite app so a phone can open HTTPS', () => {
    const script = readFileSync(resolve(repoRoot, 'scripts/host-phone.sh'), 'utf8');
    expect(script).toContain('trycloudflare.com');
    expect(script).toContain('/fieldcapture/');
    expect(script).toContain('5174');
  });
});
