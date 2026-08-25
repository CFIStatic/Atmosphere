import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DocumentTitle } from './DocumentTitle';

describe('DocumentTitle', () => {
  it('sets the dashboard tab to the bars-branded Atmosphere name', () => {
    render(
      <MemoryRouter initialEntries={['/verifier-library']}>
        <DocumentTitle />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Overview · Atmosphere');
  });
});
