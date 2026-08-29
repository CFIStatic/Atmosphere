import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail } from '../src/org/invites.js';

test('invite email deep-links signup with intent, code, and email', () => {
  const mail = inviteEmail({
    orgName: 'Acme Restoration',
    inviterName: 'Dana',
    joinCode: '8F3A9C2B',
    inviteEmailAddress: 'crew@acme.com',
    origin: 'https://app.example',
  });
  assert.match(mail.text, /intent=join/);
  assert.match(mail.text, /code=8F3A9C2B/);
  assert.match(mail.text, /email=crew%40acme\.com/);
  assert.match(mail.html, /email=crew%40acme\.com/);
  assert.match(mail.html, /Global Admin invited you/);
});
