import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'jack@jettx.ai',
    metadata: { full_name: 'From metadata' },
  },
  profile: {
    fullName: 'Jack Cyganiak',
    avatarUrl: 'https://img.example/jack.jpg',
  },
  membership: { role: 'project_manager' as const },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

import { useViewer, ViewerProvider } from './ViewerContext';

function Label() {
  const { displayName } = useViewer();
  return <p>{displayName}</p>;
}

describe('ViewerContext display name', () => {
  it('uses the saved profile name instead of the email local-part', () => {
    render(
      <ViewerProvider>
        <Label />
      </ViewerProvider>,
    );
    expect(screen.getByText('Jack Cyganiak')).toBeInTheDocument();
  });
});
