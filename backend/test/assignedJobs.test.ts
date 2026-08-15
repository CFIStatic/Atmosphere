import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastFilmedByJob,
  mergeAssignedJobs,
  restrictToAssigned,
  searchFieldJobs,
} from '../src/field/assignedJobs.js';
import { fieldCreateJobSchema } from '../src/lib/validation.js';

test('owned jobs and live assignments both count as mine', () => {
  const { ids, roleById } = mergeAssignedJobs(
    [{ jobId: 'crew-job', role: 'lead' }],
    ['owned-job'],
  );
  assert.deepEqual([...ids].sort(), ['crew-job', 'owned-job']);
  assert.equal(roleById.get('crew-job'), 'lead');
  assert.equal(roleById.get('owned-job'), 'owner');
});

test('an assignment role wins over owner on the same job', () => {
  const { roleById } = mergeAssignedJobs([{ jobId: 'same', role: 'crew' }], ['same']);
  assert.equal(roleById.get('same'), 'crew');
});

test('today / my jobs hide work that is not assigned to this login', () => {
  const jobs = [{ id: 'mine' }, { id: 'theirs' }];
  assert.deepEqual(
    restrictToAssigned(jobs, new Set(['mine'])).map((j) => j.id),
    ['mine'],
  );
  assert.deepEqual(restrictToAssigned(jobs, new Set()), []);
});

test('field create job: name, address, and default work type', () => {
  const parsed = fieldCreateJobSchema.parse({
    name: '  Oak Ridge kitchen  ',
    address: '  1847 Oak Ridge Dr  ',
    city: 'Charleston',
  });
  assert.equal(parsed.name, 'Oak Ridge kitchen');
  assert.equal(parsed.address, '1847 Oak Ridge Dr');
  assert.equal(parsed.city, 'Charleston');
  assert.equal(parsed.workType, 'mitigation');
});

test('field create job: reject a blank name or a one-letter address', () => {
  assert.throws(() => fieldCreateJobSchema.parse({ name: 'A', address: '12 Main' }));
  assert.throws(() => fieldCreateJobSchema.parse({ name: 'Kitchen', address: '12' }));
});

test('my jobs search matches name, address, number, or filmed date', () => {
  const jobs = [
    {
      name: '1847 Oak Ridge — kitchen water',
      address: '1847 Oak Ridge Dr, Charleston',
      number: '#1041',
      filmedOn: '2026-08-12',
      status: 'completed',
    },
    {
      name: '22 Harbor Walk — drywall',
      address: '22 Harbor Walk, Mount Pleasant',
      number: '#1044',
      filmedOn: '2026-08-08',
      status: 'in_progress',
      role: 'crew',
    },
  ];
  assert.deepEqual(
    searchFieldJobs(jobs, 'oak charleston').map((j) => j.number),
    ['#1041'],
  );
  assert.deepEqual(
    searchFieldJobs(jobs, '1044').map((j) => j.number),
    ['#1044'],
  );
  assert.deepEqual(
    searchFieldJobs(jobs, '2026-08-08').map((j) => j.number),
    ['#1044'],
  );
  assert.deepEqual(
    searchFieldJobs(jobs, 'crew').map((j) => j.number),
    ['#1044'],
  );
  assert.equal(searchFieldJobs(jobs, '  ').length, 2);
});

test('last filmed date is the newest work_date per job', () => {
  const last = lastFilmedByJob([
    { jobId: 'a', workDate: '2026-08-01' },
    { jobId: 'a', workDate: '2026-08-12' },
    { jobId: 'b', workDate: '2026-07-04' },
  ]);
  assert.equal(last.get('a'), '2026-08-12');
  assert.equal(last.get('b'), '2026-07-04');
});
