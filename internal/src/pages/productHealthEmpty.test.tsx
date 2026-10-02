import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { CapturePage } from './CapturePage';
import { AiPage } from './AiPage';
import { demoOverview } from '../lib/demo';
import { normalizeProductHealth } from '../lib/productHealth';
import { emptyTrackingPayload } from '../test/fixtures';

// Regression: production returned null upload/Ask periods (empty tracking
// tables) and the Overview crashed to a blank page.
const health = normalizeProductHealth(emptyTrackingPayload());

vi.mock('../hooks/useOverview', () => ({
  useOverview: () => ({ data: demoOverview, error: null, loading: false, reload: vi.fn() }),
}));
vi.mock('../hooks/useProductHealth', () => ({
  useProductHealth: () => ({ data: health, error: null, loading: false, reload: vi.fn() }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ access: { scope: 'internal', displayName: 'Test Staff' } }),
}));

describe('product-health pages with no tracking rows yet', () => {
  it.each([
    ['Overview', OverviewPage],
    ['Capture pipeline', CapturePage],
    ['AI & Ask', AiPage],
  ])('%s renders', (_name, Page) => {
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Sources and definitions');
  });
});
