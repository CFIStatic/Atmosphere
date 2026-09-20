import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CrmConnectPage } from './CrmConnectPage';

const crmCredentialStatus = vi.fn();
const connectCrmCredentials = vi.fn();
const disconnectCrmCredentials = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: {
    crmCredentialStatus: (...args: unknown[]) => crmCredentialStatus(...args),
    connectCrmCredentials: (...args: unknown[]) => connectCrmCredentials(...args),
    disconnectCrmCredentials: (...args: unknown[]) => disconnectCrmCredentials(...args),
  },
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => {},
}));

vi.mock('../lib/i18n', () => ({
  useT: () => (key: string) =>
    ({
      'crm.title': 'Connect',
      'crm.subtitle':
        'An Atmosphere agent signs in with your CRM username and password to pull and update jobs, contacts, and claims.',
    })[key] ?? key,
}));

describe('CrmConnectPage', () => {
  beforeEach(() => {
    crmCredentialStatus.mockReset();
    connectCrmCredentials.mockReset();
    disconnectCrmCredentials.mockReset();
    crmCredentialStatus.mockResolvedValue({
      systems: [
        {
          system: 'jobnimbus',
          connected: false,
          username: null,
          notes: null,
          status: null,
          lastVerifiedAt: null,
          lastError: null,
          connectedAt: null,
        },
        {
          system: 'acculynx',
          connected: false,
          username: null,
          notes: null,
          status: null,
          lastVerifiedAt: null,
          lastError: null,
          connectedAt: null,
        },
        {
          system: 'salesforce',
          connected: true,
          username: 'sf.user@co.com',
          notes: null,
          status: 'connected',
          lastVerifiedAt: null,
          lastError: null,
          connectedAt: '2026-09-19T12:00:00Z',
        },
        {
          system: 'servicetitan',
          connected: false,
          username: null,
          notes: null,
          status: null,
          lastVerifiedAt: null,
          lastError: null,
          connectedAt: null,
        },
      ],
    });
  });

  it('renders four CRMs without native / API key / OAuth badges', async () => {
    render(
      <MemoryRouter>
        <CrmConnectPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('crm-card-jobnimbus')).toBeInTheDocument());
    expect(screen.getByTestId('crm-card-acculynx')).toBeInTheDocument();
    expect(screen.getByTestId('crm-card-salesforce')).toBeInTheDocument();
    expect(screen.getByTestId('crm-card-servicetitan')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-card-atmosphere')).not.toBeInTheDocument();
    expect(screen.queryByText(/Atmosphere native/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^OAuth$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deepest/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Always on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/We never see your password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sf\.user@co\.com/)).toBeInTheDocument();
  });

  it('opens username/password form on Connect', async () => {
    render(
      <MemoryRouter>
        <CrmConnectPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('crm-card-jobnimbus')).toBeInTheDocument());
    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    fireEvent.click(connectButtons[0]!);
    expect(screen.getByTestId('crm-form-jobnimbus')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
  });

  it('does not show Not found on healthy load', async () => {
    render(
      <MemoryRouter>
        <CrmConnectPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('crm-card-jobnimbus')).toBeInTheDocument());
    expect(screen.queryByText(/^Not found$/i)).not.toBeInTheDocument();
  });
});
