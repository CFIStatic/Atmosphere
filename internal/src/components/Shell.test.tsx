import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDEBAR_STORAGE_KEY } from '../lib/sidebar';

const auth = vi.hoisted(() => ({ scope: 'internal' as 'internal' | 'investor' }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u', email: 'staff@example.test', createdAt: '' },
    access: { scope: auth.scope, displayName: 'Test Staff', pendingAccessRequests: 2 },
    logout: vi.fn(),
  }),
}));

import { Shell } from './Shell';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Shell />
    </MemoryRouter>,
  );
}

const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' });

describe('Shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    auth.scope = 'internal';
  });

  it('brands the site Atmosphere Analytics with grouped navigation', () => {
    renderShell();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    for (const group of ['Summary', 'Growth & revenue', 'Product', 'AI cost & usage', 'Contacts & campaigns', 'System & access']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.queryByText(/Product intelligence/i)).toBeNull();
  });

  it('marks the current page and shows pending access requests', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Access/ })).toHaveTextContent('2');
  });

  it('hides staff-only pages from investors', () => {
    auth.scope = 'investor';
    renderShell();
    expect(screen.queryByRole('link', { name: 'Contacts' })).toBeNull();
    expect(screen.queryByText('Contacts & campaigns')).toBeNull();
    expect(screen.queryByText('AI cost & usage')).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('collapses to an icon rail, keeps names accessible, and remembers the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    // Labels leave the layout but stay the links' accessible names.
    expect(within(sidebar()).queryByText('Revenue & customers')).toBeNull();
    const growth = within(sidebar()).getByRole('link', { name: 'Revenue & customers' });

    // Keyboard focus shows the label as a tooltip; Escape dismisses it.
    fireEvent.focus(growth);
    expect(screen.getByTestId('nav-tooltip')).toHaveTextContent('Revenue & customers');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('nav-tooltip')).toBeNull();

    unmount();
    renderShell();
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded');
    expect(within(sidebar()).getByText('Revenue & customers')).toBeInTheDocument();
  });

  it('puts an icon-only collapse toggle at the top of the sidebar, before the first group', async () => {
    const user = userEvent.setup();
    renderShell();
    const toggle = within(sidebar()).getByRole('button', { name: 'Collapse sidebar' });
    const nav = within(sidebar()).getByRole('navigation', { name: 'Reports' });
    // Document order: the toggle comes before the navigation in both states.
    expect(toggle.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle).toHaveTextContent('');
    expect(toggle).toHaveAttribute('aria-controls', 'analytics-sidebar');

    // Tooltip on keyboard focus; Enter toggles.
    act(() => toggle.focus());
    expect(screen.getByTestId('nav-tooltip')).toHaveTextContent('Collapse sidebar');
    await user.keyboard('{Enter}');
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    const expand = within(sidebar()).getByRole('button', { name: 'Expand sidebar' });
    expect(expand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(expand).toHaveTextContent('');
    await user.keyboard(' ');
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false');
  });

  it('opens the navigation drawer on narrow screens and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });
});
