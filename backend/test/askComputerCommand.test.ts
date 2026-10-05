/**
 * Chat → Computer commands: heuristics, saved-login matching, email drafting
 * with job-file people, CRM outstanding paperwork, and Logins refusals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jobIdentifiers,
  jobSummaryForEmail,
  looksLikeComputerTask,
  matchSavedLogin,
  parseComputerCommand,
  planComputerTask,
  resolvePersonFromJob,
} from '../src/shared/askComputerCommand.js';
import type { ComputerLoginRow } from '../src/computer/store.js';

const ORG = '0a000000-0000-4000-8000-0000000000d1';

function login(over: Partial<ComputerLoginRow> & Pick<ComputerLoginRow, 'host' | 'label' | 'url'>): ComputerLoginRow {
  return {
    id: over.id ?? '11111111-1111-4111-8111-111111111101',
    org_id: ORG,
    label: over.label,
    url: over.url,
    host: over.host,
    cookie_domains: [],
    created_by: null,
    created_at: new Date().toISOString(),
    last_signed_in_at: null,
    last_signed_in_by: null,
    updated_at: new Date().toISOString(),
  };
}

const OUTLOOK = login({
  id: '11111111-1111-4111-8111-111111111101',
  label: 'Outlook',
  host: 'outlook.office.com',
  url: 'https://outlook.office.com/',
});
const PORTAL = login({
  id: '11111111-1111-4111-8111-111111111102',
  label: 'Carrier portal',
  host: 'portal.example-carrier.test',
  url: 'https://portal.example-carrier.test/login',
});
const ACCULYNX = login({
  id: '11111111-1111-4111-8111-111111111103',
  label: 'AccuLynx',
  host: 'app.acculynx.com',
  url: 'https://app.acculynx.com/',
});

const FILE = {
  job: { title: 'Cedar Ridge roof', claimNumber: 'CLM-1', policyNumber: 'POL-9' },
  facts: {
    'Insured name': 'Dana Test',
    'Homeowner email': 'dana.homeowner@example.test',
    'Adjuster email': 'adj@carrier.test',
    'Adjuster': 'Sam Adjuster',
    'Lockbox code': '9999',
  },
};

test('looksLikeComputerTask: email, site actions, CRM outstanding; not draft-only', () => {
  assert.equal(looksLikeComputerTask('email Pat a summary of how things are going'), true);
  assert.equal(looksLikeComputerTask('email the homeowner a status update'), true);
  assert.equal(looksLikeComputerTask('Send an email to adjuster@carrier.test with a status update'), true);
  assert.equal(looksLikeComputerTask('update the claim status on portal.example-carrier.test'), true);
  assert.equal(looksLikeComputerTask('add a note on the Xactimate estimate'), true);
  assert.equal(looksLikeComputerTask('use Outlook'), true);
  assert.equal(looksLikeComputerTask("what's outstanding in AccuLynx for this job"), true);
  assert.equal(looksLikeComputerTask('what paperwork is still open in JobNimbus'), true);
  assert.equal(looksLikeComputerTask('check Salesforce for missing documents on this claim'), true);
  assert.equal(looksLikeComputerTask('build the estimate in Xactimate for this job'), true);
  assert.equal(looksLikeComputerTask('draft a progress share message for the homeowner'), false);
  assert.equal(looksLikeComputerTask('what is the claim number?'), false);
});

test('parseComputerCommand: homeowner role and CRM outstanding', () => {
  const a = parseComputerCommand('email the homeowner a status update');
  assert.equal(a.kind, 'email');
  assert.equal(a.recipientRole, 'homeowner');
  assert.equal(a.wantsSummary, true);
  const b = parseComputerCommand("what's outstanding in AccuLynx for this job");
  assert.equal(b.kind, 'crm_status');
  assert.equal(b.known?.host, 'app.acculynx.com');
  assert.equal(b.wantsOutstanding, true);
});

test('resolvePersonFromJob: homeowner email from facts, else roster, else missing', () => {
  const cmd = parseComputerCommand('email the homeowner a status update');
  const fromFile = resolvePersonFromJob({ command: cmd, file: FILE });
  assert.equal(fromFile?.email, 'dana.homeowner@example.test');
  assert.equal(fromFile?.name, 'Dana Test');
  assert.equal(fromFile?.source, 'job file');

  const fromRoster = resolvePersonFromJob({
    command: cmd,
    file: { job: { title: 'X' }, facts: {} },
    accessPeople: [{ kind: 'homeowner', name: 'Pat Home', email: 'pat@example.test', displayName: 'Pat Home' }],
  });
  assert.equal(fromRoster?.email, 'pat@example.test');
  assert.equal(fromRoster?.source, 'access roster');

  const missing = resolvePersonFromJob({ command: cmd, file: { job: {}, facts: {} }, accessPeople: [] });
  assert.equal(missing?.email, null);
});

test('planComputerTask: email the homeowner fills To from the job file', () => {
  const plan = planComputerTask({
    question: 'email the homeowner a status update',
    logins: [OUTLOOK],
    file: FILE,
    address: '1 Test Lane',
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.instructions, /To: Dana Test <dana\.homeowner@example\.test>/);
  assert.match(plan.instructions, /Claim number: CLM-1|Claim: CLM-1/);
  assert.match(plan.instructions, /request_approval/);
  assert.match(plan.instructions, /Never click Send/);
  assert.doesNotMatch(plan.instructions, /9999|Lockbox/);
  assert.match(plan.lead, /Dana Test|dana\.homeowner/);
});

test('planComputerTask: asks in Chat when homeowner email is missing', () => {
  const plan = planComputerTask({
    question: 'email the homeowner a status update',
    logins: [OUTLOOK],
    file: { job: { title: 'Roof' }, facts: { 'Insured name': 'Dana' } },
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.needsClarification, true);
  assert.match(plan.summary, /email address for the homeowner/i);
  assert.match(plan.summary, /Outlook/);
});

test('planComputerTask: CRM outstanding uses job identifiers and Flag instructions', () => {
  const plan = planComputerTask({
    question: "what's outstanding in AccuLynx for this job",
    logins: [ACCULYNX],
    file: FILE,
    address: '1842 Cedar Ridge Dr',
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.kind, 'crm_status');
  assert.equal(plan.startUrl, ACCULYNX.url);
  assert.match(plan.instructions, /Claim number: CLM-1/);
  assert.match(plan.instructions, /1842 Cedar Ridge/);
  assert.match(plan.instructions, /Dana Test/);
  assert.match(plan.instructions, /Flag: Certificate of completion not signed/);
  assert.match(plan.instructions, /OUTSTANDING/);
  assert.match(plan.instructions, /read-and-report|Do not change/i);
  assert.match(plan.instructions, /sign_in_saved/);
  assert.match(plan.lead, /AccuLynx/);
});

test('planComputerTask: CRM without a Login offers Logins', () => {
  const plan = planComputerTask({
    question: 'what paperwork is still open in JobNimbus',
    logins: [OUTLOOK],
    file: FILE,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.offerLogins, true);
  assert.match(plan.summary, /JobNimbus|jobnimbus|Logins/i);
});

test('planComputerTask: named site without a Login offers Logins', () => {
  const plan = planComputerTask({ question: 'update the estimate in Xactimate', logins: [OUTLOOK] });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.match(plan.summary, /Logins/);
});

test('planComputerTask: email without Outlook/Gmail offers Logins', () => {
  const plan = planComputerTask({ question: 'email Pat a summary', logins: [PORTAL] });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.match(plan.summary, /Outlook or Gmail/);
});

test('jobIdentifiers and summary never include secrets', () => {
  const ids = jobIdentifiers(FILE, '1 Test St');
  assert.ok(ids.some((l) => /CLM-1/.test(l)));
  assert.ok(ids.some((l) => /Dana Test/.test(l)));
  const text = jobSummaryForEmail(FILE, '1 Test St');
  assert.doesNotMatch(text, /9999|Lockbox/);
});

test('matchSavedLogin: CRM alias and email preferred Outlook', () => {
  assert.equal(matchSavedLogin([ACCULYNX], parseComputerCommand("what's outstanding in AccuLynx"))?.login.host, 'app.acculynx.com');
  assert.equal(matchSavedLogin([OUTLOOK], parseComputerCommand('email Pat a summary'))?.login.host, 'outlook.office.com');
});


test('parse + plan: build estimate in Xactimate enters line items inside Xactimate', () => {
  const cmd = parseComputerCommand('build the estimate in Xactimate for this job');
  assert.equal(cmd.kind, 'xactimate_estimate');
  assert.equal(cmd.wantsEstimate, true);
  const XACT = login({
    id: '11111111-1111-4111-8111-111111111104',
    label: 'Xactimate',
    host: 'identity.xactware.com',
    url: 'https://identity.xactware.com/',
  });
  const DOCUSKETCH = login({
    id: '11111111-1111-4111-8111-111111111105',
    label: 'DocuSketch',
    host: 'app.docusketch.com',
    url: 'https://app.docusketch.com/',
  });
  const file = {
    job: { title: 'Cedar Ridge roof claim', claimNumber: 'CLM-1' },
    facts: {
      'Insured name': 'Dana Test',
      'Roof squares': '24',
      'Roof type': 'Composition shingle',
      Sketch: 'DocuSketch',
      'Lockbox code': '9999',
    },
    scope: [
      { state: 'included', title: 'Replace roof covering', detail: 'Full tear-off' },
      { state: 'excluded', title: 'Interior painting', detail: 'Not in scope' },
    ],
  };
  const plan = planComputerTask({
    question: 'build the estimate in Xactimate for this job',
    logins: [XACT, DOCUSKETCH],
    file,
    address: '1842 Cedar Ridge Dr',
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.kind, 'xactimate_estimate');
  assert.equal(plan.startUrl, DOCUSKETCH.url);
  assert.match(plan.instructions, /STEP 1/);
  assert.match(plan.instructions, /STEP 2/);
  assert.match(plan.instructions, /STEP 3/);
  assert.match(plan.instructions, /DocuSketch|docusketch/i);
  assert.match(plan.instructions, /ESX|Send to Xactimate|export/i);
  assert.match(plan.instructions, /INSIDE Xactimate|complete working estimate/i);
  assert.match(plan.instructions, /sign_in_saved/);
  assert.match(plan.instructions, /Roof squares|24/);
  assert.match(plan.instructions, /Replace roof covering/);
  assert.match(plan.instructions, /Do not include: Interior painting/);
  assert.match(plan.instructions, /Remove composition shingles|industry standard/i);
  assert.match(plan.instructions, /request_approval/);
  assert.match(plan.instructions, /Save|Finalize/i);
  assert.doesNotMatch(plan.instructions, /9999|Lockbox/);
  assert.match(plan.lead, /Here is the draft list I will enter in Xactimate/);
  assert.match(plan.lead, /^- /m);
  assert.match(plan.lead, /sketch/i);
  assert.match(plan.lead, /before sending the sketch/i);
  assert.match(plan.lead, /before saving or finalizing/i);
  assert.doesNotMatch(plan.lead, /•.*•/s);
});

test('planComputerTask: Xactimate estimate without Login offers Logins', () => {
  const plan = planComputerTask({
    question: 'build the estimate in Xactimate for this job',
    logins: [login({ label: 'Outlook', host: 'outlook.office.com', url: 'https://outlook.office.com/' })],
    file: { job: { title: 'Roof', claimNumber: '1' }, facts: {} },
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.offerLogins, true);
  assert.match(plan.summary, /Xactimate|Logins/i);
});


test('planComputerTask: Xactimate estimate without sketch Login offers Logins', () => {
  const XACT = login({
    id: '11111111-1111-4111-8111-111111111104',
    label: 'Xactimate',
    host: 'identity.xactware.com',
    url: 'https://identity.xactware.com/',
  });
  const plan = planComputerTask({
    question: 'build the estimate in Xactimate for this job',
    logins: [XACT],
    file: { job: { title: 'Roof', claimNumber: '1' }, facts: {} },
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.offerLogins, true);
  assert.match(plan.summary, /sketch|DocuSketch|Logins/i);
});

test('adjuster status: email via Outlook; ask when missing; SMS scaffold', () => {
  assert.equal(looksLikeComputerTask('email the adjuster for a status update'), true);
  assert.equal(looksLikeComputerTask('ask the adjuster for a status update in XactAnalysis'), true);
  assert.equal(looksLikeComputerTask('text the adjuster for a status update'), true);

  const OUTLOOK = login({
    id: '11111111-1111-4111-8111-111111111101',
    label: 'Outlook',
    host: 'outlook.office.com',
    url: 'https://outlook.office.com/',
  });
  const XA = login({
    id: '11111111-1111-4111-8111-111111111106',
    label: 'XactAnalysis',
    host: 'www.xactanalysis.com',
    url: 'https://www.xactanalysis.com/',
  });
  const file = {
    job: { claimNumber: 'CLM-1', title: 'Roof' },
    facts: {
      Adjuster: 'Sam Adjuster',
      'Adjuster email': 'sam.adjuster@carrier.test',
      'Adjuster phone': '555-010-0001',
    },
  };

  const emailPlan = planComputerTask({
    question: 'email the adjuster for a status update',
    logins: [OUTLOOK],
    file,
  });
  assert.equal(emailPlan.ok, true);
  if (!emailPlan.ok) return;
  assert.equal(emailPlan.kind, 'adjuster_status');
  assert.match(emailPlan.instructions, /sam\.adjuster@carrier\.test/);
  assert.match(emailPlan.instructions, /request_approval/);
  assert.match(emailPlan.instructions, /Never click Send/);

  const xaPlan = planComputerTask({
    question: 'ask the adjuster for a status update in XactAnalysis',
    logins: [XA],
    file,
  });
  assert.equal(xaPlan.ok, true);
  if (!xaPlan.ok) return;
  assert.match(xaPlan.instructions, /XactAnalysis/i);
  assert.match(xaPlan.instructions, /request_approval/);
  assert.equal(xaPlan.startUrl, XA.url);

  const prevSid = process.env.TWILIO_ACCOUNT_SID;
  const prevTok = process.env.TWILIO_AUTH_TOKEN;
  const prevFrom = process.env.TWILIO_FROM_NUMBER;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
  const smsOff = planComputerTask({
    question: 'text the adjuster for a status update',
    logins: [OUTLOOK],
    file,
  });
  assert.equal(smsOff.ok, false);
  if (smsOff.ok) return;
  assert.match(smsOff.summary, /Texting is not connected/i);
  assert.match(smsOff.summary, /XactAnalysis|email/i);
  assert.doesNotMatch(smsOff.summary, /TWILIO_|Draft text/i);

  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_FROM_NUMBER = '+15551234567';
  const smsOn = planComputerTask({
    question: 'text the adjuster for a status update',
    logins: [OUTLOOK],
    file,
  });
  assert.equal(smsOn.ok, true);
  if (!smsOn.ok) return;
  assert.ok('smsPendingApproval' in smsOn && smsOn.smsPendingApproval);
  assert.match(smsOn.to, /\+15550100001/);
  assert.match(smsOn.lead, /Draft text to/);
  assert.match(smsOn.lead, /check with you before anything is sent/i);
  assert.doesNotMatch(smsOn.lead, /from job file|Twilio is not/i);
  if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = prevSid;
  if (prevTok === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = prevTok;
  if (prevFrom === undefined) delete process.env.TWILIO_FROM_NUMBER;
  else process.env.TWILIO_FROM_NUMBER = prevFrom;

  const missing = planComputerTask({
    question: 'email the adjuster for a status update',
    logins: [OUTLOOK],
    file: { job: { title: 'Roof' }, facts: {} },
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.needsClarification, true);
  assert.match(missing.summary, /could not find the adjuster/i);
});
