import test from 'node:test';
import assert from 'node:assert/strict';
import { partyInviteEmail } from '../src/verifier/partyInviteEmail.js';
import { progressShareEmail } from '../src/verifier/progressShareEmail.js';
import { crewInvitePagePath } from '../src/verifier/deliverPartyInvite.js';

const base = {
  orgName: 'Ortiz Restoration',
  inviterName: 'Dana Ortiz',
  jobTitle: '1842 Meridian Ave — water loss',
  siteAddress: '1842 Meridian Ave, Austin, TX 78702',
  recipientName: 'Alex Rivera',
  recipientEmail: 'alex@riogrande.example',
  recipientHasAccount: true,
  origin: 'https://platform.atmosphere.example',
  path: '/invite/tok123?email=alex%40riogrande.example',
  signupPath: '/signup?email=alex%40riogrande.example&next=%2Finvite%2Ftok123',
  fieldCaptureUrl: 'https://app.atmosphereteam.com/?token=tok123&account=1',
};

test('sub invite is the same email as the homeowner share: subject, heading, sender, View button', () => {
  const sub = partyInviteEmail(base);
  const home = progressShareEmail({
    orgName: base.orgName,
    sharerName: base.inviterName,
    jobTitle: base.jobTitle,
    recipientEmail: base.recipientEmail,
    origin: base.origin,
    path: '/progress/x',
  });
  assert.equal(sub.subject, home.subject);
  assert.equal(sub.fromName, home.fromName);
  assert.match(sub.html, /Job file for 1842 Meridian Ave/);
  assert.match(sub.text, /Dana Ortiz at Ortiz Restoration shared the job file/);
  assert.match(sub.html, />\s*View the job\s*</);
});

test('primary link is the office invite page; Field Capture is the quiet second link', () => {
  const { text, html } = partyInviteEmail(base);
  assert.ok(text.includes('\n  https://platform.atmosphere.example/invite/tok123?email=alex%40riogrande.example\n'));
  assert.ok(html.includes('href="https://platform.atmosphere.example/invite/tok123?email=alex%40riogrande.example"'));
  assert.match(html, /Record in Field Capture/);
  assert.ok(html.indexOf('View the job') < html.indexOf('Record in Field Capture'));
});

test('an existing account gets no create link; a new one is asked to create a real account', () => {
  const has = partyInviteEmail(base);
  assert.doesNotMatch(has.html, /Create your account/);
  assert.match(has.text, /Sign in with alex@riogrande\.example/);
  const not = partyInviteEmail({ ...base, recipientHasAccount: false });
  assert.match(not.html, /Create your account/);
  assert.ok(not.text.includes('https://platform.atmosphere.example/signup?email=alex%40riogrande.example&next=%2Finvite%2Ftok123'));
});

test('without an origin the path still goes out rather than nothing', () => {
  const { text } = partyInviteEmail({ ...base, origin: null });
  assert.ok(text.includes('\n  /invite/tok123?email=alex%40riogrande.example\n'));
});

test('no unsubscribe footer, and the ignore path is stated', () => {
  const { text } = partyInviteEmail(base);
  assert.ok(!/unsubscribe/i.test(text));
  assert.ok(text.includes('you can ignore it'));
});

test('crew invite page path encodes slash tokens and lowercases the email', () => {
  assert.equal(crewInvitePagePath('a/b'), '/invite/a%2Fb');
  assert.equal(crewInvitePagePath('tok', 'Sub@X.com'), '/invite/tok?email=sub%40x.com');
});
