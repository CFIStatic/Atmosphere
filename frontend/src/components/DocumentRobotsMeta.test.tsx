import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DocumentRobotsMeta } from './DocumentRobotsMeta';

afterEach(() => {
  cleanup();
  document.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
});

describe('DocumentRobotsMeta', () => {
  it('injects noindex on /progress/:token', () => {
    render(
      <MemoryRouter initialEntries={['/progress/abc']}>
        <DocumentRobotsMeta />
      </MemoryRouter>,
    );
    const meta = document.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toBe('noindex, nofollow, noarchive');
  });

  it('removes the managed tag off share surfaces', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/shared/tok']}>
        <DocumentRobotsMeta />
      </MemoryRouter>,
    );
    expect(document.querySelector('meta[name="robots"]')).toBeTruthy();
    unmount();
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <DocumentRobotsMeta />
      </MemoryRouter>,
    );
    expect(document.querySelector('meta[name="robots"][data-atmosphere-share-robots]')).toBeNull();
  });
});
