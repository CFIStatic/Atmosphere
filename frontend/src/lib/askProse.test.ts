import { describe, expect, it } from 'vitest';
import { askInlineText, normalizeAskProse, parseAskProseBlocks, splitAskArtifact, stripOrphanEmphasis } from './askProse';

describe('normalizeAskProse', () => {
  it('keeps bold markdown and normalizes list markers', () => {
    const raw = `Here is a quick snapshot:

* **Job Setup:** This is Job #9 (*Job section*).
• **Recent Activity:** Three clips.

Want more?`;
    const clean = normalizeAskProse(raw);
    expect(clean).toContain('**Job Setup:**');
    expect(clean).toMatch(/^- \*\*Job Setup:\*\*/m);
    expect(clean).toMatch(/^- \*\*Recent Activity:\*\*/m);
  });

  it('never leaves literal star soup or web trailers', () => {
    const clean = normalizeAskProse(
      'Yes *** I can search ** google?[[web: Google|https://www.google.com/]]',
    );
    expect(clean).not.toMatch(/\*\*\*/);
    expect(clean).not.toMatch(/\[\[web:/i);
    expect(clean).not.toMatch(/google\.com/i);
    expect(clean).toMatch(/Yes/i);
    expect(clean).toMatch(/search/i);
    // No unbalanced **
    expect((clean.match(/\*\*/g) ?? []).length % 2).toBe(0);
  });

  it('strips unicode and ASCII web trailers during normalize', () => {
    expect(normalizeAskProse('Hello⟦web: A|https://example.com/a⟧')).toBe('Hello');
    expect(normalizeAskProse('Hello[[web: A|https://example.com/a]]')).toBe('Hello');
  });
});

describe('stripOrphanEmphasis', () => {
  it('keeps balanced bold/italic and drops decorative runs', () => {
    expect(stripOrphanEmphasis('**Label:** *aside*')).toBe('**Label:** *aside*');
    expect(stripOrphanEmphasis('*** soup ***')).not.toMatch(/\*/);
  });
});

describe('parseAskProseBlocks', () => {
  it('parses opener, bold bullets, and follow-up like ChatGPT', () => {
    const blocks = parseAskProseBlocks(
      'Here is a quick snapshot.\n\n- **Job Setup:** Job #9\n- Invited: Jack\n\nWant more?',
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    expect(askInlineText(blocks[0]!.kind === 'paragraph' ? blocks[0].children : [])).toBe(
      'Here is a quick snapshot.',
    );
    expect(blocks[1]?.kind).toBe('list');
    if (blocks[1]?.kind !== 'list') throw new Error('expected list');
    expect(blocks[1].ordered).toBe(false);
    expect(askInlineText(blocks[1].items[0]!)).toBe('Job Setup: Job #9');
    expect(blocks[1].items[0]![0]).toMatchObject({ kind: 'bold' });
    expect(askInlineText(blocks[1].items[1]!)).toBe('Invited: Jack');
    expect(blocks[2]).toMatchObject({ kind: 'paragraph' });
  });

  it('does not treat raw HTML as markup', () => {
    const blocks = parseAskProseBlocks('See <script>alert(1)</script> on file.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
    if (blocks[0]?.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(askInlineText(blocks[0].children)).toContain('<script>alert(1)</script>');
  });

  it('parses a heading and a comparison table', () => {
    const blocks = parseAskProseBlocks(
      '## Visit comparison\n\n| Visit | What the file shows |\n| --- | --- |\n| Sep 17 | Office recording |\n| Sep 21 | Two interior clips |',
    );
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2 });
    const table = blocks.find((block) => block.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('expected table');
    expect(askInlineText(table.headers[0]!)).toBe('Visit');
    expect(table.rows).toHaveLength(2);
    expect(askInlineText(table.rows[1]![0]!)).toBe('Sep 21');
  });

  it('splits a copyable artifact out of the prose', () => {
    const split = splitAskArtifact('Three clips are on file.\n\n⟦artifact⟧\n**Homeowner summary**\n⟦/artifact⟧');
    expect(split.prose).toBe('Three clips are on file.');
    expect(split.artifact).toBe('**Homeowner summary**');
  });

  it('keeps only relative job paths as links and ignores a Web results heading', () => {
    const blocks = parseAskProseBlocks(
      'See [evil](https://attacker.example) and [the same game](https://example.com/nfl).\n\n**Web results**\n- [NFL schedule](https://example.com/nfl) — Thursday night.\n- [phish](https://attacker.example/phish)\n- [steal](https://evil.example/job-progress?job=steal)\n- [jobs](https://evil.example/jobs/job-1)\n- [proto](//evil.example/jobs/job-1)',
    );
    const links = blocks.flatMap((block) => {
      if (block.kind === 'paragraph' || block.kind === 'heading') return block.children;
      if (block.kind === 'list') return block.items.flat();
      return [];
    });
    expect(links.some((node) => node.kind === 'link')).toBe(false);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', text: 'evil' }),
        expect.objectContaining({ kind: 'text', text: 'NFL schedule' }),
        expect.objectContaining({ kind: 'text', text: 'phish' }),
        expect.objectContaining({ kind: 'text', text: 'steal' }),
      ]),
    );

    const job = parseAskProseBlocks(
      'Open [the job](/job-progress?job=job-1) or [clips](/jobs/job-1) or [login](https://attacker.example/login).',
    );
    expect(job[0]?.kind).toBe('paragraph');
    if (job[0]?.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(job[0].children.filter((node) => node.kind === 'link')).toEqual([
      expect.objectContaining({ kind: 'link', href: '/job-progress?job=job-1' }),
      expect.objectContaining({ kind: 'link', href: '/jobs/job-1' }),
    ]);
    expect(job[0].children).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'text', text: 'login' })]),
    );
  });

  it('never renders unmatched stars as literal text', () => {
    const blocks = parseAskProseBlocks('Yes *** I can ** search');
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind !== 'paragraph') throw new Error('expected paragraph');
    const flat = askInlineText(blocks[0].children);
    expect(flat).not.toMatch(/\*/);
    expect(flat).toMatch(/Yes/i);
    expect(flat).toMatch(/search/i);
  });
});
