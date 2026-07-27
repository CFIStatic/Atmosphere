/**
 * Self-check for the CSV importer and the mirror's change detection.
 *
 *   npm run check:csv
 *
 * CSV is the path most legacy applications actually give us, and it parses
 * untrusted customer files, so its edge cases are worth pinning down: quoted
 * delimiters, escaped quotes, embedded newlines, Excel's BOM, and the rule that
 * values stay strings (so a job number of "00123" still matches the system it
 * came from).
 */
import { parseCsv, csvToRecords } from '../lib/integrations/csv.js';
import { hashPayload } from '../lib/integrations/mirror.js';

/* eslint-disable no-console */

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

const rows = parseCsv('a,b,c\n1,"two, with comma",3\n4,"he said ""hi""",6\n7,"multi\nline",9\n');
check('row count', rows.length === 4);
check('header', rows[0].join('|') === 'a|b|c');
check('quoted delimiter', rows[1][1] === 'two, with comma');
check('escaped quotes', rows[2][1] === 'he said "hi"');
check('embedded newline', rows[3][1] === 'multi\nline');

const crlf = parseCsv('a,b\r\n1,2\r\n');
check('CRLF line endings', crlf.length === 2 && crlf[1][1] === '2');

const bom = parseCsv('﻿id,name\n7,Ann\n');
check('UTF-8 BOM stripped from header', bom[0][0] === 'id');

const empty = parseCsv('a,b\n1,2\n\n\n');
check('blank trailing lines skipped', empty.length === 2);

const result = csvToRecords('claim_id,customer,amount\nC-001,Ann,100\n,NoId,5\nC-002,Bob,200\n', {
  entityType: 'claim',
  idColumn: 'claim_id',
  maxRecords: 100,
});
check('records parsed', result.records.length === 2);
check('rows without an id are skipped', result.skipped === 1);
check('external id captured', result.records[0].externalId === 'C-001');
check('payload keyed by header', result.records[1].payload.customer === 'Bob');
check(
  'leading zeros preserved as text',
  csvToRecords('id,num\nA,00123\n', { entityType: 'x', idColumn: 'id', maxRecords: 10 }).records[0].payload.num ===
    '00123',
);

const capped = csvToRecords('id,v\n' + Array.from({ length: 50 }, (_, i) => `${i},x`).join('\n'), {
  entityType: 'x',
  idColumn: 'id',
  maxRecords: 10,
});
check('maxRecords caps and flags truncation', capped.records.length === 10 && capped.truncated);

let missingColumnThrew = false;
try {
  csvToRecords('a,b\n1,2\n', { entityType: 'x', idColumn: 'nope', maxRecords: 10 });
} catch {
  missingColumnThrew = true;
}
check('missing id column is an error', missingColumnThrew);

// Hash must be stable under key reordering, or every sync would append a
// duplicate version of an unchanged record.
check(
  'payload hash ignores key order',
  hashPayload({ a: 1, b: { c: 2, d: [3, 4] } }) === hashPayload({ b: { d: [3, 4], c: 2 }, a: 1 }),
);
check('payload hash detects real change', hashPayload({ a: 1 }) !== hashPayload({ a: 2 }));
check('payload hash respects array order', hashPayload({ a: [1, 2] }) !== hashPayload({ a: [2, 1] }));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
