import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonAvatar } from './PersonAvatar';

describe('PersonAvatar', () => {
  it('shows initials when there is no photo', () => {
    render(<PersonAvatar fullName="Jack Cyganiak" email="jack@jettx.ai" />);
    expect(screen.getByText('JC')).toBeInTheDocument();
  });

  it('shows the uploaded picture when a URL is present', () => {
    const { rerender } = render(
      <PersonAvatar
        fullName="Jack Cyganiak"
        email="jack@jettx.ai"
        avatarUrl="https://img.example/jack.jpg"
      />,
    );
    expect(screen.queryByText('JC')).toBeNull();
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img.example/jack.jpg');

    rerender(
      <PersonAvatar
        fullName="Jack Cyganiak"
        email="jack@jettx.ai"
        avatarUrl="https://img.example/avatar.jpg?v=200"
      />,
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://img.example/avatar.jpg?v=200',
    );
  });
});
