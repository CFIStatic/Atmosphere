import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const sharedJobsSrc = readFileSync(
  resolve(here, '../../../../backend/src/routes/sharedJobs.ts'),
  'utf8',
);

describe('Dashboard job-file delete policy', () => {
  it('removes Delete from the job-file kebab and keeps rename / duplicate / share', () => {
    const menu = verifierHtml.match(/id="jobmenu"[\s\S]*?<\/div>/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain('data-job-act="rename"');
    expect(menu![0]).toContain('data-job-act="duplicate"');
    expect(menu![0]).toContain('data-job-act="share"');
    expect(menu![0]).not.toContain('data-job-act="delete"');
    expect(menu![0]).not.toMatch(/>\s*Delete\s*</);
    expect(verifierHtml).not.toContain('jobmenu-delete');
    expect(verifierHtml).not.toContain('Delete permanently');
    expect(verifierHtml).not.toContain('function submitJobFileDelete');
  });

  it('keeps the compact job-file sheet for rename / duplicate / share', () => {
    expect(verifierHtml).toContain('class="sheet sheet-narrow"');
    expect(verifierHtml).toMatch(/\.sheet\.sheet-narrow\s*\{[^}]*width:\s*min\(28rem,\s*100%\)/);
    expect(verifierHtml).toContain('class="jf-submit"');
    expect(verifierHtml).toContain("if (tab === 'rename') return 'Rename this job file'");
  });

  it('returns 410 from the job-file DELETE API so old clients cannot delete', () => {
    const start = sharedJobsSrc.indexOf("sharedJobsRouter.delete('/shared/:jobId'");
    expect(start).toBeGreaterThan(0);
    const fn = sharedJobsSrc.slice(start, start + 800);
    expect(fn).toMatch(/410/);
    expect(fn).toContain('job_file_delete_removed');
  });
});
