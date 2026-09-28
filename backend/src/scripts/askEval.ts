/**
 * Ask gold eval + release gate.
 *
 *   npm run eval:ask                         # synthetic gold in the repo
 *   EVAL_GOLD_PATH=/private/gold.json npm run eval:ask
 *   EVAL_GOLD_URL=https://… EVAL_GOLD_TOKEN=… npm run eval:ask
 *
 * Private gold (real consented clips) is never committed: the repo is public.
 * With private gold the printed report is redacted (no clip text) and the full
 * JSON report is written only when EVAL_REPORT_PATH is set.
 * Exit code 1 when the gate fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAskModelConfigured } from '../lib/askModel.js';
import { reportMarkdown, runAskEval } from '../eval/runAskEval.js';
import type { GoldSet } from '../eval/goldTypes.js';

const here = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = resolve(here, '../../eval/synthetic-gold.json');

async function loadGold(): Promise<{ gold: GoldSet; private: boolean }> {
  const url = process.env.EVAL_GOLD_URL?.trim();
  if (url) {
    const res = await fetch(url, {
      headers: process.env.EVAL_GOLD_TOKEN ? { Authorization: `Bearer ${process.env.EVAL_GOLD_TOKEN}` } : {},
    });
    if (!res.ok) throw new Error(`EVAL_GOLD_URL returned ${res.status}`);
    return { gold: (await res.json()) as GoldSet, private: true };
  }
  const path = process.env.EVAL_GOLD_PATH?.trim();
  if (path) return { gold: JSON.parse(readFileSync(path, 'utf8')) as GoldSet, private: true };
  return { gold: JSON.parse(readFileSync(SYNTHETIC, 'utf8')) as GoldSet, private: false };
}

const { gold, private: isPrivate } = await loadGold();
const model = isAskModelConfigured() && process.env.EVAL_WITH_MODEL === '1' ? 'configured' : null;
if (!model) {
  // Deterministic run: make sure no key in the environment switches Ask to a model mid-run.
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete process.env[key];
}
// A/B: EVAL_CLIPASK_MODULE points at another checkout's clipAsk.ts (e.g. main) to compare answers.
const alt = process.env.EVAL_CLIPASK_MODULE?.trim();
const answer = alt
  ? await (async () => {
      const mod = (await import(resolve(alt))) as { answerFromClip: typeof import('../shared/clipAsk.js').answerFromClip };
      return async (question: string, record: Parameters<typeof mod.answerFromClip>[0]['record']) =>
        (await mod.answerFromClip({ question, record })).answer;
    })()
  : undefined;
const report = await runAskEval(gold, { model, answer });
console.log(reportMarkdown(report, { redact: isPrivate }));
const out = process.env.EVAL_REPORT_PATH?.trim();
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${reportMarkdown(report, { redact: true })}\n`, { flag: 'a' });
}
process.exitCode = report.gate.pass ? 0 : 1;
