import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tabsSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './Tabs.tsx'), 'utf8');
const cssSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

describe('TabPanel hide behavior', () => {
  it('forces inactive panels to display:none so a flex utility cannot split the phone frame', () => {
    expect(tabsSrc).toContain('data-[state=inactive]:hidden');
    expect(tabsSrc).toContain('shrink-0');
    expect(cssSrc).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  });
});
