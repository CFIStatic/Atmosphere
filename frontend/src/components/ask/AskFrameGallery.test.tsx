import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskFrameGallery } from './AskFrameGallery';
import { extractAskSources, type AskFrameRef } from '../../lib/askSources';
import { setViewerTimeZoneForTests } from '../../lib/viewerTime';

const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const A = '11111111-2222-4333-8444-555555555520';
const B = '11111111-2222-4333-8444-555555555522';
const answer = `By the 22nd the treads are replaced.\n\n⟦frames: video/${JOB}/${A}/demo-day@40, video/${JOB}/${B}/stairs-rebuilt@15⟧\n\n⟦sources: video/${JOB}/${A}/demo-day@40⟧`;

describe('Chat video stills', () => {
  it('parses the frames line out of the prose', () => {
    const out = extractAskSources(answer);
    expect(out.body).toBe('By the 22nd the treads are replaced.');
    expect(out.frames.map((f) => [f.proofId, f.atSeconds])).toEqual([[A, 40], [B, 15]]);
  });

  it('two days render as before / after; a still opens the video at its moment', async () => {
    const onOpen = vi.fn();
    const load = vi.fn().mockResolvedValue([
      { proofId: A, jobId: JOB, requestedSeconds: 40, atSeconds: 40, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Demo day', workDate: '2026-10-20', capturedAt: null },
      { proofId: B, jobId: JOB, requestedSeconds: 15, atSeconds: 15, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Stairs rebuilt', workDate: '2026-10-22', capturedAt: null },
    ]);
    render(<AskFrameGallery frames={extractAskSources(answer).frames} onOpen={onOpen} load={load} />);
    await waitFor(() => expect(screen.getAllByTestId('ask-frame')).toHaveLength(2));
    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('ask-frame-open')[1]!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ proofId: B, atSeconds: 15, jobId: JOB }));
  });

  it('labels the earlier calendar day Before when the later day is listed first', async () => {
    const later: AskFrameRef = { id: `video/${JOB}/${B}/stairs-rebuilt@15`, jobId: JOB, proofId: B, slug: 'stairs-rebuilt', atSeconds: 15 };
    const earlier: AskFrameRef = { id: `video/${JOB}/${A}/demo-day@40`, jobId: JOB, proofId: A, slug: 'demo-day', atSeconds: 40 };
    const load = vi.fn().mockResolvedValue([
      { proofId: B, jobId: JOB, requestedSeconds: 15, atSeconds: 15, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Stairs rebuilt', workDate: '2026-10-22', capturedAt: null },
      { proofId: A, jobId: JOB, requestedSeconds: 40, atSeconds: 40, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Demo day', workDate: '2026-10-20', capturedAt: null },
    ]);
    render(<AskFrameGallery frames={[later, earlier]} onOpen={() => {}} load={load} />);
    await waitFor(() => expect(screen.getAllByTestId('ask-frames-day')).toHaveLength(2));
    const days = screen.getAllByTestId('ask-frames-day');
    expect(days[0]!.textContent).toContain('Before');
    expect(days[0]!.querySelector('[data-proof-id]')?.getAttribute('data-proof-id')).toBe(A);
    expect(days[1]!.textContent).toContain('After');
    expect(days[1]!.querySelector('[data-proof-id]')?.getAttribute('data-proof-id')).toBe(B);
  });

  it('groups a late-evening capture by the viewer day, not the UTC date', async () => {
    setViewerTimeZoneForTests('America/Chicago');
    try {
      const evening: AskFrameRef = { id: `video/${JOB}/${A}/evening@40`, jobId: JOB, proofId: A, slug: 'evening', atSeconds: 40 };
      const afternoon: AskFrameRef = { id: `video/${JOB}/${B}/afternoon@15`, jobId: JOB, proofId: B, slug: 'afternoon', atSeconds: 15 };
      const load = vi.fn().mockResolvedValue([
        // 9:30 PM Chicago on Oct 20 (already Oct 21 in UTC).
        { proofId: A, jobId: JOB, requestedSeconds: 40, atSeconds: 40, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Evening', workDate: null, capturedAt: '2026-10-21T02:30:00.000Z' },
        // 1:00 PM Chicago the same local day.
        { proofId: B, jobId: JOB, requestedSeconds: 15, atSeconds: 15, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: 'Afternoon', workDate: null, capturedAt: '2026-10-20T18:00:00.000Z' },
      ]);
      render(<AskFrameGallery frames={[evening, afternoon]} onOpen={() => {}} load={load} />);
      await waitFor(() => expect(screen.getAllByTestId('ask-frame')).toHaveLength(2));
      expect(screen.getAllByTestId('ask-frames-day')).toHaveLength(1);
      const label = new Date('2026-10-20T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      expect(screen.getByTestId('ask-frames-day').textContent).toContain(label);
      expect(screen.queryByText('Before')).toBeNull();
    } finally {
      setViewerTimeZoneForTests(null);
    }
  });

  it('draws nothing when the server returns no stills this person may see', async () => {
    const { container } = render(<AskFrameGallery frames={extractAskSources(answer).frames} onOpen={() => {}} load={async () => []} />);
    await waitFor(() => expect(container.querySelector('[data-testid="ask-frames-loading"]')).toBeNull());
    expect(container.querySelector('[data-testid="ask-frames"]')).toBeNull();
  });
});
