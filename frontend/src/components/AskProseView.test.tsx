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
    expect(screen.getByTestId('ask-prose').textContent).toContain('Speaker 1 said the binder is full.');
    expect(screen.getByTestId('ask-prose').textContent).not.toMatch(/\(|Seated/);
  });
});
