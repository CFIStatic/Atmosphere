import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_SEED_EMAILS,
  clipsForSeed,
  jettxDemoClips,
  parseSeedVideoArgs,
  utcDayKey,
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

test('--catalog demo files the walkthrough set on today and the last few days', () => {
  const now = new Date('2026-08-24T18:00:00.000Z');
  const opts = parseSeedVideoArgs(['--catalog', 'demo'], now);
  assert.equal(opts.catalog, 'demo');
  const clips = clipsForSeed(opts, now);
  assert.deepEqual(clips, jettxDemoClips(now));
  assert.equal(clips.length, 11);
  assert.equal(clips[0]?.jobTitle, 'Cursor 1');
  assert.equal(clips[0]?.workDate, '2026-08-24');
  assert.ok(clips.some((c) => c.jobTitle.startsWith('Cedar Ridge') && c.workDate === '2026-08-24'));
  assert.ok(clips.some((c) => c.jobTitle.startsWith('Camden Court') && c.workDate === '2026-08-22'));
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
    assert.match(clip.workDate, /^2026-08-2[1-4]$/);
  }
});

test('utcDayKey walks backward in UTC', () => {
  const now = new Date('2026-08-24T18:00:00.000Z');
  assert.equal(utcDayKey(now, 0), '2026-08-24');
  assert.equal(utcDayKey(now, 3), '2026-08-21');
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

test('live writes stamp received_at as now and retire historical demo rows', () => {
  assert.match(seedSource, /received_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(seedSource, /retireStaleDemoProofs/);
  assert.match(seedSource, /contains\('tags', \['jettx-demo'\]\)/);
});

test('demo catalog also files onto Jack session orgs, not only the named org', () => {
  assert.deepEqual(ACCOUNT_SEED_EMAILS, ['jack@jettx.ai', 'jackcyganiak@yahoo.com']);
  assert.match(seedSource, /orgsToSeed/);
  assert.match(seedSource, /dashboard uses this/);
});
