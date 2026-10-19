import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SupportBanner } from './SupportBanner';
import { supportBannerText } from '../lib/supportBanner';

afterEach(() => vi.unstubAllGlobals());

describe('SupportBanner', () => {
  it('names the person and org', () => {
    expect(supportBannerText({ active: true, userName: 'Luis Romero', orgName: 'Ridgeline Roofing' })).toBe(
      'Viewing as Luis Romero at Ridgeline Roofing (staff support)',
    );
  });

  it('renders nothing without an active support session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: false }), { status: 200 })));
    const { container } = render(<SupportBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows the banner and an Exit button while active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ active: true, userName: 'Luis Romero', orgName: 'Ridgeline Roofing', expiresAt: new Date().toISOString() }), { status: 200 }),
      ),
    );
    render(<SupportBanner />);
    expect(await screen.findByText('Viewing as Luis Romero at Ridgeline Roofing (staff support)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Exit/ })).toBeTruthy();
  });
});
