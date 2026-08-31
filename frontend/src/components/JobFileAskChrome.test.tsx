import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const usePhoneShell = vi.fn(() => true);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

vi.mock('./JobAskPanel', () => ({
  JobAskPanel: () => <h2>Ask this job</h2>,
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

describe('JobFileAskChrome source', () => {
  it('does not put a bare flex utility on the Ask TabPanel', () => {
    expect(chromeSrc).toContain(
      'min-h-0 flex-1 flex-col outline-none data-[state=active]:flex data-[state=inactive]:hidden',
    );
    expect(chromeSrc).not.toContain('className="flex min-h-0 flex-1 flex-col outline-none"');
  });
});
