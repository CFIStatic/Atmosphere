import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isJobFilePath } from './jobFilePath';

const appSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');

describe('office rail routes', () => {
  it('keeps Overview, Start a job, Dashboard, and Job Files inside the permanent office shell', () => {
    const start = appSrc.indexOf('<OperationsShell');
    const end = appSrc.indexOf('path="/technician"');
    const shell = appSrc.slice(start, end);
    expect(shell).toContain('path="/field"');
    expect(shell).toContain('path="/intake"');
    expect(shell).toContain('path="/verifier-library"');
    expect(shell).toContain('path="/jobs"');
  });
});

describe('isJobFilePath', () => {
  it('treats a job profile as a full-height file, not the Job Files list', () => {
    expect(isJobFilePath('/jobs/job-1038')).toBe(true);
    expect(isJobFilePath('/jobs')).toBe(false);
    expect(isJobFilePath('/field')).toBe(false);
  });
});

describe('job-file viewport lock', () => {
  it('locks the job file to the viewport so Ask can stay pinned on the right', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('lg:h-screen lg:overflow-hidden');
    expect(shell).toContain('lg:overflow-hidden');
  });
});

describe('Job Files search chrome', () => {
  it('puts the Dashboard search field in the 72px office top bar', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('DashboardSearchBar');
    expect(shell).toContain('h-[72px]');
    expect(shell).toContain("pathname === '/jobs'");
  });
});
