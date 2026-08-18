import test from 'node:test';
import assert from 'node:assert/strict';
import { extractShareToken, nativeShareURL, tokenFromSharePath } from '../src/field/shareLink.js';

test('share token comes out of web, app, and pasted links', () => {
  assert.equal(
    extractShareToken('https://app.atmosphere.example/shared/tok123?email=alex%40shop.example'),
    'tok123',
  );
  assert.equal(extractShareToken('https://app.atmosphere.example/fieldcapture/?token=tok123'), 'tok123');
  assert.equal(extractShareToken('atmosphere-field://share?token=tok123'), 'tok123');
  assert.equal(extractShareToken('atmosphere-field://shared/tok123'), 'tok123');
  assert.equal(extractShareToken('tok12345'), 'tok12345');
  assert.equal(extractShareToken(''), null);
});

test('native Field Capture URL carries the same token the email uses', () => {
  assert.equal(tokenFromSharePath('/shared/tok123?email=a%40b.com'), 'tok123');
  assert.equal(nativeShareURL('tok123'), 'atmosphere-field://share?token=tok123');
});
