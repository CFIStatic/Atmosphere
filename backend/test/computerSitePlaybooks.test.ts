import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anonymizeSuccessfulRun,
  assertNoPii,
  scrubUrl,
  scrubText,
  upsertSharedPlaybook,
} from '../src/computer/sitePlaybooks.js';

test('scrubUrl strips query params and path IDs', () => {
  assert.equal(
    scrubUrl('https://mail.example.com/u/12345/#inbox?job=058b09a8-3ca0-4d29-b554-4c54de26dea5'),
    'https://mail.example.com/u/:id',
  );
  assert.equal(
    scrubUrl('https://app.example.com/jobs/987654321/edit'),
    'https://app.example.com/jobs/:id/edit',
  );
});

test('scrubText redacts emails amounts and uuids', () => {
  const out = scrubText('Email jack@jettx.ai about $1,200 on 058b09a8-3ca0-4d29-b554-4c54de26dea5');
  assert.ok(!out.includes('@'));
  assert.ok(!out.includes('1200') && !out.includes('$'));
  assert.ok(!/058b09a8/i.test(out));
});

test('assertNoPii rejects passwords tokens emails job data', () => {
  assert.throws(() => assertNoPii({ password: 'x' }), /PII_OR_JOB_DATA_FORBIDDEN/);
  assert.throws(() => assertNoPii('Bearer abc.def.ghi'), /PII_OR_JOB_DATA_FORBIDDEN/);
  assert.throws(() => assertNoPii('homeowner Jane Doe'), /PII_OR_JOB_DATA_FORBIDDEN/);
  assert.throws(() => assertNoPii('total $4500'), /PII_OR_JOB_DATA_FORBIDDEN/);
  assert.doesNotThrow(() => assertNoPii({ screens: ['Inbox'], selectors: ['button[type=submit]'] }));
});

test('anonymizeSuccessfulRun drops typed field values and keeps selectors', () => {
  const { site, playbook } = anonymizeSuccessfulRun({
    startUrl: 'https://outlook.office.com/mail/?jobId=058b09a8-3ca0-4d29-b554-4c54de26dea5',
    screens: ['Compose'],
    selectors: ['textarea[aria-label=Message]', '#password'],
    workingPath: ['https://outlook.office.com/mail/deeplink/compose?item=abc'],
    typedFieldValues: { to: 'homeowner@example.com', body: 'Your claim #99 is $2000' },
  });
  assert.equal(site, 'office.com');
  assert.ok(!playbook.selectors.some((s) => /password/i.test(s)));
  assert.doesNotThrow(() => assertNoPii(playbook));
  const blob = JSON.stringify(playbook);
  assert.ok(!blob.includes('homeowner@'));
  assert.ok(!blob.includes('2000'));
  assert.ok(!blob.includes('058b09a8'));
});

test('upsertSharedPlaybook refuses PII payload before write', async () => {
  let wrote = false;
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          wrote = true;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: 'x' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as any;

  await assert.rejects(
    () =>
      upsertSharedPlaybook(admin, {
        site: 'example.com',
        taskType: 'email_send',
        playbook: {
          screens: ['Compose'],
          selectors: [],
          working_path: [],
          known_errors: [],
          recoveries: ['retry with password reset'],
        },
        outcome: 'approve',
      }),
    /PII_OR_JOB_DATA_FORBIDDEN/,
  );
  assert.equal(wrote, false);
});
