import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const frontendSrc = resolve(here, '..');
const repoRoot = resolve(here, '../../..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-demo') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else if (/\.(tsx|ts|jsx|js|html)$/.test(name)) acc.push(path);
  }
  return acc;
}

function read(relFromHere: string): string {
  return readFileSync(resolve(here, relFromHere), 'utf8');
}

describe('job file chrome has no Overview back', () => {
  it('does not pass Overview as back from SharedDashboardPage', () => {
    const src = read('../pages/SharedDashboardPage.tsx');
    expect(src).not.toMatch(/\bback=/);
    expect(src).not.toContain('ChevronLeftIcon');
    expect(src).not.toMatch(/>\s*Overview\s*</);
    expect(src).not.toMatch(/navigate\(['"]\/field['"]\)/);
    expect(src).toContain('<JobFileAskChrome');
  });

  it('does not pass a back control from the guest job file', () => {
    const src = read('../pages/JobProgressGuestPage.tsx');
    expect(src).toContain('<JobFileAskChrome');
    expect(src).not.toMatch(/\bback=/);
    expect(src).not.toMatch(/>\s*Overview\s*</);
  });

  it('keeps Job Files back on JobDetailPage and never labels it Overview', () => {
    const src = read('../pages/JobDetailPage.tsx');
    expect(src).toContain('back={back}');
    expect(src).toContain('Job Files');
    expect(src).not.toMatch(/>\s*Overview\s*</);
    expect(src).not.toMatch(/navigate\(['"]\/field['"]\)/);
    expect(src).not.toMatch(/to=['"]\/field['"]/);
    expect(src).not.toMatch(/to=['"]\/overview['"]/);
  });

  it('finds no leftover Overview chevron/back on job-file chrome or shells', () => {
    const scoped = [
      resolve(frontendSrc, 'pages/SharedDashboardPage.tsx'),
      resolve(frontendSrc, 'pages/JobDetailPage.tsx'),
      resolve(frontendSrc, 'pages/JobProgressGuestPage.tsx'),
      resolve(frontendSrc, 'pages/JobIntakePage.tsx'),
      resolve(frontendSrc, 'components/JobFileAskChrome.tsx'),
      resolve(frontendSrc, 'layouts/OperationsShell.tsx'),
      resolve(frontendSrc, 'layouts/ConsoleShell.tsx'),
      resolve(frontendSrc, 'components/AppShell.tsx'),
      ...walk(resolve(repoRoot, 'fieldcapture')),
    ];
    const hits: string[] = [];
    for (const file of scoped) {
      const src = readFileSync(file, 'utf8');
      const overviewBack =
        /<ChevronLeftIcon[\s\S]{0,160}Overview/.test(src) ||
        /onClick=\{\(\) => navigate\(['"]\/field['"]\)\}[\s\S]{0,200}Overview/.test(src) ||
        /to=['"]\/field['"][\s\S]{0,200}Overview/.test(src) ||
        /to=['"]\/overview['"][\s\S]{0,200}Overview/.test(src);
      if (overviewBack) hits.push(file.replace(repoRoot + '/', ''));
    }
    expect(hits).toEqual([]);
  });

  it('only JobDetailPage among JobFileAskChrome callers passes back', () => {
    const callers = walk(frontendSrc).filter((file) => {
      if (file.endsWith('JobFileAskChrome.tsx') || file.endsWith('.test.tsx') || file.endsWith('.test.ts')) {
        return false;
      }
      return readFileSync(file, 'utf8').includes('JobFileAskChrome');
    });
    const withBack = callers.filter((file) => /\bback=/.test(readFileSync(file, 'utf8')));
    expect(
      withBack.map((file) => file.replace(frontendSrc + '/', '')).sort(),
    ).toEqual(['pages/JobDetailPage.tsx']);
  });
});
