import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardrail: the Saturn/planet glyph in an orange tile has been deleted more
 * than once and must never return. CI fails if Logo.tsx regresses to it.
 */
describe('Logo brand mark', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './Logo.tsx'), 'utf8');

  it('is only the five-bar mark (no Saturn/planet, no orange tile, no split wordmark)', () => {
    expect(source).not.toMatch(/<ellipse\b/);
    expect(source).not.toMatch(/<circle\b/);
    expect(source).not.toMatch(/rotate\(-25/);
    expect(source).not.toMatch(/rounded-lg bg-brand-500/);
    expect(source).not.toMatch(/Atmo\s*<span/);
    expect(source).not.toMatch(/>sphere</);

    const rects = source.match(/<rect\b/g) ?? [];
    expect(rects.length).toBe(5);
    expect(source).toContain('fill-brand-500');
    expect(source).toMatch(/>Atmosphere</);
  });
});
