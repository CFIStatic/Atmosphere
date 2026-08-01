import test from 'node:test';
import assert from 'node:assert/strict';
import { careersApplicationSchema } from '../src/lib/validation.js';
import { renderApplicationEmail } from '../src/lib/careersMail.js';

test('accepts a complete application and normalises the email', () => {
  const parsed = careersApplicationSchema.parse({
    name: '  Sam Rivera ',
    email: 'Sam@Example.COM',
    role: 'Estimating Lead — IICRC certified',
    links: 'https://example.com/portfolio',
    message: 'I ran mitigation crews for six years and estimate faster than I type.',
    website: '',
  });
  assert.equal(parsed.name, 'Sam Rivera');
  assert.equal(parsed.email, 'sam@example.com');
  assert.equal(parsed.website, '');
});

test('links and honeypot default to empty strings when omitted', () => {
  const parsed = careersApplicationSchema.parse({
    name: 'Sam',
    email: 'sam@example.com',
    role: 'Design Engineer',
    message: 'Ten words about the work I am proud of shipping.',
  });
  assert.equal(parsed.links, '');
  assert.equal(parsed.website, '');
});

test('rejects a message that is too short to mean anything', () => {
  assert.throws(() =>
    careersApplicationSchema.parse({
      name: 'Sam',
      email: 'sam@example.com',
      role: 'Design Engineer',
      message: 'hi',
    }),
  );
});

test('rejects an invalid email address', () => {
  assert.throws(() =>
    careersApplicationSchema.parse({
      name: 'Sam',
      email: 'not-an-email',
      role: 'Design Engineer',
      message: 'A perfectly reasonable message about work.',
    }),
  );
});

test('renders the application into a readable email body', () => {
  const body = renderApplicationEmail({
    name: 'Sam Rivera',
    email: 'sam@example.com',
    role: 'Field Operations — Onboarding',
    links: 'https://example.com',
    message: 'I onboard crews for a living.',
    website: '',
  });
  assert.match(body, /Role: {2}Field Operations — Onboarding/);
  assert.match(body, /Email: sam@example\.com/);
  assert.match(body, /Links: https:\/\/example\.com/);
  assert.match(body, /I onboard crews for a living\./);
});

test('omits the links line when no links were given', () => {
  const body = renderApplicationEmail({
    name: 'Sam',
    email: 'sam@example.com',
    role: 'Design Engineer',
    links: '',
    message: 'Message body.',
    website: '',
  });
  assert.doesNotMatch(body, /Links:/);
});
