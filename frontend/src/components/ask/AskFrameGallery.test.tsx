import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskFrameGallery } from './AskFrameGallery';
import { extractAskSources } from '../../lib/askSources';

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

  it('draws nothing when the server returns no stills this person may see', async () => {
    const { container } = render(<AskFrameGallery frames={extractAskSources(answer).frames} onOpen={() => {}} load={async () => []} />);
    await waitFor(() => expect(container.querySelector('[data-testid="ask-frames-loading"]')).toBeNull());
    expect(container.querySelector('[data-testid="ask-frames"]')).toBeNull();
  });
});
