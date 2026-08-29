import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function extract(start: string, end: string): string {
  const from = verifierHtml.indexOf(start);
  const to = verifierHtml.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start}`);
  return verifierHtml.slice(from, to);
}

describe('verifier account chip', () => {
  it('paints the saved photo instead of initials when a session includes avatarUrl', () => {
    const who = verifierHtml.match(/<div class="who-wrap" id="who-wrap">[\s\S]*?<\/div>\s*<\/header>/);
    const sessionJs = extract(
      'function initialsFrom(fullName, email) {',
      'function loadAccountFromApi() {',
    );
    expect(who).not.toBeNull();
    expect(verifierHtml).toContain('.who .avatar img');
    expect(verifierHtml).toContain('avatarUrl: (profile && profile.avatarUrl) || null');

    const dom = new JSDOM(
      `<!doctype html><html><body>${who![0]}<script>
        ${sessionJs}
      </script></body></html>`,
      { runScripts: 'dangerously', url: 'https://atmosphere.test/verifier/' },
    );

    const { document, applySession } = dom.window as unknown as {
      document: Document;
      applySession: (payload: { user: Record<string, unknown> }) => void;
    };

    applySession({
      user: {
        name: 'Jack Cyganiak',
        email: 'jack@jettx.ai',
        initials: 'JC',
        avatarUrl: 'https://img.example/jack.jpg',
        orgName: 'Jettx LLC',
      },
    });

    expect(document.getElementById('who-name')?.textContent).toBe('Jack Cyganiak');
    expect(document.getElementById('who-sub')?.textContent).toBe('Jettx LLC');
    const avatar = document.getElementById('who-avatar');
    expect(avatar?.textContent).toBe('');
    expect(avatar?.querySelector('img')?.getAttribute('src')).toBe('https://img.example/jack.jpg');

    applySession({
      user: {
        name: 'Jack Cyganiak',
        email: 'jack@jettx.ai',
        initials: 'JC',
        avatarUrl: null,
        orgName: 'Jettx LLC',
      },
    });
    expect(avatar?.querySelector('img')).toBeNull();
    expect(avatar?.textContent).toBe('JC');
  });
});
