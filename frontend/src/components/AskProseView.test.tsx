import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AskProseView } from './AskProseView';

describe('AskProseView', () => {
  it('renders bold and lists and does not inject HTML', () => {
    const { container } = render(
      <AskProseView text={'The **binder** is full.\n- first item\n<script>alert(1)</script>'} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('binder');
    expect(container.querySelector('li')?.textContent).toBe('first item');
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.innerHTML).not.toContain('**');
  });

  it('normalizes a stored speaker label inside the answer', () => {
    render(<AskProseView text={'Person 1 (Seated said the binder is full.'} />);
    expect(screen.getByTestId('ask-prose').textContent).toContain(
      'Speaker 1 said the binder is full.',
    );
    expect(screen.getByTestId('ask-prose').textContent).not.toMatch(/\(|Seated/);
  });

  it('leaves a clip title and quoted speech unchanged', () => {
    const title = 'Person 1 Walks the Seated Man Through the Kitchen';
    render(
      <AskProseView
        text={`Person 1 (Seated said “Ask the seated man about Person 2.” in ${title}.\n- “Ask the seated man about Person 2.” (${title}, 0:04)`}
      />,
    );
    const shown = screen.getByTestId('ask-prose').textContent ?? '';
    expect(shown).toContain('Speaker 1 said');
    expect(shown).toContain('Ask the seated man about Person 2.');
    expect(shown.split(title)).toHaveLength(3);
  });
});
