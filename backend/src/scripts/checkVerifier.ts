/**
 * Exercises the verifier against a real browser, a real (fixture) website, and
 * a scripted model.
 *
 * Run it with:  npm run check:verifier
 *
 * The parts worth testing here are the ones that must hold when the model is
 * wrong, confused, or being led astray by the page — so almost none of this
 * needs a real model, and the pieces that do get a stub that returns whatever
 * the case under test needs. What is real: Chromium, the request filter, the
 * sign-in path, and every decision the verifier makes about what it is allowed
 * to do.
 *
 * No network access and no API key required.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Configuration is read at import time, so every switch this check depends on
// has to be set before anything else is pulled in.
process.env.NODE_ENV = 'development';
process.env.WEB_ACCESS_ALLOW_PRIVATE = 'true';
process.env.WEB_ACCESS_KEY ??= 'check-verifier-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-stub-for-checks';
process.env.VERIFIER_MAX_STEPS = '12';

let failures = 0;
let passes = 0;

function ok(name: string): void {
  passes += 1;
  console.log(`  [32m✓[0m ${name}`);
}

function fail(name: string, detail: unknown): void {
  failures += 1;
  console.log(`  [31m✗[0m ${name}`);
  console.log(`      ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* ---------------------------------------------------------------------------
 * A fixture portal: a login, a list of invoices, a search, and the two controls
 * a read-only session must refuse to touch.
 * ------------------------------------------------------------------------- */

interface Invoice {
  number: string;
  claim: string;
  amount: string;
}

function startPortal(): Promise<{ url: string; close: () => Promise<void>; invoices: Invoice[] }> {
  const invoices: Invoice[] = [{ number: 'INV-1001', claim: '88213', amount: '$1,240.00' }];

  const page = (body: string) =>
    `<!doctype html><html><head><title>Fixture Portal</title></head><body>${body}</body></html>`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const signedIn = (req.headers.cookie ?? '').includes('portal_session=1');

    if (url.pathname === '/' || url.pathname === '/login') {
      if (req.method === 'POST') {
        res.writeHead(302, {
          'Set-Cookie': 'portal_session=1; Path=/',
          Location: '/invoices',
        });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        page(`<h1>Fixture Portal</h1>
          <form method="post" action="/login">
            <label>Username <input type="text" name="username" /></label>
            <label>Password <input type="password" name="password" /></label>
            <button type="submit">Sign in</button>
          </form>`),
      );
      return;
    }

    if (url.pathname === '/invoices' && req.method === 'POST') {
      // The write a read-only session must never reach.
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        invoices.push({
          number: params.get('number') ?? 'INV-NEW',
          claim: params.get('claim') ?? '',
          amount: params.get('amount') ?? '',
        });
        res.writeHead(302, { Location: '/invoices' });
        res.end();
      });
      return;
    }

    if (url.pathname === '/invoices') {
      if (!signedIn) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }
      const query = (url.searchParams.get('q') ?? '').trim();
      const shown = query
        ? invoices.filter((invoice) => Object.values(invoice).some((v) => v.includes(query)))
        : invoices;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        page(`<h1>Invoices</h1>
          <form method="get" action="/invoices">
            <input type="text" name="q" placeholder="Search invoices" />
            <button type="submit">Search</button>
          </form>
          <ul>${shown
            .map(
              (invoice) =>
                `<li>${invoice.number} — claim ${invoice.claim} — ${invoice.amount}
                   <a href="/invoices/${invoice.number}">View details</a>
                   <button type="button" name="delete-invoice">Delete</button>
                   <span id="lbl-${invoice.number}" hidden>Delete invoice ${invoice.number}</span>
                   <a href="/invoices/${invoice.number}/scrub" aria-labelledby="lbl-${invoice.number}"><svg width="12" height="12"></svg></a>
                 </li>`,
            )
            .join('')}</ul>
          <a href="/invoices/new">Add invoice</a>
          <a href="/invoices/INV-1001/void?confirm=1">Mark this one done</a>
          <form method="get" action="/invoices">
            <input type="text" name="note" placeholder="Note" />
            <button type="submit">Save note</button>
          </form>`),
      );
      return;
    }

    if (url.pathname.startsWith('/invoices/')) {
      const number = url.pathname.split('/').pop();
      const invoice = invoices.find((candidate) => candidate.number === number);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        page(
          invoice
            ? `<h1>${invoice.number}</h1><p>Claim ${invoice.claim}</p><p>Amount ${invoice.amount}</p>`
            : `<h1>Not found</h1>`,
        ),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(page('<h1>Not found</h1>'));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        invoices,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/* ---------------------------------------------------------------------------
 * A stub Anthropic API that replays a scripted sequence of tool calls.
 * ------------------------------------------------------------------------- */

interface ScriptedCall {
  name: string;
  input: unknown;
}

function startModelStub(): Promise<{
  url: string;
  close: () => Promise<void>;
  script: (calls: ScriptedCall[]) => void;
  callCount: () => number;
}> {
  let queue: ScriptedCall[] = [];
  let calls = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls += 1;
      const next = queue.shift() ?? {
        name: 'report',
        input: { findings: [], summary: 'Stub ran out of scripted turns.' },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `msg_${calls}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'tool_use', id: `tu_${calls}`, name: next.name, input: next.input }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        script: (next) => {
          queue = [...next];
          calls = 0;
        },
        callCount: () => calls,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/* ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const portal = await startPortal();
  const stub = await startModelStub();
  process.env.ANTHROPIC_BASE_URL = stub.url;

  const { WebBrowserSession } = await import('../lib/webBrowser.js');
  const { observeSite } = await import('../lib/verifierAgent.js');
  const { planRepair, withRepairGuards } = await import('../lib/verifierRepair.js');
  const type = await import('../lib/verifierTypes.js');
  void type;

  const siteUrl = new URL(portal.url);
  const credentials = { username: 'someone@example.com', password: 'hunter2' };

  const openSignedIn = async (readOnly: boolean) => {
    const session = await WebBrowserSession.open(siteUrl, { readOnly });
    const result = await session.signIn(credentials);
    assert(result.ok, `sign-in failed: ${result.ok ? '' : result.reason}`);
    return session;
  };

  console.log('\nRead-only enforcement');

  await check('a read-only session can still sign in', async () => {
    const session = await openSignedIn(true);
    try {
      assert(/\/invoices/.test(session.currentUrl), `expected /invoices, got ${session.currentUrl}`);
    } finally {
      await session.close();
    }
  });

  await check('a read-only session cannot POST to the site', async () => {
    const before = portal.invoices.length;
    const session = await openSignedIn(true);
    try {
      const outcome = await (session as any).page.evaluate(async () => {
        try {
          const res = await fetch('/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'number=INV-EVIL&claim=99999&amount=$1.00',
          });
          return `status ${res.status}`;
        } catch (err) {
          return `blocked: ${(err as Error).message}`;
        }
      });
      assert(
        String(outcome).startsWith('blocked'),
        `the POST was not blocked — the page saw "${outcome}"`,
      );
      assert(
        portal.invoices.length === before,
        `an invoice was created despite the read-only guard (${before} → ${portal.invoices.length})`,
      );
    } finally {
      await session.close();
    }
  });

  await check('a writable session CAN post (the guard is what differs)', async () => {
    const before = portal.invoices.length;
    const session = await openSignedIn(false);
    try {
      await (session as any).page.evaluate(async () => {
        await fetch('/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'number=INV-2002&claim=77777&amount=$50.00',
        });
      });
      assert(
        portal.invoices.length === before + 1,
        'the control case did not write, so the previous test proves nothing',
      );
    } finally {
      await session.close();
    }
  });

  await check('a read-only session refuses to click "Delete"', async () => {
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const remove = snapshot.elements.find((element) => /delete/i.test(element.label ?? ''));
      assert(remove, 'the fixture did not expose a Delete control to try');
      let refused = false;
      try {
        await session.click(remove.ref);
      } catch (err) {
        refused = /may not change anything/i.test((err as Error).message);
      }
      assert(refused, 'the Delete button was clicked instead of being refused');
    } finally {
      await session.close();
    }
  });

  await check('a read-only session refuses to click "Add invoice"', async () => {
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const add = snapshot.elements.find((element) => /add invoice/i.test(element.label ?? ''));
      assert(add, 'the fixture did not expose an Add control to try');
      let refused = false;
      try {
        await session.click(add.ref);
      } catch (err) {
        refused = /may not change anything/i.test((err as Error).message);
      }
      assert(refused, 'the Add control was clicked instead of being refused');
    } finally {
      await session.close();
    }
  });

  await check('a read-only session may still click "View details"', async () => {
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const view = snapshot.elements.find((element) => /view details/i.test(element.label ?? ''));
      assert(view, 'the fixture did not expose a View control to try');
      await session.click(view.ref);
      assert(
        /\/invoices\/INV-/.test(session.currentUrl),
        `navigation did not happen; still at ${session.currentUrl}`,
      );
    } finally {
      await session.close();
    }
  });

  await check('an icon-only control named by aria-labelledby is still refused', async () => {
    // The label the model is shown comes from the page-side snapshot, which
    // resolves aria-labelledby. If the guard reads a poorer label than that,
    // the control the model saw as "Delete invoice INV-1001" looks like an
    // empty string here and sails through.
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const icon = snapshot.elements.find((element) => /delete invoice/i.test(element.label ?? ''));
      assert(icon, 'the fixture did not expose an icon-only delete control');
      let refused = false;
      try {
        await session.click(icon.ref);
      } catch (err) {
        refused = /may not change anything/i.test((err as Error).message);
      }
      assert(refused, 'an icon-only delete control was clicked');
    } finally {
      await session.close();
    }
  });

  await check('a read-only session refuses to open a URL that mutates on GET', async () => {
    const session = await openSignedIn(true);
    try {
      let refused = false;
      try {
        await session.goto(`${portal.url}/invoices/INV-1001/void?confirm=1`);
      } catch (err) {
        refused = /may not change anything/i.test((err as Error).message);
      }
      assert(refused, 'a mutating GET address was opened');
    } finally {
      await session.close();
    }
  });

  await check('pressing Enter cannot activate a control click would refuse', async () => {
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const note = snapshot.elements.find((element) => /note/i.test(element.label ?? ''));
      assert(note, 'the fixture did not expose the note field');
      await session.fill(note.ref, 'anything');
      let refused = false;
      try {
        await session.press('Enter');
      } catch (err) {
        refused = /may not change anything/i.test((err as Error).message);
      }
      assert(refused, 'Enter submitted a form whose Save button click would have been refused');
    } finally {
      await session.close();
    }
  });

  await check('a read-only session refuses stray keyboard shortcuts', async () => {
    const session = await openSignedIn(true);
    try {
      let refused = false;
      try {
        await session.press('e');
      } catch (err) {
        refused = /may only navigate and read/i.test((err as Error).message);
      }
      assert(refused, 'a single-letter shortcut key was pressed');
    } finally {
      await session.close();
    }
  });

  await check('a read-only session may still search (a GET form)', async () => {
    const session = await openSignedIn(true);
    try {
      const snapshot = await session.snapshot();
      const box = snapshot.elements.find((element) => /search/i.test(element.label ?? ''));
      assert(box, 'the fixture did not expose a search box');
      await session.fill(box.ref, 'INV-1001');
      await session.press('Enter');
      const after = await session.snapshot();
      assert(after.text.includes('INV-1001'), 'the search did not run');
    } finally {
      await session.close();
    }
  });

  console.log('\nObservation loop');

  const expectations = [
    {
      id: 'e1',
      kind: 'record_exists' as const,
      description: 'An invoice INV-1001 for $1,240.00 exists against claim 88213',
      where: 'Invoices',
      identifiers: { number: 'INV-1001' },
      expected: { amount: '$1,240.00' },
      critical: true,
    },
    {
      id: 'e2',
      kind: 'record_exists' as const,
      description: 'An invoice INV-9999 exists against claim 12345',
      where: 'Invoices',
      identifiers: { number: 'INV-9999' },
      expected: { amount: '$99.00' },
      critical: true,
    },
  ];

  await check('it refuses to observe through a writable session', async () => {
    const session = await openSignedIn(false);
    try {
      let refused = false;
      try {
        await observeSite({
          session,
          expectations,
          siteLabel: 'Fixture Portal',
          deadline: Date.now() + 30_000,
        });
      } catch (err) {
        refused = /writable browser session/i.test((err as Error).message);
      }
      assert(refused, 'observation ran against a session that could write');
    } finally {
      await session.close();
    }
  });

  await check('it reports the verdicts the evidence supports', async () => {
    stub.script([
      {
        name: 'report',
        input: {
          summary: 'Checked both invoices.',
          findings: [
            {
              expectationId: 'e1',
              verdict: 'satisfied',
              evidence: 'INV-1001 — claim 88213 — $1,240.00',
              url: `${portal.url}/invoices`,
              reasoning: 'The row is on the invoices list.',
            },
            {
              expectationId: 'e2',
              verdict: 'violated',
              evidence: 'The list shows only INV-1001 and INV-2002.',
              url: `${portal.url}/invoices`,
              reasoning: 'No such invoice.',
              repairClass: 'create_missing',
              repairInstruction: 'Add invoice INV-9999 for $99.00 against claim 12345.',
              repairRationale: 'Nothing exists yet, so creating it destroys nothing.',
            },
          ],
        },
      },
    ]);

    const session = await openSignedIn(true);
    try {
      const outcome = await observeSite({
        session,
        expectations,
        siteLabel: 'Fixture Portal',
        deadline: Date.now() + 30_000,
      });
      assert(outcome.verdict === 'violated', `expected violated, got ${outcome.verdict}`);
      assert(outcome.findings.length === 2, `expected 2 findings, got ${outcome.findings.length}`);
      const missing = outcome.findings.find((f) => f.expectationId === 'e2');
      assert(missing?.repair?.repairClass === 'create_missing', 'the repair class was lost');
    } finally {
      await session.close();
    }
  });

  await check('a verdict with no evidence is downgraded to indeterminate', async () => {
    stub.script([
      {
        name: 'report',
        input: {
          summary: 'Confident but empty-handed.',
          findings: [
            {
              expectationId: 'e1',
              verdict: 'satisfied',
              evidence: '',
              url: `${portal.url}/invoices`,
              reasoning: 'It looked right.',
            },
            {
              expectationId: 'e2',
              verdict: 'violated',
              evidence: '   ',
              url: `${portal.url}/invoices`,
              reasoning: 'I did not see it.',
              repairClass: 'create_missing',
              repairInstruction: 'Add it.',
            },
          ],
        },
      },
    ]);

    const session = await openSignedIn(true);
    try {
      const outcome = await observeSite({
        session,
        expectations,
        siteLabel: 'Fixture Portal',
        deadline: Date.now() + 30_000,
      });
      assert(
        outcome.findings.every((finding) => finding.verdict === 'indeterminate'),
        `unevidenced verdicts survived: ${outcome.findings.map((f) => f.verdict).join(', ')}`,
      );
      assert(
        outcome.verdict === 'indeterminate',
        `overall verdict should be indeterminate, got ${outcome.verdict}`,
      );
    } finally {
      await session.close();
    }
  });

  await check('an expectation the model ignored becomes indeterminate', async () => {
    stub.script([
      {
        name: 'report',
        input: {
          summary: 'Only looked at one of them.',
          findings: [
            {
              expectationId: 'e1',
              verdict: 'satisfied',
              evidence: 'INV-1001 — claim 88213 — $1,240.00',
              url: `${portal.url}/invoices`,
              reasoning: 'Present.',
            },
          ],
        },
      },
    ]);

    const session = await openSignedIn(true);
    try {
      const outcome = await observeSite({
        session,
        expectations,
        siteLabel: 'Fixture Portal',
        deadline: Date.now() + 30_000,
      });
      const skipped = outcome.findings.find((finding) => finding.expectationId === 'e2');
      assert(skipped, 'the unreported expectation vanished from the findings');
      assert(
        skipped.verdict === 'indeterminate',
        `the unreported expectation became ${skipped.verdict}`,
      );
      assert(outcome.verdict === 'indeterminate', 'a silently dropped check was reported as a pass');
    } finally {
      await session.close();
    }
  });

  await check('a refused click does not end the run', async () => {
    stub.script([
      { name: 'click', input: { ref: 'e-does-not-exist' } },
      {
        name: 'report',
        input: {
          summary: 'Recovered and reported.',
          findings: expectations.map((expectation) => ({
            expectationId: expectation.id,
            verdict: 'indeterminate',
            evidence: '',
            url: `${portal.url}/invoices`,
            reasoning: 'Could not get there.',
          })),
        },
      },
    ]);

    const session = await openSignedIn(true);
    try {
      const outcome = await observeSite({
        session,
        expectations,
        siteLabel: 'Fixture Portal',
        deadline: Date.now() + 30_000,
      });
      assert(stub.callCount() === 2, `expected 2 model turns, saw ${stub.callCount()}`);
      assert(outcome.findings.length === 2, 'findings were lost after a failed action');
    } finally {
      await session.close();
    }
  });

  console.log('\nRepair policy');

  const violated = (repairClass: string | undefined, id = 'e2') => ({
    expectationId: id,
    verdict: 'violated' as const,
    evidence: 'not there',
    url: 'http://example.test/invoices',
    reasoning: 'missing',
    ...(repairClass
      ? { repair: { repairClass: repairClass as any, instruction: 'Add it.', rationale: 'safe' } }
      : {}),
  });

  await check('a missing record is repaired automatically', () => {
    const decision = planRepair([violated('create_missing')], expectations);
    assert(decision.kind === 'repair', `expected repair, got ${decision.kind}`);
  });

  await check('every repair carries the duplicate guard', () => {
    // The guard lives on the single door all repairs go through, so it covers
    // both the ones the verifier plans and the ones a person approves from the
    // escalation queue.
    const planned = planRepair([violated('create_missing')], expectations);
    assert(planned.kind === 'repair', 'expected a repair to inspect');
    for (const [label, instruction] of [
      ['a planned repair', planned.instruction],
      ['an operator-approved repair', 'Add invoice INV-9999 for $99.00.'],
    ] as const) {
      const guarded = withRepairGuards(instruction);
      assert(
        /do not create a second one/i.test(guarded),
        `${label} lost its duplicate guard`,
      );
      assert(
        /do not delete anything/i.test(guarded),
        `${label} lost its no-destruction guard`,
      );
      assert(guarded.includes(instruction), `${label} lost the instruction itself`);
    }
  });

  await check('a wrong value is repaired automatically', () => {
    const decision = planRepair([violated('correct_value')], expectations);
    assert(decision.kind === 'repair', `expected repair, got ${decision.kind}`);
  });

  await check('a destructive fix is sent to a human', () => {
    const decision = planRepair([violated('needs_human')], expectations);
    assert(decision.kind === 'needs_human', `expected needs_human, got ${decision.kind}`);
  });

  await check('a violated "should not be there" is never repaired automatically', () => {
    // Even when the observing model labels the fix additive. A record that
    // should be absent but is present can only be put right by removing it,
    // and the expectation says so more reliably than the model's own label.
    const absent = [
      {
        id: 'e3',
        kind: 'record_absent' as const,
        description: 'The duplicate invoice INV-1001 should no longer be listed',
        where: 'Invoices',
        identifiers: { number: 'INV-1001' },
        expected: {},
        critical: true,
      },
    ];
    const decision = planRepair([violated('create_missing', 'e3')], absent);
    assert(
      decision.kind === 'needs_human',
      `a deletion was planned as an automatic repair (${decision.kind})`,
    );
  });

  await check('a violation with no proposed fix is sent to a human', () => {
    const decision = planRepair([violated(undefined)], expectations);
    assert(decision.kind === 'needs_human', `expected needs_human, got ${decision.kind}`);
  });

  await check('one unsafe item holds back the safe ones too', () => {
    const decision = planRepair(
      [violated('create_missing', 'e1'), violated('needs_human', 'e2')],
      expectations,
    );
    assert(
      decision.kind === 'needs_human',
      `a partial repair was planned alongside an unsafe one (${decision.kind})`,
    );
  });

  await check('nothing violated means nothing to repair', () => {
    const decision = planRepair(
      [
        {
          expectationId: 'e1',
          verdict: 'satisfied',
          evidence: 'there',
          url: 'http://example.test',
          reasoning: 'fine',
        },
      ],
      expectations,
    );
    assert(decision.kind === 'nothing_to_do', `expected nothing_to_do, got ${decision.kind}`);
  });

  await portal.close();
  await stub.close();

  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nThe check itself failed to run:\n', err);
  process.exit(1);
});
