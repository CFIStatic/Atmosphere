import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_SOURCE_FORMAT_RULES,
  formatSourceTrailer,
  mapAskSourceFragment,
  normalizeAskSources,
  parseLegacySourceBlob,
} from '../src/shared/askSources.js';
import { ASK_PROSE_FORMAT_RULES, normalizeAskProse } from '../src/shared/askProse.js';

test('ASK_SOURCE_FORMAT_RULES forbids Source parentheticals and requires trailer', () => {
  assert.match(ASK_SOURCE_FORMAT_RULES, /Never write parenthetical/);
  assert.match(ASK_SOURCE_FORMAT_RULES, /⟦sources:/);
  assert.match(ASK_PROSE_FORMAT_RULES, /⟦sources:/);
});

test('mapAskSourceFragment covers job-file section aliases', () => {
  assert.equal(mapAskSourceFragment('Field Capture'), 'access');
  assert.equal(mapAskSourceFragment('Brief note'), 'brief_note');
  assert.equal(mapAskSourceFragment('Scope'), 'scope');
  assert.equal(mapAskSourceFragment('Invited section'), 'invited');
  assert.equal(mapAskSourceFragment('Videos and mic'), 'videos');
  assert.equal(mapAskSourceFragment('2026-09-12'), 'clip:2026-09-12');
});

test('parseLegacySourceBlob splits slash-soup and dated clips', () => {
  assert.deepEqual(parseLegacySourceBlob('Field Capture / Brief note / Scope'), [
    'access',
    'brief_note',
    'scope',
  ]);
  assert.deepEqual(
    parseLegacySourceBlob('Videos and mic, 2026-09-05, 2026-09-09, and 2026-09-12 clips'),
    ['clip:2026-09-05', 'clip:2026-09-09', 'clip:2026-09-12', 'videos'],
  );
  assert.deepEqual(parseLegacySourceBlob('Invited section'), ['invited']);
});

test('normalizeAskSources converts legacy Source prose into a trailer', () => {
  const raw =
    'Crew left the tarp on the north slope.\n\n(Source: Field Capture / Brief note / Scope).';
  const clean = normalizeAskSources(raw);
  assert.doesNotMatch(clean, /\(Source:/i);
  assert.match(clean, /⟦sources: access, brief_note, scope⟧/);
  assert.match(clean, /Crew left the tarp/);
});

test('normalizeAskProse runs source cleanup', () => {
  const clean = normalizeAskProse(
    'Jack is invited.\n\n(Source: Invited section).',
  );
  assert.doesNotMatch(clean, /\(Source:/i);
  assert.match(clean, /⟦sources: invited⟧/);
});

test('formatSourceTrailer is stable', () => {
  assert.equal(formatSourceTrailer(['scope', 'clip:2026-09-12']), '⟦sources: scope, clip:2026-09-12⟧');
  assert.equal(formatSourceTrailer([]), '');
});
