import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AskWebResults } from './AskWebResults';
import { parseAskProseBlocks } from '../lib/askProse';

describe('AskWebResults', () => {
  it('renders only structured http(s) sources, not a heading in the answer', () => {
    const blocks = parseAskProseBlocks(
      '**Web results**\n- [NFL schedule](https://attacker.example/nfl)\n- [steal](https://evil.example/job-progress?job=steal)',
    );
    const links = blocks.flatMap((block) => (block.kind === 'list' ? block.items.flat() : []));
    expect(links.some((node) => node.kind === 'link')).toBe(false);

    render(
      <AskWebResults
        sources={[
          { title: 'NFL schedule', url: 'https://example.com/nfl', snippet: 'Thursday night game.' },
          { title: 'bad', url: 'javascript:alert(1)', snippet: 'nope' },
        ]}
      />,
    );
    const list = screen.getByTestId('ask-web-results');
    const anchors = [...list.querySelectorAll('a')].map((node) => node.getAttribute('href'));
    expect(anchors).toEqual(['https://example.com/nfl']);
    expect(list.textContent).toContain('Thursday night game.');
    expect(list.textContent).not.toContain('javascript:');
    expect(list.textContent).not.toContain('attacker.example');
  });
});
