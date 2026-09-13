import test from 'node:test';
import assert from 'node:assert/strict';
import { findVerbatimQuote, parseVerbatimTranscript } from '../src/audio/verbatimTranscript.js';

const stamped =
  '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
  '[1:36] Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead.\n' +
  '[4:10] Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

test('parseVerbatimTranscript keeps exact words and seek times for every stamp', () => {
  const rows = parseVerbatimTranscript(stamped);
  assert.ok(rows.length >= 3);
  assert.equal(rows[0]?.tSec, 18);
  assert.equal(rows[0]?.speakerLabel, 'Homeowner');
  assert.match(rows[0]?.text || '', /I do not want you to replace the cabinets unless insurance approves it/);
  assert.equal(rows[1]?.tSec, 96);
  assert.equal(rows[1]?.speakerLabel, 'Crew');
  assert.match(rows[1]?.text || '', /We will remount the mirror today/);
  assert.ok((rows[0]?.text || '').includes('unless insurance approves it'));
});

test('parseVerbatimTranscript does not invent speech on empty mic', () => {
  assert.deepEqual(parseVerbatimTranscript(''), []);
  assert.deepEqual(parseVerbatimTranscript('   '), []);
});

test('findVerbatimQuote returns an exact substring from the transcript', () => {
  const hit = findVerbatimQuote(stamped, 'remount the mirror today');
  assert.ok(hit);
  assert.match(hit!.quote, /remount the mirror today/i);
  assert.equal(hit!.tSec, 96);
  assert.ok(stamped.toLowerCase().includes(hit!.quote.toLowerCase()));
});
