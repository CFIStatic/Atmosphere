import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proofOfWork = readFileSync(join(here, '../src/routes/proofOfWork.ts'), 'utf8');
const progressShare = readFileSync(join(here, '../src/routes/progressShare.ts'), 'utf8');
const api = readFileSync(join(here, '../../frontend/src/lib/api.ts'), 'utf8');
const progressSharePath = readFileSync(
  join(here, '../../frontend/src/lib/progressSharePath.ts'),
  'utf8',
);

test('office Ask and proof history allow progress-share grant viewers', () => {
  const askFn = proofOfWork.slice(
    proofOfWork.indexOf('export async function askAboutProofs'),
    proofOfWork.indexOf('export async function proofQuestions'),
  );
  const questionsFn = proofOfWork.slice(
    proofOfWork.indexOf('export async function proofQuestions'),
    proofOfWork.indexOf('export async function', proofOfWork.indexOf('export async function proofQuestions') + 1),
  );
  assert.match(askFn, /resolveOrgOrViewerAccess\(req,\s*req\.params\.jobId\)/);
  assert.doesNotMatch(askFn, /requireOrgContext\(req\)/);
  assert.match(questionsFn, /resolveOrgOrViewerAccess\(req,\s*req\.params\.jobId\)/);
  assert.doesNotMatch(questionsFn, /requireOrgContext\(req\)/);
});

test('guest Ask after cookie exchange uses /session/ask, not an empty token segment', () => {
  assert.match(progressSharePath, /PROGRESS_SHARE_API_PREFIX/);
  assert.match(progressSharePath, /\/session/);
  assert.match(api, /progressShareApiPath\(token,\s*'\/ask'\)/);
  assert.match(api, /progressShareApiPath\(token,\s*`\/proof\/\$\{encodeURIComponent\(proofId\)\}\/video`\)/);
  assert.match(progressShare, /tokenFromProgressRequest\(req\)/);
  assert.match(
    progressShare.slice(
      progressShare.indexOf("'/:token/claim'"),
      progressShare.indexOf("'/:token/ask'"),
    ),
    /tokenFromProgressRequest/,
  );
});
