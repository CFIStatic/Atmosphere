import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProductSwitchBar } from './ProductSwitchBar';

function renderBar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProductSwitchBar />
    </MemoryRouter>,
  );
}

describe('ProductSwitchBar', () => {
  it('is a two-tab switch between Field Capture and the office platform', () => {
    renderBar('/field');
    const bar = screen.getByRole('navigation', { name: 'Product' });
    expect(bar).toHaveTextContent('Field Capture');
    expect(bar).toHaveTextContent('Platform');
    expect(screen.getByRole('link', { name: /Field Capture/ })).toHaveAttribute('href', '/my-work');
    expect(screen.getByRole('link', { name: /Platform/ })).toHaveAttribute('href', '/field');
    expect(screen.getByRole('link', { name: /Platform/ })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Field Capture current on the worker dashboard', () => {
    renderBar('/my-work');
    expect(screen.getByRole('link', { name: /Field Capture/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Platform/ })).not.toHaveAttribute('aria-current');
  });
});
