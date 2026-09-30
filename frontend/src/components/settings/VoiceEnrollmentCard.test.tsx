import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoiceEnrollmentCard } from './VoiceEnrollmentCard';

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    enrollVoiceprint: vi.fn(),
    confirmVoiceEnrollment: vi.fn(),
  },
}));

describe('VoiceEnrollmentCard', () => {
  it('stops the recording and releases the microphone when consent is unchecked', async () => {
    const user = userEvent.setup();
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    vi.stubGlobal(
      'MediaRecorder',
      class {
        state: 'inactive' | 'recording' = 'inactive';
        onstop: (() => void) | null = null;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          this.onstop?.();
        }
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(
      <VoiceEnrollmentCard preview={{ state: { enrolled: false, consentedAt: null, crossCompanyOptIn: false } }} />,
    );
    const record = screen.getByTestId('voice-record');
    expect(record).toBeDisabled();
    await user.click(screen.getByTestId('voice-consent-check'));
    await user.click(record);
    expect(await screen.findByRole('button', { name: 'Stop and save' })).toBeInTheDocument();
    await user.click(screen.getByTestId('voice-consent-check'));
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByTestId('voice-record')).toBeDisabled();
    const { api } = await import('../../lib/api');
    expect(api.enrollVoiceprint).not.toHaveBeenCalled();
  });
});
