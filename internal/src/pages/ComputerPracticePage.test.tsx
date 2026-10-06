import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComputerPracticePage } from './ComputerPracticePage';
import type { PracticeSummaryPayload } from '../lib/types';

const computerPractice = vi.fn();
const computerPlaybookDrafts = vi.fn();
const computerPracticeRun = vi.fn();
const approvePlaybookDraft = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      computerPractice: (...a: unknown[]) => computerPractice(...a),
      computerPlaybookDrafts: (...a: unknown[]) => computerPlaybookDrafts(...a),
      computerPracticeRun: (...a: unknown[]) => computerPracticeRun(...a),
      approvePlaybookDraft: (...a: unknown[]) => approvePlaybookDraft(...a),
    },
  };
});

const SUMMARY: PracticeSummaryPayload = {
  generatedAt: '2026-10-06T15:00:00Z',
  days: 2,
  today: '2026-10-06',
  orgConfigured: true,
  schedule: { enabled: true, hourUtc: 9 },
  totals: {
    runs: 3,
    attempted: 2,
    succeeded: 1,
    failed: 1,
    needsLogin: 1,
    successRate: 50,
    costUsd: 0.42,
    modelCalls: 9,
    playbookRuns: 1,
    avgDurationSec: 40,
  },
  tasks: [
    {
      key: 'practice_forms.fill_form',
      site: 'selenium.dev',
      label: 'General web: fill a form, stop before Submit',
      mode: 'stop_before_submit',
      loginHost: null,
      runs: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      needsLogin: 0,
      successRate: 50,
      lastStatus: 'succeeded',
      lastRunAt: null,
      lastRunId: 'r2',
      lastFailure: null,
      days: [
        { date: '2026-10-05', status: 'failed', runId: 'r1' },
        { date: '2026-10-06', status: 'succeeded', runId: 'r2' },
      ],
    },
    {
      key: 'gmail.read_inbox',
      site: 'google.com',
      label: 'Gmail (Google): read the inbox',
      mode: 'read_only',
      loginHost: 'mail.google.com',
      runs: 1,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      needsLogin: 1,
      successRate: null,
      lastStatus: 'needs_login',
      lastRunAt: null,
      lastRunId: 'r3',
      lastFailure: 'No saved Login for mail.google.com.',
      days: [
        { date: '2026-10-05', status: null, runId: null },
        { date: '2026-10-06', status: 'needs_login', runId: 'r3' },
      ],
    },
  ],
  daily: [],
  recent: [],
  playbooks: [
    {
      id: 'p1',
      site: 'selenium.dev',
      taskType: 'fill_form',
      version: 2,
      source: 'success',
      status: 'active',
      steps: 5,
      successCount: 1,
      replaySuccessCount: 3,
      failureCount: 0,
      lastSuccessAt: null,
      updatedAt: '2026-10-06T15:00:00Z',
    },
  ],
  pendingDrafts: 1,
  coverage: {
    sites: [
      {
        id: 'gmail',
        name: 'Gmail (Google)',
        category: 'Email and calendar',
        terms: 'restricted',
        termsNote: 'n',
        termsUrl: 'https://policies.google.com/terms',
        inPicker: true,
        signIn: { flow: 'username_first', checked: 'live_page' },
        twoStep: 'likely',
        sso: true,
        practiceTasks: ['gmail.read_inbox'],
        needsTestLogin: true,
      },
      {
        id: 'homedepot',
        name: 'The Home Depot / Pro',
        category: 'Suppliers',
        terms: 'flagged',
        termsNote: 'n',
        termsUrl: 'https://www.homedepot.com/c/Terms_of_Use',
        inPicker: true,
        signIn: { flow: 'username_first', checked: 'live_page' },
        twoStep: 'sometimes',
        sso: false,
        practiceTasks: ['homedepot.supplier_search'],
        needsTestLogin: true,
      },
      {
        id: 'allstate',
        name: 'Allstate provider portal',
        category: 'Insurance carriers and claims',
        terms: 'flagged',
        termsNote: 'n',
        termsUrl: 'https://www.allstate.com/terms',
        inPicker: false,
        signIn: null,
        twoStep: 'sometimes',
        sso: false,
        practiceTasks: [],
        needsTestLogin: false,
      },
    ],
    excluded: [{ name: 'Xactimate', reason: 'Verisk’s EULA prohibits AI and automation tools.' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  computerPractice.mockResolvedValue(SUMMARY);
  computerPlaybookDrafts.mockResolvedValue({
    drafts: [
      {
        id: 'd1',
        site: 'jobnimbus.com',
        taskType: 'demonstration',
        source: 'demonstration',
        status: 'pending',
        stepCount: 2,
        steps: [
          { index: 0, kind: 'click', text: 'Click “Jobs” (link)', slot: null },
          { index: 1, kind: 'explore', text: 'Find the right item', slot: null },
        ],
        reviewNote: null,
        reviewedAt: null,
        playbookId: null,
        createdAt: '2026-10-06T15:00:00Z',
      },
    ],
  });
});

describe('ComputerPracticePage', () => {
  it('shows success rates, needs-login tasks, playbooks and coverage with the terms flag as staff data', async () => {
    render(<ComputerPracticePage />);
    expect(await screen.findByText('50%', { selector: 'p' })).toBeInTheDocument();
    const tasks = screen.getByTestId('practice-tasks');
    expect(within(tasks).getByText('No saved Login for mail.google.com.')).toBeInTheDocument();
    expect(within(screen.getByTestId('practice-playbooks')).getByText('v2')).toBeInTheDocument();
    const cov = screen.getByTestId('practice-coverage');
    expect(within(cov).getAllByText('Bans automation')).toHaveLength(2);
    expect(within(cov).getAllByText('In picker')).toHaveLength(2);
    expect(within(cov).getByText('Hidden')).toBeInTheDocument();
    expect(within(cov).getAllByText('Sign-in: username, then password')).toHaveLength(2);
    expect(within(cov).getByText(/Excluded: Verisk/)).toBeInTheDocument();
  });

  it('opens a run with its steps, screenshots and routing; approves a draft without a removed step', async () => {
    const user = userEvent.setup();
    computerPracticeRun.mockResolvedValue({
      id: 'r1',
      date: '2026-10-05',
      taskKey: 'practice_forms.fill_form',
      site: 'selenium.dev',
      mode: 'stop_before_submit',
      status: 'failed',
      failedStep: 1,
      failureReason: 'Clicked “Submit”, but nothing changed.',
      usedPlaybook: false,
      playbookVersion: null,
      modelCalls: 4,
      costUsd: 0.2,
      durationSec: 30,
      startedAt: '',
      finishedAt: '',
      label: 'General web: fill a form',
      instructions: null,
      taskType: 'fill_form',
      taskId: 't1',
      steps: [
        { index: 0, label: 'Typed in “Text input”', ok: true, via: 'model' },
        { index: 1, label: 'Clicked “Submit”', ok: false, via: 'model', note: 'Nothing changed.' },
      ],
      screens: [{ index: 0, label: 'Start page', src: 'data:image/jpeg;base64,AAAA' }],
      routes: [
        { step: 1, route: 'strong', model: 'claude-opus-5-5', reason: 'Planning the first step.' },
      ],
    });
    approvePlaybookDraft.mockResolvedValue({});
    render(<ComputerPracticePage />);
    await user.click(await screen.findByTitle('2026-10-05: failed'));
    const detail = await screen.findByTestId('practice-run-detail');
    expect(await within(detail).findByText(/Planning the first step/)).toBeInTheDocument();
    expect(within(detail).getByAltText('Start page')).toBeInTheDocument();
    const draft = screen.getByTestId('playbook-draft');
    await user.click(within(draft).getAllByRole('checkbox')[1]);
    await user.click(within(draft).getByRole('button', { name: 'Approve' }));
    expect(approvePlaybookDraft).toHaveBeenCalledWith('d1', {
      taskType: 'demonstration',
      removeSteps: [1],
    });
  });
});
