import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'jack@jettx.ai',
    createdAt: '2026-01-01T00:00:00Z',
    lastSignInAt: '2026-08-22T00:00:00Z',
    emailConfirmed: true,
    metadata: {},
  },
  profile: {
    id: 'user-1',
    email: 'jack@jettx.ai',
    fullName: 'Jack Cyganiak',
    avatarUrl: null as string | null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
  },
  membership: { org: { id: 'org-1', name: 'Jett', joinCode: 'ABC123' } },
  setProfile: vi.fn(),
  logout: vi.fn(),
  refreshMembership: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  getMembers: vi.fn().mockResolvedValue({ members: [] }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../lib/api', () => ({
  api: apiMocks,
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'failed';
  },
  ROLE_LABELS: {},
  WORK_TYPE_LABELS: {},
  CONTRACTOR_TYPE_LABELS: {},
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../lib/usePlatform', () => ({
  usePlatform: () => ['operations', vi.fn()],
}));

vi.mock('../lib/avatarImage', async () => {
  const actual = await vi.importActual<typeof import('../lib/avatarImage')>('../lib/avatarImage');
  return {
    ...actual,
    prepareAvatarUpload: vi.fn(async (file: File) => ({
      filename: 'avatar.png',
      mediaType: 'image/png',
      contentBase64: 'cGlj',
      previewUrl: `blob:test/${file.name}`,
    })),
  };
});

import { SettingsPage } from './SettingsPage';

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('Settings profile photo', () => {
  beforeEach(() => {
    authState.profile.avatarUrl = null;
    authState.setProfile.mockReset();
    apiMocks.uploadAvatar.mockReset();
    apiMocks.removeAvatar.mockReset();
  });

  it('lets someone replace the initials bubble with a photo or icon', () => {
    renderSettings();

    expect(screen.getByText('JC')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a profile photo or icon')).toBeInTheDocument();
    expect(screen.getByText('Upload photo or icon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('shows the uploaded picture and a way to change or remove it', async () => {
    authState.profile.avatarUrl = 'https://img.example/jack.jpg';
    renderSettings();

    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example/jack.jpg',
    );
    expect(screen.getByText('Change photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();

    apiMocks.removeAvatar.mockResolvedValue({
      profile: { ...authState.profile, avatarUrl: null },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(apiMocks.removeAvatar).toHaveBeenCalledTimes(1);
  });

  it('sends a picked photo to the profile avatar endpoint', async () => {
    apiMocks.uploadAvatar.mockResolvedValue({
      profile: { ...authState.profile, avatarUrl: 'data:image/png;base64,aaa' },
    });
    const user = userEvent.setup();
    renderSettings();

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'icon.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Upload a profile photo or icon'), file);

    expect(apiMocks.uploadAvatar).toHaveBeenCalled();
  });
});
