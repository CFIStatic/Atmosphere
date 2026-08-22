import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSeedVideoArgs } from '../src/scripts/seedProductTestVideo.ts';

test('parseSeedVideoArgs defaults to the Cursor 1 / Jettx LLC product-testing clip', () => {
  const opts = parseSeedVideoArgs([], new Date('2026-08-22T17:00:00Z'));
  assert.equal(opts.orgName, 'Jettx LLC');
  assert.equal(opts.title, 'Cursor 1');
  assert.equal(opts.purpose, 'See how the product works — product testing.');
  assert.equal(opts.durationSeconds, 60);
  assert.equal(opts.workDate, '2026-08-22');
});

test('parseSeedVideoArgs accepts overrides', () => {
  const opts = parseSeedVideoArgs(
    [
      '--org',
      'Jettx LLC',
      '--title',
      'Cursor 1',
      '--purpose',
      'See how the product works — product testing.',
      '--duration',
      '60',
      '--work-date',
      '2026-08-22',
    ],
    new Date('2020-01-01T00:00:00Z'),
  );
  assert.equal(opts.orgName, 'Jettx LLC');
  assert.equal(opts.title, 'Cursor 1');
  assert.equal(opts.durationSeconds, 60);
  assert.equal(opts.workDate, '2026-08-22');
});

test('parseSeedVideoArgs rejects a bad duration', () => {
  assert.throws(() => parseSeedVideoArgs(['--duration', '0']), /duration/);
});
