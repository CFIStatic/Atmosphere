import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const usePhoneShell = vi.fn(() => true);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

vi.mock('./JobAskPanel', () => ({
  JobAskPanel: () => <div data-testid="job-ask-panel" aria-label="Ask this job" />,
}));

import { JobFileAskChrome } from './JobFileAskChrome';

const chromeSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), './JobFileAskChrome.tsx'),
  'utf8',
);

describe('JobFileAskChrome phone tabs', () => {
  it('does not let a bare flex class keep the inactive Ask pane on screen', () => {
    render(
      <JobFileAskChrome jobId="job-1">
        <p>File body</p>
      </JobFileAskChrome>,
    );

    expect(screen.getByText('File body')).toBeInTheDocument();
    const ask = screen.getByTestId('job-file-ask');
    expect(ask).toHaveAttribute('hidden');
    expect(ask).toHaveAttribute('data-state', 'inactive');
    expect(ask.className.split(/\s+/)).not.toContain('flex');
    expect(ask.className).toMatch(/data-\[state=active\]:flex/);
    expect(ask.className).toMatch(/data-\[state=inactive\]:hidden/);
  });

  it('keeps the File pane as the only flex-grow panel while it is open', () => {
    render(
      <JobFileAskChrome jobId="job-1">
        <p>File body</p>
      </JobFileAskChrome>,
    );

    const file = screen.getByText('File body').closest('[role="tabpanel"]');
    expect(file).toHaveAttribute('data-state', 'active');
    expect(file).not.toHaveAttribute('hidden');
    expect(file?.className).toMatch(/flex-1/);
    expect(file?.className).toMatch(/overflow-y-auto/);
  });
});

describe('JobFileAskChrome section placement', () => {
  it('renders a single column with no Ask chrome when askPlacement is section', () => {
    render(
      <JobFileAskChrome jobId="job-1" askPlacement="section">
        <div>File body</div>
      </JobFileAskChrome>,
    );
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-placement', 'section');
    expect(screen.getByText('File body')).toBeInTheDocument();
    expect(screen.queryByTestId('job-file-ask')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-ask-split')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
  });
});

describe('JobFileAskChrome initial pane', () => {
  it('opens Ask when the emailed Ask link requested it', () => {
    render(
      <JobFileAskChrome jobId="job-1" initialPane="ask">
        <p>File body</p>
      </JobFileAskChrome>,
    );

    const ask = screen.getByTestId('job-file-ask');
    expect(ask).toHaveAttribute('data-state', 'active');
    expect(ask).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('job-ask-panel')).toBeInTheDocument();
  });
});

describe('JobFileAskChrome source', () => {
  it('pins Ask on the left of the job file on desktop split layout', () => {
    expect(chromeSrc).toContain('askPlacement === \'section\'');
    expect(chromeSrc).toContain("askPlacement?: 'split' | 'section'");
    // Split branch still docks Ask left of the file with the resize handle between.
    const splitBranch = chromeSrc.slice(chromeSrc.indexOf(') : phone ? ('));
    const askIdx = splitBranch.indexOf('data-testid="job-file-ask"');
    const splitIdx = splitBranch.indexOf('data-testid="job-file-ask-split"');
    const fileIdx = splitBranch.lastIndexOf('{children}');
    expect(askIdx).toBeGreaterThan(-1);
    expect(splitIdx).toBeGreaterThan(askIdx);
    expect(fileIdx).toBeGreaterThan(splitIdx);
    expect(chromeSrc).toContain('lg:w-[var(--job-file-ask-width)]');
    expect(chromeSrc).toContain('desktop pins Ask on the left');
  });

  it('exposes a desktop-only drag resize handle between Ask and the job file', () => {
    expect(chromeSrc).toContain('data-testid="job-file-ask-split"');
    expect(chromeSrc).toContain('role="separator"');
    expect(chromeSrc).toContain('hidden');
    expect(chromeSrc).toContain('lg:block');
    expect(chromeSrc).toContain('writeAskSplitWidth');
    expect(chromeSrc).toContain('onDoubleClick');
    expect(chromeSrc).toContain('cursor-col-resize');
    expect(chromeSrc).toContain('job-file-ask-split-grip');
    expect(chromeSrc).toContain('GripVertical');
    expect(chromeSrc).toContain('-left-2 w-4');
  });

  it('does not put a bare flex utility on the Ask TabPanel', () => {
    expect(chromeSrc).toContain(
      'min-h-0 flex-1 flex-col outline-none data-[state=active]:flex data-[state=inactive]:hidden',
    );
    expect(chromeSrc).not.toContain('className="flex min-h-0 flex-1 flex-col outline-none"');
  });

  it('strips Overview-labeled backs so File/Ask cannot sit under that row', () => {
    expect(chromeSrc).toContain('function isOverviewBack');
    expect(chromeSrc).toContain('data-job-file-chrome="no-overview-back"');
    expect(chromeSrc).toContain('shownBack');
  });
});

describe('JobFileAskChrome forbids Overview back', () => {
  it('does not paint an Overview button or link on the phone File/Ask chrome', () => {
    render(
      <JobFileAskChrome
        jobId="job-1"
        back={
          <button type="button" onClick={() => undefined}>
            Overview
          </button>
        }
      >
        <p>File body</p>
      </JobFileAskChrome>,
    );

    expect(screen.getByRole('tab', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-file')).toHaveAttribute(
      'data-job-file-chrome',
      'no-overview-back',
    );
  });

  it('does not paint an Overview back that navigates to /field', () => {
    render(
      <JobFileAskChrome jobId="job-1" back={<a href="/field">Overview</a>}>
        <p>File body</p>
      </JobFileAskChrome>,
    );

    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-back')).not.toBeInTheDocument();
  });

  it('still paints a Job Files back when a caller needs that destination', () => {
    render(
      <JobFileAskChrome jobId="job-1" back={<a href="/jobs">Job Files</a>}>
        <p>File body</p>
      </JobFileAskChrome>,
    );

    expect(screen.getByTestId('job-file-back')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Job Files' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
  });

  it('strips Overview on desktop so the job title sits flush under the header', () => {
    usePhoneShell.mockReturnValue(false);
    render(
      <JobFileAskChrome
        jobId="job-1"
        back={
          <button type="button" onClick={() => undefined}>
            Overview
          </button>
        }
      >
        <p>File body</p>
      </JobFileAskChrome>,
    );

    expect(screen.queryByRole('button', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-back')).not.toBeInTheDocument();
    expect(screen.getByText('File body')).toBeInTheDocument();
  });
});

describe('JobFileAskChrome desktop split', () => {
  it('renders the resize handle on desktop and not on phone', () => {
    usePhoneShell.mockReturnValue(false);
    const { unmount } = render(
      <JobFileAskChrome jobId="job-1">
        <p>File body</p>
      </JobFileAskChrome>,
    );
    const split = screen.getByTestId('job-file-ask-split');
    expect(split).toBeInTheDocument();
    expect(split).toHaveClass('cursor-col-resize');
    expect(screen.getByTestId('job-file-ask-split-grip')).toBeInTheDocument();
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-width');
    unmount();

    usePhoneShell.mockReturnValue(true);
    render(
      <JobFileAskChrome jobId="job-1">
        <p>File body</p>
      </JobFileAskChrome>,
    );
    expect(screen.queryByTestId('job-file-ask-split')).not.toBeInTheDocument();
  });

  it('resets the Ask width on double-click of the splitter', () => {
    window.localStorage.setItem('atmosphere.jobFileAskWidth', '420');
    usePhoneShell.mockReturnValue(false);
    render(
      <JobFileAskChrome jobId="job-1">
        <p>File body</p>
      </JobFileAskChrome>,
    );
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-width', '420');
    fireEvent.doubleClick(screen.getByTestId('job-file-ask-split'));
    expect(window.localStorage.getItem('atmosphere.jobFileAskWidth')).toBeNull();
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-width', '512');
  });
});
