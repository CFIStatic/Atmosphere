import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'officeDomain.mjs');

function parse(input) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('officeDomain: reads a Railway https origin from CLI text', () => {
  assert.equal(
    parse('Generated domain: https://atmosphere-web-production.up.railway.app\n'),
    'https://atmosphere-web-production.up.railway.app',
  );
});

test('officeDomain: prefixes a bare host', () => {
  assert.equal(parse('atmosphere-web.up.railway.app'), 'https://atmosphere-web.up.railway.app');
});

test('officeDomain: empty when nothing matches', () => {
  assert.equal(parse('no domain yet'), '');
});
