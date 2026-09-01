import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function bootVerifier() {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/?demo=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      })) as unknown as typeof window.matchMedia;
    },
  });
}

async function clickClipDelete(dom: JSDOM, clipId: string) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  const { document } = dom.window;
  const kebab = document.querySelector(
    `tr[data-id="${clipId}"] .kebab`,
  ) as HTMLButtonElement | null;
  expect(kebab).not.toBeNull();
  kebab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const del = document.querySelector('#rowmenu [data-act="delete"]') as HTMLButtonElement | null;
  expect(del).not.toBeNull();
  del!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

describe('Dashboard clip delete', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('does not ask the browser to confirm a single-clip delete', () => {
    const deleteBlock = verifierHtml.match(/if \(act === 'delete'\) \{[\s\S]*?return;\s*\n    \}/);
    expect(deleteBlock).not.toBeNull();
    expect(deleteBlock![0]).not.toContain('window.confirm');
    expect(verifierHtml).not.toContain('The chain of custody keeps the record of its life either way.');
  });

  it('removes the clip as soon as Delete is chosen', async () => {
    const dom = bootVerifier();
    const confirm = vi.spyOn(dom.window, 'confirm');
    await clickClipDelete(dom, 'EV-1038-0805-A');

    expect(confirm).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('tr[data-id="EV-1038-0805-A"]')).toBeNull();
    expect(dom.window.document.getElementById('toast')?.textContent).toMatch(/Removed from this library view/);
    confirm.mockRestore();
    dom.window.close();
  });

  it('still refuses a clip on legal hold without a confirm dialog', async () => {
    const dom = bootVerifier();
    const confirm = vi.spyOn(dom.window, 'confirm');
    await clickClipDelete(dom, 'EV-1041-0802-PC');

    expect(confirm).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('tr[data-id="EV-1041-0802-PC"]')).not.toBeNull();
    expect(dom.window.document.getElementById('toast')?.textContent).toMatch(/legal hold/);
    confirm.mockRestore();
    dom.window.close();
  });
});
