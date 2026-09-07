import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TermsAckCheckbox } from './TermsAckCheckbox';
import { TermsAcknowledgment } from './TermsAcknowledgment';

describe('TermsAckCheckbox', () => {
  it('keeps Continue gated until the acknowledgment is checked', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <MemoryRouter>
        <TermsAcknowledgment onAccept={onAccept} />
      </MemoryRouter>,
    );

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
    const termsLinks = screen.getAllByRole('link', { name: 'Terms of Service' });
    expect(termsLinks.length).toBeGreaterThan(0);
    expect(termsLinks[0]).toHaveAttribute('href', 'https://atmosphereteam.com/terms');
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute(
      'href',
      'https://atmosphereteam.com/privacy',
    );

    await user.click(screen.getByRole('checkbox'));
    expect(continueBtn).toBeEnabled();

    await user.click(continueBtn);
    expect(onAccept).toHaveBeenCalledWith('2026-07-31');
  });

  it('labels the checkbox as an explicit acknowledgment', () => {
    render(<TermsAckCheckbox id="signup-tos" checked={false} onChange={() => undefined} />);
    expect(screen.getByLabelText(/I acknowledge and agree to the/i)).toBeInTheDocument();
  });
});
