import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function htmlOf(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

function links(rel: string): Array<{ href: string; text: string }> {
  const html = htmlOf(rel);
  const found: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    found.push({
      href: match[1],
      text: match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    });
  }
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i);
  if (canonical) found.push({ href: canonical[1], text: 'canonical' });
  return found;
}

function pageLinks(rel: string) {
  return links(rel).filter((link) => !link.href.startsWith('mailto:'));
}

describe('privacy and terms legal links', () => {
  it('points the privacy terms reference at atmosphereteam.com/terms', () => {
    const privacy = links('website/privacy.html');
    const termsRef = privacy.find((link) => link.href === 'https://atmosphereteam.com/terms');
    expect(termsRef?.text).toBe('atmosphereteam.com/terms');
    for (const page of ['website/privacy.html', 'website/terms.html']) {
      for (const link of links(page)) {
        expect(link.href.replace(/\/$/, '')).not.toBe('https://jettx.ai');
        expect(link.href.replace(/\/$/, '')).not.toBe('http://jettx.ai');
      }
    }
  });

  it('lists every non-mailto link on /privacy and /terms', () => {
    const privacy = pageLinks('website/privacy.html').map((link) => link.href);
    const terms = pageLinks('website/terms.html').map((link) => link.href);
    expect(links('website/privacy.html').map((link) => link.href)).toContain(
      'https://atmosphereteam.com/privacy',
    );
    expect(privacy).toContain('https://atmosphereteam.com/terms');
    expect(privacy).toContain('privacy.html');
    expect(privacy).toContain('terms.html');
    expect(links('website/terms.html').map((link) => link.href)).toContain(
      'https://atmosphereteam.com/terms',
    );
    expect(terms).toContain('privacy.html');
    expect(terms).toContain('terms.html');
    expect(new Set(privacy).size).toBeGreaterThan(5);
    expect(new Set(terms).size).toBeGreaterThan(5);
  });
});
