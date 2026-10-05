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

describe('parseAskProseBlocks renders Grok-style markdown without raw syntax', () => {
  const flat = (input: string) =>
    parseAskProseBlocks(input)
      .map((block) => {
        if (block.kind === 'list') return block.items.map((item) => askInlineText(item)).join(' | ');
        if (block.kind === 'table') return [...block.headers, ...block.rows.flat()].map((cell) => askInlineText(cell)).join(' | ');
        if (block.kind === 'code') return block.text;
        return askInlineText(block.children);
      })
      .join('\n');

  it('renders `inline code` as a code node, not backticks', () => {
    const [block] = parseAskProseBlocks('The gate code is `4412`.');
    expect(block?.kind).toBe('paragraph');
    const nodes = block?.kind === 'paragraph' ? block.children : [];
    expect(nodes.some((node) => node.kind === 'code' && node.text === '4412')).toBe(true);
    expect(flat('The gate code is `4412`.')).not.toContain('`');
  });

  it('turns any heading depth into a heading and drops rules and quote markers', () => {
    const blocks = parseAskProseBlocks('#### Scope\n\n---\n\n> Carrier approved the deck.');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph']);
    expect(flat('#### Scope\n\n---\n\n> Carrier approved the deck.')).toBe('Scope\nCarrier approved the deck.');
  });

  it('renders a fenced block as code and keeps snake_case words intact', () => {
    const blocks = parseAskProseBlocks('Run this:\n\n```\nnpm run build\n```\n\nThe field is claim_number_2 on file.');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(flat('The field is claim_number_2 on file.')).toBe('The field is claim_number_2 on file.');
  });

  it('shows a labelled link as its label, never as raw [label](url)', () => {
    expect(flat('See [the permit page](https://example.gov/permits) for hours.')).toBe('See the permit page for hours.');
    const [block] = parseAskProseBlocks('Open [the job](/jobs/abc).');
    const nodes = block?.kind === 'paragraph' ? block.children : [];
    expect(nodes.some((node) => node.kind === 'link' && node.href === '/jobs/abc' && node.text === 'the job')).toBe(true);
  });

  it('keeps paragraphs, lists, bold and tables clean', () => {
    const text = 'Yes, the deck was approved.\n\n- **Roof:** north slope stripped\n- Skylights stay\n\n| Day | Work |\n| --- | --- |\n| Aug 5 | Tear-off |';
    expect(parseAskProseBlocks(text).map((block) => block.kind)).toEqual(['paragraph', 'list', 'table']);
    expect(flat(text)).not.toMatch(/\*\*|\|\s*---/);
  });
});

describe('scraped web text in a Chat answer', () => {
  const SCRAPED =
    '#### Sunday, October 4 [...] NY Jets at Bills, TBD Jaguars at Colts, TBD ### WEEK Colts 30, Chiefs 33, FINAL, Sunday, September 20th Final Indianapolis Colts Team LogoCOLTS0-2 Kansas City Chiefs Team LogoCHIEFS2-0 Final Watch Replay ### Week 3 Rams at Broncos, Sunday, September 27th [...]';

  it('never shows ####, [...] or site labels', () => {
    const blocks = parseAskProseBlocks(SCRAPED);
    const text = blocks.map((block) => ('children' in block ? askInlineText(block.children) : '')).join('\n');
    expect(text).not.toMatch(/#|\[\.\.\.\]|Team Logo|Watch Replay/);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 3 });
    expect(blocks.slice(1).map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
    expect(text).toMatch(/Indianapolis Colts 0-2 Kansas City Chiefs 2-0/);
  });

  it('renders h1–h6 and keeps an over-long "heading" as a paragraph', () => {
    const blocks = parseAskProseBlocks(
      '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n###Seven\n#1 pick\n## ' + 'x'.repeat(80),
    );
    expect(blocks.slice(0, 7).map((block) => (block.kind === 'heading' ? block.level : block.kind))).toEqual([2, 2, 3, 3, 3, 3, 3]);
    expect(blocks[7]).toMatchObject({ kind: 'paragraph' });
    expect(askInlineText((blocks[7] as { children: never[] }).children)).toBe(`#1 pick\n${'x'.repeat(80)}`);
  });
});
