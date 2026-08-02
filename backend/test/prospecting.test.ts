import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxContactProvider } from '../src/prospecting/sandbox.js';

// The split these tests defend: a search is free and must never carry contact
// details, a reveal is charged and must refuse to invent them. Everything the
// billing story rests on is in that sentence.

const provider = new SandboxContactProvider();

test('search returns people without any contact details', async () => {
  const { matches } = await provider.search({ limit: 50 });
  assert.ok(matches.length > 0, 'expected the sandbox to hold people');
  for (const match of matches) {
    // A ProspectMatch has no email/phone fields at all; this asserts the
    // shape rather than trusting it, because a leak here is a free reveal.
    assert.equal((match as Record<string, unknown>).email, undefined);
    assert.equal((match as Record<string, unknown>).phone, undefined);
    assert.equal((match as Record<string, unknown>).mobile, undefined);
    assert.equal(typeof match.hasEmail, 'boolean');
    assert.equal(typeof match.hasPhone, 'boolean');
  }
});

test('search filters by title, location, and free text', async () => {
  const byTitle = await provider.search({ titles: ['adjuster'] });
  assert.ok(byTitle.matches.length >= 2);
  assert.ok(byTitle.matches.every((m) => /adjuster/i.test(m.title ?? '')));

  const byLocation = await provider.search({ location: 'San Antonio' });
  assert.ok(byLocation.matches.every((m) => /san antonio/i.test(m.location ?? '')));

  const byText = await provider.search({ q: 'camden' });
  assert.equal(byText.matches.length, 1);
  assert.match(byText.matches[0].companyName ?? '', /Camden Court/);
});

test('search honours the limit and reports the unclipped total', async () => {
  const { matches, total } = await provider.search({ limit: 3 });
  assert.equal(matches.length, 3);
  assert.ok((total ?? 0) > 3, 'total should count every match, not the page');
});

test('reveal returns contact details for someone the vendor holds', async () => {
  const contact = await provider.reveal('sbx-1');
  assert.ok(contact, 'expected a reveal');
  assert.equal(contact.providerPersonId, 'sbx-1');
  assert.match(contact.email ?? '', /@/);
  assert.ok(contact.phone);
});

test('reveal returns null when the vendor holds nothing — so nothing is charged', async () => {
  // sbx-7 exists precisely to exercise the do-not-charge path.
  assert.equal(await provider.reveal('sbx-7'), null);
});

test('reveal returns null for someone who does not exist', async () => {
  assert.equal(await provider.reveal('nobody'), null);
});

test('a partial record still reveals, and reports what is missing', async () => {
  // Calloway has an email and no phone: worth paying for, and the search
  // flags must say so before anyone does.
  const { matches } = await provider.search({ q: 'Calloway' });
  assert.equal(matches[0].hasEmail, true);
  assert.equal(matches[0].hasPhone, false);

  const contact = await provider.reveal('sbx-2');
  assert.ok(contact);
  assert.ok(contact.email);
  assert.equal(contact.phone, null);
});

test('the sandbox is labelled as synthetic and costs nothing upstream', async () => {
  assert.equal(provider.sandbox, true);
  assert.equal(provider.name, 'Sandbox');
  const contact = await provider.reveal('sbx-1');
  assert.equal(contact?.costNanos, 0);
});

test('every sandbox person carries an invented .example domain', async () => {
  const { matches } = await provider.search({ limit: 100 });
  for (const match of matches) {
    if (!match.companyDomain) continue;
    assert.match(
      match.companyDomain,
      /\.example$/,
      'sandbox data must never look like a real domain',
    );
  }
});
