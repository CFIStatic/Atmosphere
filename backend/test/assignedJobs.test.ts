import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAssignedJobs, restrictToAssigned } from '../src/field/assignedJobs.js';
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
