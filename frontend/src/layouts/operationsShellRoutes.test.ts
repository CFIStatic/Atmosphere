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
    expect(shell).not.toContain('WorkerDashboardPage');
    expect(shell).toContain('path="/intake"');
    expect(shell).toContain('path="/verifier-library"');
    expect(shell).toContain('path="/jobs"');
  });

  it('does not put a Field Capture / Platform bar on the office console', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).not.toContain('ProductSwitchBar');
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

describe('phone and Field Capture frame', () => {
  it('collapses the 248px rail into a hamburger drawer on a phone-width frame', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('usePhoneShell');
    expect(shell).toContain('Open navigation');
    expect(shell).toContain('paddingLeft: phone ? 0 : RAIL_W');
    expect(shell).toContain('h-[100dvh]');
    expect(shell).toContain('w-[min(280px,86vw)]');
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

  it('lets the phone search field use the leftover top-bar width', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('{isJobsList && !phone && <div className="flex-1" />}');
    expect(shell).toContain("className={phone ? 'order-last basis-full' : undefined}");
    expect(shell).toContain('overflow-x-hidden');
  });

  it('keeps the phone light/dark control in the account menu, not the header', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('{!phone && (');
    expect(shell).toContain('<ThemeToggle />');
  });
});
