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

function mountChip() {
  const who = verifierHtml.match(
    /<div class="who-wrap" id="who-wrap">[\s\S]*?<\/div>\s*<\/header>/,
  );
  const sessionJs = extract(
    'function initialsFrom(fullName, email) {',
    'function loadAccountFromApi() {',
  );
  const dom = new JSDOM(
    `<!doctype html><html><body>${who![0]}<script>
      ${sessionJs}
    </script></body></html>`,
    { runScripts: 'dangerously', url: 'https://atmosphere.test/verifier/' },
  );
  return dom.window as unknown as {
    document: Document;
    applySession: (payload: { user: Record<string, unknown> }, source?: string) => void;
    loadAccountFromApi: () => void;
    fetch: typeof fetch;
  };
}

describe('verifier account chip', () => {
  it('paints the saved photo instead of initials when a session includes avatarUrl', () => {
    expect(verifierHtml).toContain('.who .avatar img');
    expect(verifierHtml).toContain("applySession(d, 'parent')");
    expect(verifierHtml).not.toContain('loadAccountFromApi();\n    var railHead');

    const win = mountChip();
    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: 'https://img.example/jack.jpg',
          orgName: 'Jettx LLC',
        },
      },
      'parent',
    );

    expect(win.document.getElementById('who-name')?.textContent).toBe('Jack Cyganiak');
    expect(win.document.getElementById('who-sub')?.textContent).toBe('Jettx LLC');
    const avatar = win.document.getElementById('who-avatar');
    expect(avatar?.querySelector('img')?.getAttribute('src')).toBe('https://img.example/jack.jpg');

    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: null,
          orgName: 'Jettx LLC',
        },
      },
      'parent',
    );
    expect(avatar?.querySelector('img')).toBeNull();
    expect(avatar?.textContent).toBe('JC');
  });

  it('keeps a parent-session photo when the profile API fallback has no avatar', () => {
    const win = mountChip();
    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: 'https://img.example/jack.jpg',
          orgName: 'Jettx LLC',
        },
      },
      'parent',
    );

    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: null,
          orgName: 'Jettx LLC',
        },
      },
      'api',
    );

    expect(win.document.getElementById('who-avatar')?.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example/jack.jpg',
    );
  });

  it('replaces the chip photo when Settings posts a newer URL', () => {
    const win = mountChip();
    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: 'https://img.example/avatar.jpg?v=100',
          orgName: 'Jettx LLC',
        },
      },
      'parent',
    );
    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: 'https://img.example/avatar.jpg?v=200',
          orgName: 'Jettx LLC',
        },
      },
      'parent',
    );

    expect(win.document.getElementById('who-avatar')?.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example/avatar.jpg?v=200',
    );

    win.applySession(
      {
        user: {
          name: 'Jack Cyganiak',
          email: 'jack@jettx.ai',
          initials: 'JC',
          avatarUrl: 'https://img.example/avatar.jpg?v=100',
          orgName: 'Jettx LLC',
        },
      },
      'api',
    );
    expect(win.document.getElementById('who-avatar')?.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example/avatar.jpg?v=200',
    );
  });
});
