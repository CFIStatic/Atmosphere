import { describe, expect, it } from 'vitest';
import { monogramFor, readableOn } from './logoMark';
import { BRAND_ICONS, brandIconFor } from './brandIcons';
import { CONNECTIONS } from '../data/fixtures';

describe('monogramFor', () => {
  it('prefers an explicit override', () => {
    expect(monogramFor({ name: 'Shared network drive', mark: 'SMB' })).toBe('SMB');
  });

  it('reads the internal capitals of a product name', () => {
    // XactAnalysis → XA reads as the product; XA-from-first-two-letters would be "XA" too,
    // but DocuSketch → DS only works by looking at capitals.
    expect(monogramFor({ name: 'XactAnalysis' })).toBe('XA');
    expect(monogramFor({ name: 'AccuLynx' })).toBe('AL');
  });

  it('uses the first letters of two words', () => {
    expect(monogramFor({ name: 'Contractor Connection' })).toBe('CC');
    expect(monogramFor({ name: 'Claims Connect' })).toBe('CC');
  });

  it('falls back to the first two characters of a single lowercase word', () => {
    expect(monogramFor({ name: 'magicplan' })).toBe('MA');
  });

  it('gives every connector a distinct monogram', () => {
    // Two systems showing the same tile in the same list is worse than a plain
    // one: Xactimate and XactAnalysis both deriving "XA" made them
    // indistinguishable at a glance, which is exactly when the tile is read.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of CONNECTIONS) {
      const mark = monogramFor(c);
      const prior = seen.get(mark);
      if (prior) clashes.push(`"${mark}" shared by ${prior} and ${c.id}`);
      else seen.set(mark, c.id);
    }
    expect(clashes, clashes.join('; ')).toEqual([]);
  });

  it('never returns an empty mark for anything in the catalogue', () => {
    for (const c of CONNECTIONS) {
      const mark = monogramFor(c);
      expect(mark.length, `${c.id} produced an empty monogram`).toBeGreaterThan(0);
      expect(mark.length, `${c.id} produced an over-long monogram`).toBeLessThanOrEqual(3);
    }
  });
});

describe('readableOn', () => {
  it('puts white on dark brand colours', () => {
    expect(readableOn('#0C4DA2')).toBe('#ffffff'); // Verisk blue
    expect(readableOn('#4A154B')).toBe('#ffffff'); // Slack aubergine
  });

  it('puts dark text on bright brand colours', () => {
    // The case that makes this worth computing: white on a bright green or
    // orange is unreadable, so it cannot be assumed.
    expect(readableOn('#00D639')).toBe('#111111');
    expect(readableOn('#FFDD00')).toBe('#111111');
  });

  it('produces a legible pairing for every colour in the catalogue', () => {
    for (const c of CONNECTIONS) {
      const fg = readableOn(c.brandColor);
      expect(contrast(fg, c.brandColor), `${c.id} monogram is illegible`).toBeGreaterThanOrEqual(3);
    }
  });
});

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('official brand marks', () => {
  it('carries a real mark for the mainstream SaaS in the catalogue', () => {
    for (const id of ['gmail', 'google-drive', 'quickbooks-online', 'dropbox', 'stripe']) {
      expect(brandIconFor(id), `${id} should have an official mark`).toBeTruthy();
    }
  });

  it('has no mark for the restoration-specific vendors, and that is correct', () => {
    // No general icon set carries these. Claiming otherwise would mean shipping
    // the wrong logo, which is worse than a monogram.
    for (const id of ['xactimate', 'xactanalysis', 'encircle', 'docusketch', 'alacrity']) {
      expect(brandIconFor(id), `${id} unexpectedly matched an icon set`).toBeUndefined();
    }
  });

  it('does not show the Dash cryptocurrency logo for DASH restoration software', () => {
    // simple-icons has a "Dash" entry — it is the coin, not Cotality's product.
    expect(brandIconFor('dash')).toBeUndefined();
  });

  it('gives every mark valid path data and a brand hex', () => {
    for (const [id, icon] of Object.entries(BRAND_ICONS)) {
      expect(icon.path.length, `${id} has no path data`).toBeGreaterThan(20);
      expect(icon.hex, `${id} has a malformed hex`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(icon.title.length, `${id} has no title`).toBeGreaterThan(1);
    }
  });

  it('only claims marks for connectors that exist in the catalogue', () => {
    const ids = new Set(CONNECTIONS.map((c) => c.id));
    for (const id of Object.keys(BRAND_ICONS)) {
      expect(ids.has(id), `${id} has a mark but is not in the catalogue`).toBe(true);
    }
  });
});
