import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedJobsSrc = readFileSync(join(root, 'src/routes/sharedJobs.ts'), 'utf8');

/** Slice the similar-jobs route handler so we can assert its gate in isolation. */
function similarJobsHandlerSource(): string {
  const start = sharedJobsSrc.indexOf("'/shared/:jobId/similar-jobs'");
  assert.ok(start >= 0, 'similar-jobs route registration missing');
  const next = sharedJobsSrc.indexOf('sharedJobsRouter.', start + 1);
  return next >= 0 ? sharedJobsSrc.slice(start, next) : sharedJobsSrc.slice(start);
}

test('similar-jobs is org-only — requireOrgContext, no grant fallback', () => {
  const handler = similarJobsHandlerSource();
  assert.match(handler, /requireOrgContext\(req\)/);
  // GET /shared/:jobId falls back to findJobProgressGrant for homeowners;
  // similar-jobs must never do that or matches leak to non-org viewers.
  assert.doesNotMatch(handler, /findJobProgressGrant/);
  assert.doesNotMatch(handler, /access\s*=\s*'viewer'/);
  assert.match(sharedJobsSrc, /Org members only/);
});

test('SharedDashboard mounts Similar jobs only when !grantViewer', () => {
  const page = readFileSync(
    join(root, '../frontend/src/pages/SharedDashboardPage.tsx'),
    'utf8',
  );
  assert.match(page, /SimilarPastJobs/);
  // Office panels (roster + similar jobs) use grantViewer so grant-only /
  // no-membership deep links never mount the component before access loads.
  const blockStart = page.indexOf('<SimilarPastJobs');
  assert.ok(blockStart >= 0);
  const before = page.slice(Math.max(0, blockStart - 500), blockStart);
  assert.match(before, /!grantViewer/);
  assert.match(before, /JobAccessRoster/);
});
