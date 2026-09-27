import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMembers = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    getMembers: (...args: unknown[]) => getMembers(...args),
  },
}));

import { MentionTextarea } from './MentionTextarea';

function Harness() {
  const [value, setValue] = useState('');
  return <MentionTextarea value={value} onChange={setValue} placeholder="Ask what you forgot…" />;
}

describe('MentionTextarea', () => {
  beforeEach(() => {
    getMembers.mockReset();
    getMembers.mockResolvedValue({
      members: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          email: 'john.cyganiak@ortizrestoration.com',
          fullName: 'John Cyganiak',
          handle: 'johncyganiak',
          role: 'field_technician',
          workType: 'construction',
          usageIntents: [],
          status: 'active',
        },
        {
          userId: 'u-elena',
          email: 'elena@ortizrestoration.com',
          fullName: 'Elena Cruz',
          handle: null,
          role: 'accountant',
          workType: 'construction',
          usageIntents: [],
          status: 'active',
        },
      ],
    });
  });

  it('opens org members on @ and inserts the full name', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByPlaceholderText('Ask what you forgot…');
    await user.click(box);
    await user.type(box, '@jo');
    const option = await screen.findByTestId('mention-option');
    expect(option).toHaveAttribute('data-user-id', '11111111-1111-4111-8111-111111111111');
    expect(option).toHaveTextContent('John Cyganiak');
    expect(screen.queryByText('Elena Cruz')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('@John Cyganiak ');
    expect(screen.queryByTestId('mention-menu')).not.toBeInTheDocument();
  });
});
