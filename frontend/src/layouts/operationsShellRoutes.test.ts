import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isJobFilePath } from './jobFilePath';

const appSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');

describe('office rail routes', () => {
  it('keeps Overview, Start a job, Dashboard, and the job file inside the office shell', () => {
    const start = appSrc.indexOf('<OperationsShell');
    const end = appSrc.indexOf('path="/billing"');
    const shell = appSrc.slice(start, end);
    expect(shell).toContain('path="/field"');
    expect(shell).not.toContain('WorkerDashboardPage');
    expect(shell).toContain('path="/intake"');
    expect(shell).toContain('path="/verifier-library"');
    expect(shell).toContain('path="/jobs"');
    expect(shell).toContain('Navigate to="/verifier-library"');
    expect(shell).toContain('JobFileFromProfileRedirect');
    expect(shell).toContain('path="/job-progress"');
    expect(shell).toContain('element={<SharedDashboardPage />}');
    expect(shell).not.toContain('element={<JobDetailPage />}');
  });

  it('keeps the job file page and does not ship the Job Files list', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(existsSync(resolve(here, '../pages/SharedDashboardPage.tsx'))).toBe(true);
    expect(existsSync(resolve(here, '../pages/JobsPage.tsx'))).toBe(false);
    expect(appSrc).not.toMatch(/from ['"]\.\/pages\/JobsPage['"]/);
    expect(appSrc).toContain('element={<SharedDashboardPage />}');
  });

  it('does not put a Field Capture / Platform bar on the office console', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).not.toContain('ProductSwitchBar');
  });
});

describe('homeowner hub', () => {
  it('keeps Your job files outside the office shell and away from /my-jobs', () => {
    expect(appSrc).toContain('path={HOMEOWNER_HUB_PATH}');
    expect(appSrc).toContain('<MyJobFilesPage />');
    const start = appSrc.indexOf('<OperationsShell');
    const end = appSrc.indexOf('path="/billing"');
    const shell = appSrc.slice(start, end);
    expect(shell).not.toContain('MyJobFilesPage');
    expect(appSrc).toContain('path="/my-jobs"');
    expect(appSrc.indexOf('MyJobFilesPage')).toBeLessThan(start);
  });
});

describe('isJobFilePath', () => {
  it('treats a job profile as a full-height file, not the Job Files list', () => {
    expect(isJobFilePath('/jobs/job-1038')).toBe(true);
    expect(isJobFilePath('/job-progress')).toBe(true);
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
    expect(shell).toContain('overflow-hidden');
    expect(shell).toMatch(/isJobFile[\s\S]*phone[\s\S]*overflow-hidden/);
  });
});

describe('phone and Field Capture frame', () => {
  it('collapses the office rail into a hamburger drawer on a phone-width frame', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('usePhoneShell');
    expect(shell).toContain("t('nav.open')");
    expect(shell).toContain('operations-main');
    expect(shell).toContain('operations-rail');
    expect(shell).toContain('h-[100dvh]');
    expect(shell).toContain('w-[min(280px,86vw)]');
    expect(shell).toContain('start-0');
    expect(shell).toContain('-translate-x-full rtl:translate-x-full');
  });
});

describe('office rail width', () => {
  it('uses the same rail width on Dashboard and the other office tabs', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
      'utf8',
    );
    expect(css).toContain('--office-rail-w: 248px');
    expect(css).toContain('--office-rail-w: 236px');
    expect(css).toContain('--office-rail-w: 228px');
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('operations-chrome');
    expect(shell).not.toContain('w-[248px]');
  });
});

describe('office top bar', () => {
  it('uses the Dashboard 72px top bar on every rail-only office tab', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const shell = readFileSync(resolve(here, './OperationsShell.tsx'), 'utf8');
    const verifier = readFileSync(resolve(here, '../../../verifier/index.html'), 'utf8');
    expect(shell).toContain(
      ": 'sticky top-0 z-30 flex h-[72px] shrink-0 items-center gap-[18px] border-b border-line bg-paper-0 px-4'",
    );
    expect(shell).not.toContain('justify-end border-b border-line px-4 py-2.5 sm:px-6');
    expect(verifier).toMatch(/\.rail-head\s*\{[^}]*height:\s*72px/);
    expect(verifier).toMatch(/\.topbar\s*\{[^}]*height:\s*72px/);
  });

  it('lets the phone page scroll without a second jobs-list search row', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).not.toContain('DashboardSearchBar');
    expect(shell).not.toContain('isJobsList');
    expect(shell).toContain('overflow-x-hidden');
  });

  it('puts the account profile in the top-right on phone and desktop rail-only tabs', () => {
    const shell = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './OperationsShell.tsx'),
      'utf8',
    );
    expect(shell).toContain('HeaderAccountChip');
    expect(shell).toContain('ms-auto shrink-0');
    expect(shell).toContain('justify-between');
    expect(shell).toContain("t('nav.open')");
    expect(shell).not.toContain('ThemeToggle');
    expect(shell).not.toContain('{!phone && (');
  });
});
