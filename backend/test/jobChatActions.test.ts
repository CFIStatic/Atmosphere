/**
 * Job Chat runs office commands however they are phrased: the model is
 * offered the action tools (texts, job-file updates, access, CRM) and the
 * server runs them. Texts and access removals still only propose a card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { askModelActionTools } from '../src/shared/askTools.js';
import { answerFromAskLookup, geminiLookupTools } from '../src/shared/askReasoning.js';
import { generalJobCard } from '../src/shared/jobFileAsk.js';
import type { AskLookupResult } from '../src/shared/askLookup.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';

test('office Chat offers the action tools; viewers get none', () => {
  const names = askModelActionTools('org').map((t) => t.name);
  for (const name of ['send_job_sms', 'update_job_fields', 'propose_revoke_access', 'list_who_has_access', 'get_crm_record']) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.includes('start_computer_task'));
  assert.deepEqual(askModelActionTools('viewer'), []);
  // A tool the heuristics already ran this turn is not offered again.
  assert.ok(!askModelActionTools('org', ['send_job_sms']).some((t) => t.name === 'send_job_sms'));
  const decls = geminiLookupTools(true, false, askModelActionTools('org'))[0]!.functionDeclarations.map(
    (d: { name: string }) => d.name,
  );
  assert.ok(decls.includes('send_job_sms'));
});

test('a command the heuristics miss reaches the action tool through the model', async () => {
  const ran: Array<{ name: string; input: Record<string, unknown> }> = [];
  let turn = 0;
  const result = await answerFromAskLookup({
    question: 'let Dana know we will be on site at 3 tomorrow',
    catalog: { orgId: ORG, jobId: JOB, access: 'org', clips: [], history: [], people: [] },
    step: async () => {
      turn += 1;
      if (turn === 1) {
        return {
          model: 'claude-test',
          text: '',
          calls: [{ name: 'send_job_sms', input: { to: '4145550100', body: 'We will be on site at 3 tomorrow.', recipient: 'Dana' } }],
        };
      }
      return { model: 'claude-test', text: 'The text to Dana is ready. Press Send on the card when it looks right.', calls: [] };
    },
    actions: {
      tools: askModelActionTools('org'),
      run: async (name, input): Promise<AskLookupResult> => {
        ran.push({ name, input });
        return { ok: true, tool: name, summary: 'Here is the text for Dana. Nothing has been sent; press Send on the card when it looks right.' };
      },
    },
  });
  assert.equal(ran.length, 1);
  assert.equal(ran[0]!.name, 'send_job_sms');
  assert.equal(ran[0]!.input.body, 'We will be on site at 3 tomorrow.');
  assert.ok(result.trace.some((step) => step.tool === 'send_job_sms'));
  assert.match(result.answer, /ready/);
  assert.doesNotMatch(result.answer, /text was sent/i);
});

test('a general turn still sees the open job', () => {
  const card = generalJobCard({
    job: { id: JOB, title: 'Project Tiffany & Co.', claimNumber: 'CLM-12' },
    facts: { City: 'Milwaukee, WI' },
    clips: [],
  });
  assert.match(card, /Tiffany/);
  assert.match(card, /Milwaukee/);
  assert.equal(generalJobCard(null), '');
});
