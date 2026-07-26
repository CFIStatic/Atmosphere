import { describe, expect, it } from 'vitest';
import { monogramFor, readableOn } from './logoMark';
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
