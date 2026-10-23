import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { VoicePrivacyCard } from './VoicePrivacyCard';

describe('VoicePrivacyCard', () => {
  it('shows only the two privacy switches, no recording or upload', () => {
    render(<VoicePrivacyCard preview={{ enabled: true, consentedAt: null, learned: true, crossCompanyOptIn: false }} />);
    expect(screen.getByTestId('voice-recognition-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('voice-cross-company-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/record sample|upload sample/i)).toBeNull();
  });

  it('cross-company stays off and locked until a voice is learned', () => {
    render(<VoicePrivacyCard preview={{ enabled: true, consentedAt: null, learned: false, crossCompanyOptIn: false }} />);
    expect(screen.getByTestId('voice-cross-company-switch')).toBeDisabled();
  });

  it('turning recognition off clears cross-company too', async () => {
    const user = userEvent.setup();
    render(<VoicePrivacyCard preview={{ enabled: true, consentedAt: null, learned: true, crossCompanyOptIn: true }} />);
    await user.click(screen.getByTestId('voice-recognition-switch'));
    expect(screen.getByTestId('voice-recognition-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('voice-cross-company-switch')).toHaveAttribute('aria-checked', 'false');
  });
});
