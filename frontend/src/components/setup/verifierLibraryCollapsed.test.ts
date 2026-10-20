import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('All videos job folders', () => {
  it('land collapsed until the person opens one', () => {
    expect(html).toContain("var collapsed = q ? !!state.searchCollapsed[k] : state.collapsed[k] !== false;");
    expect(html).toContain('state.collapsed[tr.dataset.job] = state.collapsed[tr.dataset.job] === false;');
  });
  it('search still opens folders on matching clips', () => {
    expect(html).toContain('state.searchCollapsed = {};');
    expect(html).toContain('state.searchCollapsed[tr.dataset.job] = !state.searchCollapsed[tr.dataset.job];');
  });
});
