import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignBuilderPage } from './CampaignBuilderPage';
import { testCampaign, testDirectory } from '../test/fixtures';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      contacts: vi.fn(),
      campaigns: vi.fn(),
      campaign: vi.fn(),
      audienceCount: vi.fn(),
      updateCampaign: vi.fn(),
      createCampaign: vi.fn(),
      sendCampaign: vi.fn(),
      deleteCampaign: vi.fn(),
    },
  };
});

import { api } from '../lib/api';

const off = { enabled: false, reason: 'Campaign sending is turned off on this server (CAMPAIGN_SENDING_ENABLED is not true).', code: 'campaign_sending_disabled' };

describe('CampaignBuilderPage (TEST DATA)', () => {
  beforeEach(() => {
    vi.mocked(api.contacts).mockResolvedValue(testDirectory);
    vi.mocked(api.campaigns).mockResolvedValue({ campaigns: [testCampaign], suppressed: 1, sending: off });
    vi.mocked(api.campaign).mockResolvedValue({ campaign: testCampaign, sending: off });
    vi.mocked(api.audienceCount).mockResolvedValue({ matched: 1, suppressed: 0, recipients: 1, fetchedAt: testDirectory.fetchedAt });
    vi.mocked(api.updateCampaign).mockResolvedValue({ campaign: testCampaign });
    vi.mocked(api.sendCampaign).mockReset();
  });

  function renderBuilder() {
    render(
      <MemoryRouter initialEntries={[`/campaigns/${testCampaign.id}`]}>
        <Routes>
          <Route path="/campaigns/:id" element={<CampaignBuilderPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('previews the markdown body with an unsubscribe line', async () => {
    renderBuilder();
    await waitFor(() => expect(screen.getByDisplayValue('What is new in Atmosphere')).toBeInTheDocument());
    const preview = screen.getByTestId('email-preview');
    expect(preview.querySelector('h2')?.textContent).toBe('Hello');
    expect(preview.querySelector('strong')?.textContent).toBe('test');
    expect(preview.textContent).toContain('Unsubscribe');
  });

  it('confirms with the recipient count and cannot send while sending is off', async () => {
    renderBuilder();
    await waitFor(() => expect(screen.getByDisplayValue('What is new in Atmosphere')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('audience-count').textContent).toContain('Recipients1'));
    expect(screen.getByTestId('sending-off')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send campaign…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Send campaign to 1 recipients?');
    expect(screen.getByTestId('confirm-sending-off')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Send to 1 recipients' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(api.sendCampaign).not.toHaveBeenCalled();
  });
});
