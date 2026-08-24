import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipsForSeed,
  JETTX_DEMO_CLIPS,
  parseSeedVideoArgs,
} from '../src/scripts/seedProductTestVideo.ts';

const seedSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/scripts/seedProductTestVideo.ts'),
  'utf8',
);

test('parseSeedVideoArgs defaults to the Cursor 1 / Jettx LLC product-testing clip', () => {
  const opts = parseSeedVideoArgs([], new Date('2026-08-22T17:00:00Z'));
  assert.equal(opts.orgName, 'Jettx LLC');
  assert.equal(opts.title, 'Cursor 1');
  assert.equal(opts.purpose, 'See how the product works — product testing.');
  assert.equal(opts.durationSeconds, 60);
  assert.equal(opts.workDate, '2026-08-22');
  assert.equal(opts.catalog, null);
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
  assert.equal(opts.catalog, null);
});

test('parseSeedVideoArgs rejects a bad duration', () => {
  assert.throws(() => parseSeedVideoArgs(['--duration', '0']), /duration/);
});

test('--catalog demo files the walkthrough set as real Jettx LLC clips', () => {
  const opts = parseSeedVideoArgs(['--catalog', 'demo'], new Date('2026-08-24T12:00:00Z'));
  assert.equal(opts.catalog, 'demo');
  const clips = clipsForSeed(opts);
  assert.equal(clips, JETTX_DEMO_CLIPS);
  assert.equal(clips.length, 11);
  assert.deepEqual(
    [...new Set(clips.map((c) => c.jobTitle))].sort(),
    [
      'Camden Court — HOA clubhouse rebuild',
      'Cedar Ridge — storm damage, roof tarp + rebuild',
      'Cursor 1',
      'Meridian Ave — water loss, Class 3',
    ],
  );
  const keys = clips.map((c) => `${c.company}|${c.workDate}|${c.phase}`);
  assert.equal(keys.length, new Set(keys).size);
  for (const clip of clips) {
    assert.match(clip.phase, /^(before|after)$/);
    assert.ok(clip.durationSeconds >= 20);
  }
});

test('without --catalog, only the Cursor 1 clip is filed', () => {
  const opts = parseSeedVideoArgs([], new Date('2026-08-22T17:00:00Z'));
  const clips = clipsForSeed(opts);
  assert.equal(clips.length, 1);
  assert.equal(clips[0]?.title, 'Cursor 1');
  assert.equal(clips[0]?.workDate, '2026-08-22');
});

test('replaces a live clip by id instead of ON CONFLICT on the partial unique index', () => {
  assert.match(seedSource, /existingVisible\?\.id/);
  assert.match(seedSource, /\.is\('deleted_at', null\)/);
  assert.doesNotMatch(seedSource, /onConflict:\s*'party_id,work_date,phase'/);
});
