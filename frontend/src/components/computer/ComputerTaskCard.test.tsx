import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComputerTaskView } from '../../lib/computer';
import { isAllowedLiveViewUrl } from '../../lib/computer';
import { ComputerTaskCard } from './ComputerTaskCard';
import { extractAskSources } from '../../lib/askSources';

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
    result: null,
    submitted: false,
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

  it('shows Logins card for bare path logins (not NotSetUp)', () => {
    render(<ComputerTaskCard path="logins" summary="Add Outlook under Logins." />);
    expect(screen.queryByTestId('computer-not-set-up')).toBeNull();
    expect(screen.getByTestId('computer-need-login')).toHaveTextContent('Sign in under Logins');
    expect(screen.getByTestId('computer-need-login')).toHaveTextContent('Add Outlook under Logins.');
    expect(computerTask).not.toHaveBeenCalled();
  });

  it('shows Logins card for computer-task:need-login', () => {
    render(<ComputerTaskCard path="computer-task:need-login" summary="Need a CRM login." />);
    expect(screen.queryByTestId('computer-not-set-up')).toBeNull();
    expect(screen.getByTestId('computer-need-login')).toHaveTextContent('Need a CRM login.');
  });

  it('shows exact draft preview without calling the API', () => {
    render(
      <ComputerTaskCard
        path="computer-task:draft-preview"
        summary={"To: a@b.com\nSubject: Update\n\nBody text"}
      />,
    );
    expect(screen.queryByTestId('computer-not-set-up')).toBeNull();
    expect(screen.getByTestId('computer-draft-preview')).toHaveTextContent('Exact draft');
    expect(screen.getByTestId('computer-draft-preview')).toHaveTextContent('To: a@b.com');
    expect(computerTask).not.toHaveBeenCalled();
  });

  it('renders nothing for an unknown path instead of NotSetUp', () => {
    const { container } = render(<ComputerTaskCard path="something-else" summary="x" />);
    expect(screen.queryByTestId('computer-not-set-up')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a running task with Watch, Take control and Stop', async () => {
    computerTask.mockResolvedValue({ task: task() });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByTestId('computer-task-title')).toHaveTextContent('portal.example.test: in progress');
    expect(screen.getByTestId('computer-task-pill')).toHaveTextContent('Working');
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
    expect(screen.queryByText('Fill out the claim form on portal.example.test')).toBeNull();
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
    expect(screen.getByTestId('computer-task-pill')).toHaveTextContent('Waiting for approval');
    expect(screen.getByTestId('computer-task-title')).toHaveTextContent('portal.example.test: ready to submit claim');
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
    expect(screen.getByTestId('computer-task-pill')).toHaveTextContent('Needs you');
    expect(screen.getByTestId('computer-task-title')).toHaveTextContent('portal.example.test: code needed');
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

  it('done, not submitted: site and title, the fields filled, one note, and steps in plain words', async () => {
    // The real httpbin run (task 172a749a): 2 model turns, 14 audit events.
    const ev = (id: number, event: string, detail: Record<string, unknown> = {}) => ({
      id,
      event,
      actor: 'agent',
      at: '2026-10-04T15:00:00Z',
      detail,
    });
    computerTask.mockResolvedValue({
      task: task({
        status: 'succeeded',
        canWatch: false,
        stepCount: 2,
        startUrl: 'https://httpbin.org/forms/post',
        currentUrl: 'https://httpbin.org/forms/post',
        instructions: 'Fill in the form at https://httpbin.org/forms/post with this job. Do not submit.',
        resultSummary: 'No customer details on this job, so test values were used.',
        result: {
          title: 'Form filled',
          fields: [
            { label: 'Customer name:', value: 'Test Customer' },
            { label: 'Telephone', value: '555-0100' },
            { label: 'E-mail address', value: 'test@example.com' },
          ],
          notes: 'No customer details on this job, so test values were used.',
        },
        events: [
          ev(1, 'task_queued'),
          ev(2, 'task_started'),
          ev(3, 'context_created'),
          ev(4, 'session_started'),
          ev(5, 'navigate', { host: 'httpbin.org' }),
          ev(6, 'action', { action: 'left_click', target: { tag: 'input', label: 'Customer name:' } }),
          ev(7, 'action', { action: 'type', field: 'Customer name:', chars: 13 }),
          ev(8, 'action', { action: 'left_click', target: { tag: 'input', label: 'Telephone:' } }),
          ev(9, 'action', { action: 'type', field: 'Telephone:', chars: 8 }),
          ev(10, 'action', { action: 'left_click', target: { tag: 'input', label: 'E-mail address:' } }),
          ev(11, 'action', { action: 'type', field: 'E-mail address:', chars: 16 }),
          ev(12, 'finished', { submitted: false }),
          ev(13, 'session_ended'),
          ev(14, 'task_finished', { status: 'succeeded', submitted: false }),
        ],
      }),
    });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByTestId('computer-task-title')).toHaveTextContent('httpbin.org: form filled');
    expect(screen.getByTestId('computer-task-pill')).toHaveTextContent('Done, not submitted');
    const fields = screen.getByTestId('computer-result-fields');
    expect(fields).toHaveTextContent('Customer name');
    expect(fields).not.toHaveTextContent('Customer name:');
    expect(fields).toHaveTextContent('555-0100');
    expect(screen.getByTestId('computer-result-note')).toHaveTextContent('No customer details on this job, so test values were used.');
    expect(screen.queryByText(/Step \d+ of/)).toBeNull();
    expect(screen.queryByText(/Fill in the form at/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Steps (6)' }));
    const steps = within(screen.getByTestId('computer-steps')).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toEqual([
      'Opened a browser',
      'Opened httpbin.org',
      'Filled in “Customer name”',
      'Filled in “Telephone”',
      'Filled in “E-mail address”',
      'Finished',
    ]);
  });

  it('a saved-login sign-in shows as one plain step', async () => {
    const ev = (id: number, event: string, detail: Record<string, unknown> = {}, actor = 'agent') => ({
      id,
      event,
      actor,
      at: '2026-10-04T15:00:00Z',
      detail,
    });
    computerTask.mockResolvedValue({
      task: task({
        status: 'succeeded',
        canWatch: false,
        result: { title: 'Draft saved', fields: [], notes: null },
        events: [
          ev(1, 'task_queued'),
          ev(2, 'navigate', { host: 'portal.example-carrier.test' }),
          ev(3, 'auto_sign_in', { host: 'portal.example-carrier.test', outcome: 'signed_in' }, 'system'),
          ev(4, 'auto_sign_in', { host: 'identity.xactware.com', outcome: 'failed' }, 'system'),
          ev(5, 'finished', { submitted: false }),
        ],
      }),
    });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    await userEvent.click(await screen.findByRole('button', { name: /Steps \(\d+\)/ }));
    const steps = within(screen.getByTestId('computer-steps')).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toContain('Signed in to portal.example-carrier.test with the saved login');
    expect(steps).toContain('The saved login for identity.xactware.com didn’t work');
  });

  it('a submitted task says Submitted only when an approved click went through', async () => {
    computerTask.mockResolvedValue({
      task: task({ status: 'succeeded', canWatch: false, submitted: true, result: { title: 'Claim submitted', fields: [], notes: null } }),
    });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByTestId('computer-task-pill')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('computer-task-title')).toHaveTextContent('portal.example.test: claim submitted');
  });

  it('failed and stopped pills', async () => {
    computerTask.mockResolvedValueOnce({ task: task({ status: 'failed', canWatch: false, error: 'Stopped: the site did not load.' }) });
    const { unmount } = render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByTestId('computer-task-pill')).toHaveTextContent('Failed');
    unmount();
    computerTask.mockResolvedValueOnce({ task: task({ status: 'canceled', canWatch: false, resultSummary: 'Canceled.' }) });
    render(<ComputerTaskCard path={`computer-task:${ID}`} />);
    expect(await screen.findByTestId('computer-task-pill')).toHaveTextContent('Stopped');
  });
});

describe('Computer live view CSP', () => {
  it('the app CSP lets the Browserbase live view frame load and nothing broader', () => {
    const conf = readFileSync(resolve(__dirname, '../../../nginx/security-headers.conf'), 'utf8');
    const frameSrc = conf.match(/frame-src ([^;]+);/)?.[1];
    expect(frameSrc).toBe("'self' https://www.browserbase.com");
  });
});

describe('ComputerTaskCard materials list', () => {
  it('renders the full table from a decoded card payload', async () => {
    const { default: fixture } = await import('../../dev/hdOrderV2Fixture.json');
    render(<ComputerTaskCard path="computer-task:materials-list" summary={fixture.materialsSummary as string} />);
    expect(screen.getAllByTestId('materials-row')).toHaveLength(9);
  });

  it('falls back to the lead sentence only, never raw JSON', () => {
    render(
      <ComputerTaskCard
        path="computer-task:materials-list"
        summary={'Materials on this job file (9 items). Quantities marked unknown were not stated in the evidence.\nMATERIALS_JSON:{"rows":'}
      />,
    );
    const card = screen.getByTestId('computer-materials-list');
    expect(card.textContent).not.toMatch(/MATERIALS_JSON/);
    expect(card.textContent).toMatch(/Materials on this job file \(9 items\)/);
  });
});

describe('ComputerTaskCard text message approval', () => {
  it('shows the full message from the actions trailer, not a 120 character cut', () => {
    const body =
      'Hi Sam, this is the crew on the sample job. We finished the tear-off, dried in the deck, and photographed every slope. Please let us know a good time to walk the roof, and whether you need anything else for the file. Thanks.';
    const draft = ['Here is the text for the adjuster. Nothing was sent yet.', '', 'To: +15555550123', '', body].join('\n');
    const label = `b64:${Buffer.from(draft, 'utf8').toString('base64url')}`;
    const { actions } = extractAskSources(`Draft ready.\n\n⟦actions: start_computer_task|${label}|computer|computer-task:sms-approval⟧`);
    render(<ComputerTaskCard path={actions[0].path} summary={actions[0].label} />);
    const card = screen.getByTestId('computer-sms-approval');
    expect(card.textContent).toContain(body);
    expect(card.textContent).toContain('To: +15555550123');
    expect(card.querySelector('p.whitespace-pre-wrap')?.className).toContain('break-words');
  });
});
