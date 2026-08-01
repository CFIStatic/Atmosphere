import test from 'node:test';
import assert from 'node:assert/strict';
import { contactMessageSchema } from '../src/lib/validation.js';
import { renderContactEmail } from '../src/lib/contactMail.js';

test('accepts a complete message and normalises the email', () => {
  const parsed = contactMessageSchema.parse({
    name: '  Dana Ortiz ',
    email: 'Dana@Example.COM',
    company: 'Ortiz Roofing',
    teamSize: '6–20',
    workType: 'Both',
    message: 'We write forty estimates a month and every one is a late night.',
  });
  assert.equal(parsed.name, 'Dana Ortiz');
  assert.equal(parsed.email, 'dana@example.com');
  assert.equal(parsed.website, '');
});

test('optional fields default to empty strings', () => {
  const parsed = contactMessageSchema.parse({
    name: 'Dana',
    email: 'dana@example.com',
    message: 'A perfectly reasonable question about the platform.',
  });
  assert.equal(parsed.company, '');
  assert.equal(parsed.teamSize, '');
  assert.equal(parsed.workType, '');
});

test('rejects a message too short to act on', () => {
  assert.throws(() =>
    contactMessageSchema.parse({ name: 'Dana', email: 'dana@example.com', message: 'hi' }),
  );
});

test('renders a readable email and omits empty lines', () => {
  const body = renderContactEmail({
    name: 'Dana Ortiz',
    email: 'dana@example.com',
    company: '',
    teamSize: '',
    workType: 'Mitigation',
    message: 'Call me about storm season.',
    website: '',
  });
  assert.match(body, /Name: {5}Dana Ortiz/);
  assert.match(body, /Work: {5}Mitigation/);
  assert.doesNotMatch(body, /Company:/);
  assert.match(body, /Call me about storm season\./);
});
