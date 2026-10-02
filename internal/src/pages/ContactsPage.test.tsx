import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsPage } from './ContactsPage';
import { testDirectory } from '../test/fixtures';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { contacts: vi.fn() } };
});
vi.mock('../lib/csv', async () => {
  const actual = await vi.importActual<typeof import('../lib/csv')>('../lib/csv');
  return { ...actual, downloadCsv: vi.fn() };
});

import { api } from '../lib/api';
import { downloadCsv } from '../lib/csv';

describe('ContactsPage (TEST DATA)', () => {
  beforeEach(() => {
    vi.mocked(api.contacts).mockResolvedValue(testDirectory);
  });

  it('lists Stripe contacts, shows CRM as coming soon, and filters', async () => {
    render(
      <MemoryRouter>
        <ContactsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('avery.ops@example.test')).toBeInTheDocument());
    expect(screen.getAllByText('CRM (coming soon)').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('CRM source')).toBeDisabled();
    expect(screen.getAllByText('Unsubscribed').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'sample' } });
    expect(screen.queryByText('avery.ops@example.test')).toBeNull();
    expect(screen.getByText('blake@example.test')).toBeInTheDocument();
  });

  it('exports the filtered rows with formula cells neutralised', async () => {
    render(
      <MemoryRouter>
        <ContactsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('avery.ops@example.test')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = vi.mocked(downloadCsv).mock.calls[0]![1];
    expect(csv).toContain('avery.ops@example.test');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'=cmd@example.test");
  });
});
