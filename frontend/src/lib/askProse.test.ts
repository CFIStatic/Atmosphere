import { describe, expect, it } from 'vitest';
import { askInlineText, normalizeAskProse, parseAskProseBlocks, stripOrphanEmphasis } from './askProse';

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
