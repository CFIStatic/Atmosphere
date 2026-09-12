import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail } from '../src/org/invites.js';

test('invite email deep-links signup with intent and email, not a join code', () => {
  const mail = inviteEmail({
    orgName: 'Acme Restoration',
    inviterName: 'Dana',
    inviteEmailAddress: 'crew@acme.com',
    origin: 'https://app.example',
  });
  assert.match(mail.text, /intent=join/);
  assert.doesNotMatch(mail.text, /code=/);
  assert.match(mail.text, /email=crew%40acme\.com/);
  assert.match(mail.html, /email=crew%40acme\.com/);
  assert.doesNotMatch(mail.html, /Join code/i);
  assert.match(mail.html, /Global Admin invited you/);
});
