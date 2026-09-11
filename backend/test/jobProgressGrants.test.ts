import assert from 'node:assert/strict';
import test from 'node:test';
import { presentJobProgressGrants } from '../src/shared/jobProgressGrants.js';

test('presentJobProgressGrants — job title and vendor name for the hub', () => {
  const views = presentJobProgressGrants(
    [
      {
        orgId: 'org-ortiz',
        jobId: 'job-1038',
        shareId: 'share-1',
        recipientEmail: 'home@example.com',
      },
      {
        orgId: 'org-jettx',
        jobId: 'job-2',
        shareId: null,
        recipientEmail: 'home@example.com',
      },
    ],
    [
      { id: 'job-1038', title: 'Cedar Ridge — storm damage', status: 'in_progress' },
      { id: 'job-2', title: null, status: null },
    ],
    [
      { id: 'org-ortiz', name: 'Ortiz Restoration' },
      { id: 'org-jettx', name: 'Jettx LLC' },
    ],
  );

  assert.equal(views.length, 2);
  assert.deepEqual(views[0], {
    orgId: 'org-ortiz',
    jobId: 'job-1038',
    shareId: 'share-1',
    recipientEmail: 'home@example.com',
    orgName: 'Ortiz Restoration',
    jobTitle: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    path: '/job-progress?job=job-1038',
  });
  assert.equal(views[1]?.orgName, 'Jettx LLC');
  assert.equal(views[1]?.jobTitle, 'Job');
  assert.equal(views[1]?.path, '/job-progress?job=job-2');
});

test('presentJobProgressGrants — missing org or job stays generic', () => {
  const [view] = presentJobProgressGrants(
    [{ orgId: 'missing', jobId: 'gone', shareId: null, recipientEmail: 'a@b.co' }],
    [],
    [],
  );
  assert.equal(view?.orgName, 'Contractor');
  assert.equal(view?.jobTitle, 'Job');
  assert.equal(view?.status, null);
});
