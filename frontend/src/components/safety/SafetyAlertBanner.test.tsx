import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SafetyAlertBanner } from './SafetyAlertBanner';
import type { SafetyIncident } from '../../lib/api';

function incident(over: Partial<SafetyIncident> = {}): SafetyIncident {
  return {
    id: 'inc-1',
    orgId: 'org',
    jobId: 'job',
    category: 'physical_violence',
    severity: 'critical',
    confidence: 0.93,
    title: 'Worker being assaulted',
    description: 'Two people struggling; a worker shouts "get off me".',
    clipTimestampSeconds: 35,
    locationLabel: null,
    recommendedAction: 'contact_authorities',
    status: 'open',
    source: 'live_stream',
    createdAt: '2026-10-04T00:31:00.000Z',
    reality: 'real',
    confirmation: 'confirmed',
    ...over,
  };
}

describe('SafetyAlertBanner', () => {
  it('shows a confirmed live alert with Acknowledge and the live-view button', () => {
    const onAck = vi.fn(() => Promise.resolve());
    const onOpenLive = vi.fn();
    render(<SafetyAlertBanner incidents={[incident()]} onAck={onAck} onDismiss={vi.fn()} onOpenLive={onOpenLive} />);
    expect(screen.getByText('critical · confirmed')).toBeTruthy();
    expect(screen.getByText('Checked: looks real · 35s into the recording')).toBeTruthy();
    fireEvent.click(screen.getByText('Acknowledge'));
    expect(onAck).toHaveBeenCalledWith('inc-1');
    fireEvent.click(screen.getByText('Open live view'));
    expect(onOpenLive).toHaveBeenCalled();
  });

  it('marks unconfirmed alerts "check live view" and strips the title prefix', () => {
    render(
      <SafetyAlertBanner
        incidents={[incident({ confirmation: 'unconfirmed', reality: 'unclear', title: 'Unconfirmed: check live view — Possible person down' })]}
        onAck={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Unconfirmed — check live view')).toBeTruthy();
    expect(screen.getByText('Possible person down')).toBeTruthy();
    expect(screen.getByTestId('safety-incident').getAttribute('data-confirmation')).toBe('unconfirmed');
  });

  it('dismiss requires a reason, and "other" requires a note', () => {
    const onDismiss = vi.fn(() => Promise.resolve());
    render(<SafetyAlertBanner incidents={[incident()]} onAck={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Dismiss…'));
    const submit = screen.getByText('Dismiss alert') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const select = screen.getByLabelText('Why are you dismissing this alert?');
    fireEvent.change(select, { target: { value: 'other' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Dismiss note'), { target: { value: 'Drill demo for the new hire' } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'false_alarm_media' } });
    fireEvent.click(submit);
    expect(onDismiss).toHaveBeenCalledWith('inc-1', 'false_alarm_media', 'Drill demo for the new hire');
  });

  it('hides closed or watch-only incidents and shows no worker "I\'m OK" line', () => {
    render(
      <SafetyAlertBanner
        incidents={[
          incident(),
          incident({ id: 'inc-2', status: 'acknowledged' }),
          incident({ id: 'inc-3', severity: 'watch' }),
        ]}
        onAck={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('safety-incident')).toHaveLength(1);
    expect(screen.queryByTestId('safety-worker-ok')).toBeNull();
    expect(document.body.textContent).not.toMatch(/I’m OK/);
  });

  it('renders nothing without open alerts', () => {
    const { container } = render(<SafetyAlertBanner incidents={[]} onAck={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
