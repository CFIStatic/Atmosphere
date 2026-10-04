import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComputerTaskView } from '../../lib/computer';
import { isAllowedLiveViewUrl } from '../../lib/computer';
import { ComputerTaskCard } from './ComputerTaskCard';

const computerTask = vi.fn();
const computerLiveView = vi.fn();
const computerApprove = vi.fn();
const computerCancelApproval = vi.fn();
const computerResume = vi.fn();
const computerCancel = vi.fn();
const computerHandBack = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      computerTask: (...a: unknown[]) => computerTask(...a),
      computerLiveView: (...a: unknown[]) => computerLiveView(...a),
      computerApprove: (...a: unknown[]) => computerApprove(...a),
      computerCancelApproval: (...a: unknown[]) => computerCancelApproval(...a),
      computerResume: (...a: unknown[]) => computerResume(...a),
      computerCancel: (...a: unknown[]) => computerCancel(...a),
      computerHandBack: (...a: unknown[]) => computerHandBack(...a),
    },
  };
});

const ID = '11111111-2222-4333-8444-555555555555';
const LIVE = 'https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com/debug/x';

function task(over: Partial<ComputerTaskView> = {}): ComputerTaskView {
  return {
    id: ID,
    jobId: 'job-1',
    status: 'running',
    statusDetail: null,
    instructions: 'Fill out the claim form on portal.example.test',
    startUrl: 'https://portal.example.test/',
    needsYou: null,
    humanControl: false,
    youHaveControl: false,
    stepCount: 4,
    maxSteps: 60,
    lastAction: 'typed into “Claim number”',
    currentUrl: 'https://portal.example.test/claims/new',
    resultSummary: null,
    error: null,
    createdAt: '2026-10-04T15:00:00Z',
    startedAt: '2026-10-04T15:00:01Z',
    finishedAt: null,
    canWatch: true,
    jobFields: [{ label: 'Claim number', value: 'CLM-1', source: 'Job: Claim number' }],
    approval: null,
    events: [{ id: 1, event: 'task_queued', actor: 'user', at: '2026-10-04T15:00:00Z', detail: {} }],
    ...over,
  };
}

const approval: NonNullable<ComputerTaskView['approval']> = {
  id: 'ap-1',
  status: 'pending',
  actionKind: 'submit',
  buttonLabel: 'Submit claim',
  summary: 'Submits the claim.',
  pageUrl: 'https://portal.example.test/claims/new',
  fields: [
    { label: 'Claim number', value: 'CLM-1', source: 'Job: Claim number', verified: true },
    { label: 'Cause of loss', value: 'Hail', source: 'Not from the job or your message (check this)', verified: false },
  ],
  screenshot: 'data:image/jpeg;base64,AAAA',
  requestedAt: '2026-10-04T15:01:00Z',
  expiresAt: '2026-10-04T15:11:00Z',
};

beforeEach(() => {
  for (const fn of [computerTask, computerLiveView, computerApprove, computerCancelApproval, computerResume, computerCancel, computerHandBack]) {
    fn.mockReset();
  }
  computerLiveView.mockResolvedValue({ url: LIVE, expiresAt: new Date(Date.now() + 300_000).toISOString(), mode: 'watch' });
  for (const fn of [computerApprove, computerCancelApproval, computerResume, computerCancel, computerHandBack]) {
    fn.mockResolvedValue({ ok: true });
  }
});

describe('ComputerTaskCard', () => {
  it('shows "Computer isn\'t set up" without calling the API', () => {
    render(<ComputerTaskCard path="computer-task:not-set-up" summary="x" />);
    expect(screen.getByTestId('computer-not-set-up')).toHaveTextContent("Computer isn't set up");
    expect(computerTask).not.toHaveBeenCalled();
  });

  it('shows a running task with Watch, Take control and Stop', async () => {
    computerTask.mockResolvedValue({ task: task() });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByText('Step 4 of 60')).toBeInTheDocument();
    expect(screen.getByText('portal.example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take control' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('Watch frames the per-viewer live link with the pointer blocked', async () => {
    computerTask.mockResolvedValue({ task: task() });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Watch' }));
    const frame = await screen.findByTestId('computer-live-iframe');
    expect(computerLiveView).toHaveBeenCalledWith(ID, 'watch');
    expect(frame).toHaveAttribute('src', LIVE);
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.style.pointerEvents).toBe('none');
  });

  it('refuses to frame a live link from anywhere else', async () => {
    computerTask.mockResolvedValue({ task: task() });
    computerLiveView.mockResolvedValue({ url: 'https://evil.test/x', expiresAt: new Date(Date.now() + 300_000).toISOString(), mode: 'watch' });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Watch' }));
    expect(await screen.findByText(/did not come from the browser service/)).toBeInTheDocument();
    expect(screen.queryByTestId('computer-live-iframe')).toBeNull();
    expect(isAllowedLiveViewUrl(LIVE, false)).toBe(true);
    expect(isAllowedLiveViewUrl('data:text/html,hi', false)).toBe(false);
    expect(isAllowedLiveViewUrl('http://www.browserbase.com/x', false)).toBe(false);
  });

  it('approval card lists each field with value and source, and Approve calls the API', async () => {
    computerTask.mockResolvedValue({ task: task({ status: 'awaiting_approval', approval }) });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    const card = await screen.findByTestId('computer-approval-card');
    expect(within(card).getByTestId('computer-approval-screenshot')).toHaveAttribute('src', approval.screenshot);
    const rows = within(card).getAllByTestId('computer-approval-field');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Claim number');
    expect(rows[0]).toHaveTextContent('CLM-1');
    expect(rows[0]).toHaveTextContent('Job: Claim number');
    expect(rows[1]).toHaveTextContent('check this');
    expect(within(card).getAllByText(/Submit claim/).length).toBeGreaterThan(0);
    await userEvent.click(within(card).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(computerApprove).toHaveBeenCalledWith('ap-1'));
  });

  it('approval Cancel and Take control', async () => {
    computerTask.mockResolvedValue({ task: task({ status: 'awaiting_approval', approval }) });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    const card = await screen.findByTestId('computer-approval-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(computerCancelApproval).toHaveBeenCalledWith('ap-1'));
    await userEvent.click(within(card).getByRole('button', { name: 'Take control' }));
    await waitFor(() => expect(computerLiveView).toHaveBeenCalledWith(ID, 'control'));
    const frame = await screen.findByTestId('computer-live-iframe');
    expect(frame.style.pointerEvents).toBe('');
  });

  it('Needs you card: Take control, resume and cancel', async () => {
    computerTask.mockResolvedValue({
      task: task({
        status: 'needs_you',
        needsYou: { reason: 'two_factor', message: 'Enter the code the site sent you.', since: '2026-10-04T15:01:00Z' },
      }),
    });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    const card = await screen.findByTestId('computer-needs-you-card');
    expect(card).toHaveTextContent('Enter the code the site sent you.');
    await userEvent.click(within(card).getByRole('button', { name: 'Take control' }));
    await waitFor(() => expect(computerLiveView).toHaveBeenCalledWith(ID, 'control'));
    await userEvent.click(within(card).getByRole('button', { name: "I'm done, resume" }));
    await waitFor(() => expect(computerResume).toHaveBeenCalledWith(ID));
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(computerCancel).toHaveBeenCalledWith(ID));
  });

  it('finished task shows the result and no live controls', async () => {
    computerTask.mockResolvedValue({
      task: task({ status: 'succeeded', canWatch: false, resultSummary: 'Saved the draft. Nothing was submitted.' }),
    });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByText('Saved the draft. Nothing was submitted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Watch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('Computer live view CSP', () => {
  it('the app CSP lets the Browserbase live view frame load and nothing broader', () => {
    const conf = readFileSync(resolve(__dirname, '../../../nginx/security-headers.conf'), 'utf8');
    const frameSrc = conf.match(/frame-src ([^;]+);/)?.[1];
    expect(frameSrc).toBe("'self' https://www.browserbase.com");
  });
});
