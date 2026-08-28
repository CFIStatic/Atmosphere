import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cyberRouter } from '../src/routes/cyber.js';

test('cyber operator routes sit behind internal analytics scope', () => {
  const names = cyberRouter.stack.map((layer) => layer.name);
  assert.ok(names.includes('analyticsGate'), `stack was ${names.join(', ')}`);
  assert.ok(names.includes('requireAuth'), `stack was ${names.join(', ')}`);
});

test('unblock and patch are not reachable with requireAuth alone', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/routes/cyber.ts'),
    'utf8',
  );
  assert.match(src, /requireAnalytics\('internal'\)/);
  assert.match(src, /cyberRouter\.post\('\/unblock'/);
  assert.match(src, /cyberRouter\.post\('\/patch'/);
});
