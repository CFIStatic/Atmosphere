import { describe, expect, it } from 'vitest';
import { askInlineText, normalizeAskProse, parseAskProseBlocks } from './askProse';

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
});
