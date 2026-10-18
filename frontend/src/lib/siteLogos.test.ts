import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_LOGOS, siteLogoSrc } from './siteLogos';

describe('site logos', () => {
  it('every icon is a local file under /logos (nothing hotlinked)', () => {
    for (const src of Object.values(SITE_LOGOS)) {
      expect(src).toMatch(/^\/logos\/[a-z0-9_]+\.(png|svg)$/);
      expect(existsSync(resolve(__dirname, '../../public', src.slice(1)))).toBe(true);
    }
  });
  it('DASH uses its own app icon; unknown sites get none', () => {
    expect(siteLogoSrc('nextgear')).toBe('/logos/nextgear.png');
    expect(siteLogoSrc('practice_signin')).toBeNull();
    expect(siteLogoSrc(null)).toBeNull();
  });
});
