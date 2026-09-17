import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findOpenCrmJobByTitle,
  isOpenJobStatus,
  normalizeJobTitleKey,
  pickOpenJobByNormalizedTitle,
} from './openJobByTitle.js';

test('normalizeJobTitleKey collapses whitespace and case', () => {
  assert.equal(normalizeJobTitleKey('  Project Tiffany & Co. '), 'project tiffany & co.');
  assert.equal(normalizeJobTitleKey('Project   Tiffany & Co.'), 'project tiffany & co.');
});

test('isOpenJobStatus treats cancelled as closed', () => {
  assert.equal(isOpenJobStatus('scheduled'), true);
  assert.equal(isOpenJobStatus('in_progress'), true);
  assert.equal(isOpenJobStatus('cancelled'), false);
  assert.equal(isOpenJobStatus('completed'), false);
});

test('pickOpenJobByNormalizedTitle reuses newest open match (Tiffany)', () => {
  const rows = [
    {
      id: '54731af3-f1f0-4bf8-bd15-bd3abf9076fd',
      title: 'Project Tiffany & Co.',
      job_number: 11,
      status: 'cancelled',
      created_at: '2026-09-17T15:11:07Z',
    },
    {
      id: 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df',
      title: 'Project Tiffany & Co.',
      job_number: 12,
      status: 'scheduled',
      created_at: '2026-09-17T16:37:28Z',
    },
  ];
  const hit = pickOpenJobByNormalizedTitle(rows, '  project tiffany & co. ');
  assert.equal(hit?.id, 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df');
  assert.equal(hit?.job_number, 12);
});

test('pickOpenJobByNormalizedTitle returns null when only cancelled matches', () => {
  const rows = [
    {
      id: '54731af3-f1f0-4bf8-bd15-bd3abf9076fd',
      title: 'Project Tiffany & Co.',
      job_number: 11,
      status: 'cancelled',
      created_at: '2026-09-17T15:11:07Z',
    },
  ];
  assert.equal(pickOpenJobByNormalizedTitle(rows, 'Project Tiffany & Co.'), null);
});

test('findOpenCrmJobByTitle queries open non-deleted rows and normalizes', async () => {
  const calls: Array<{ table: string; filters: string[] }> = [];
  const supabase = {
    from(table: string) {
      const filters: string[] = [];
      calls.push({ table, filters });
      const api: Record<string, unknown> = {};
      const chain = (name: string, ...args: unknown[]) => {
        filters.push(`${name}:${JSON.stringify(args)}`);
        return api;
      };
      api.select = (...a: unknown[]) => chain('select', ...a);
      api.eq = (...a: unknown[]) => chain('eq', ...a);
      api.is = (...a: unknown[]) => chain('is', ...a);
      api.in = (...a: unknown[]) => chain('in', ...a);
      api.ilike = (...a: unknown[]) => chain('ilike', ...a);
      api.order = (...a: unknown[]) => chain('order', ...a);
      api.limit = () =>
        Promise.resolve({
          data: [
            {
              id: 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df',
              title: 'Project Tiffany & Co.',
              job_number: 12,
              status: 'scheduled',
              created_at: '2026-09-17T16:37:28Z',
            },
          ],
          error: null,
        });
      return api;
    },
  };

  const hit = await findOpenCrmJobByTitle(supabase, 'org-jettx', 'Project Tiffany & Co.');
  assert.equal(hit?.id, 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df');
  assert.equal(calls[0]?.table, 'crm_jobs');
  const joined = calls[0]?.filters.join(' ') ?? '';
  assert.match(joined, /deleted_at/);
  assert.match(joined, /status/);
  assert.match(joined, /Project Tiffany/);
});
