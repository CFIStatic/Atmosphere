import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  homeownerAskClips,
  homeownerAskJobFile,
  homeownerFindings,
  homeownerProofPayload,
} from '../src/shared/homeownerProofPayload.js';
import { askToolsForAccess } from '../src/shared/askTools.js';

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('share link /progress/:token sends only the homeowner-safe proof', () => {
  const fn = between(src('../src/routes/progressShare.ts'), 'async function sendProgressGuest', "progressShareRouter.get('/:token'");
  assert.match(fn, /const guestProof = homeownerProofPayload\(proof\)/);
  assert.match(fn, /proof: guestProof/);
  assert.doesNotMatch(fn, /^\s*proof,\s*$/m);
  assert.match(fn, /composeHomeownerLiveStory\(\(guestProof as any\)/);
});

test('homeownerProofPayload drops pay, verdicts, disputes, punch list, checks and hashes', () => {
  const office = {
    days: [{ workDate: '2026-10-01', payable: true, accepted: true, rejected: false, checks: [1], aiFindings: { concerns: ['x'] }, analysisError: 'boom', aiSummary: 'Tile set' }],
    videos: [{ id: 'v', contentHash: 'abc', checks: [1], evidenceLog: [1], disputes: [1], proofState: 'verified', device: { model: 'x' } }],
    disputes: [{ id: 'd' }],
    punchList: [{ text: 'Fix grout' }],
    counts: { days: 1, payable: 1, disputes: 1, punchList: 1, contradicted: 1 },
  };
  const out = JSON.stringify(homeownerProofPayload(office));
  for (const leak of ['payable":true', 'accepted', 'aiFindings', 'boom', 'abc', 'evidenceLog', 'proofState', 'Fix grout', '"d"']) {
    assert.ok(!out.includes(leak), `leaked ${leak}`);
  }
  assert.ok(out.includes('Tile set'));
});

test('evidence PDF strips the payload for viewers', () => {
  const fn = between(src('../src/routes/proofOfWork.ts'), 'export async function jobProofPackPdf', '\n}\n');
  assert.match(fn, /access === 'viewer' \? homeownerProofPayload\(officePayload\) : officePayload/);
});

test('viewer Ask: job file keeps the job, drops office notes, tasks, logs, documents and concerns', () => {
  const file = homeownerAskJobFile({
    job: { title: 'Kitchen' },
    briefNote: 'Gate code 1234',
    messages: [{ body: 'Homeowner is difficult' }],
    tasks: [{ title: 'Chase payment' }],
    crew: [{ name: 'Sam' }],
    workLogs: [{ body: 'Charged extra' }],
    memory: [{ summary: 'margin' }],
    documents: [{ filename: 'estimate.pdf' }],
    clips: [{ summary: 'Set tile', concerns: ['crack'] }],
  });
  assert.equal(file.job?.title, 'Kitchen');
  for (const key of ['messages', 'tasks', 'crew', 'workLogs', 'memory', 'documents'] as const) {
    assert.deepEqual(file[key], [], key);
  }
  assert.deepEqual(file.clips?.[0], { summary: 'Set tile', concerns: [] });
});

test('viewer Ask: clip findings lose office verdicts but keep what was seen', () => {
  const [clip] = homeownerAskClips([{ proofId: 'p', findings: { summary: 'tile', concerns: ['crack'], scopeVerdicts: [1], payable: true } }]);
  assert.deepEqual(clip.findings, { summary: 'tile' });
  assert.equal(homeownerFindings(null), null);
});

test('viewer Ask: runProofAsk applies the homeowner file and clips', () => {
  const fn = src('../src/routes/proofOfWork.ts');
  assert.match(fn, /askAccess === 'viewer' \? homeownerAskJobFile\(officeFile\) : officeFile/);
  assert.match(fn, /askAccess === 'viewer' \? homeownerAskClips\(officeMemoryClips\) : officeMemoryClips/);
});

test('viewer Ask tools exclude punch list and CRM record', () => {
  const names = askToolsForAccess('viewer').map((t) => t.name);
  assert.ok(!names.includes('get_punch_list'));
  assert.ok(!names.includes('get_crm_record'));
  assert.ok(!names.includes('search_crm'));
  assert.ok(askToolsForAccess('org').some((t) => t.name === 'get_punch_list'));
});
