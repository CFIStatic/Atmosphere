/**
 * Long-recording base-timeline eval. Runs NO database writes and refuses to
 * start with SUPABASE_SERVICE_ROLE_KEY in its environment. Media comes from
 * the signed URLs in manifest.json (fetch-signed-urls.ts). Model spend is
 * hard-capped (EVAL_BUDGET_USD, default 150, max 300).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval/run-eval.ts --dir /workspace/video-cost/eval \
 *     [--intervals 10,15,20,30] [--models gemini-3.5-flash-lite] [--reference gemini-3.1-pro-preview] \
 *     [--budget 150] [--max-hours 24]
 *
 * Human labels (optional, needed for PASS): <dir>/labels/<proofId>.json =
 *   {"minutes":[{"minute":0,"activity":"site_work","work":true,"note":"..."}]}
 * Without labels each variant is UNVERIFIED and a per-minute review CSV is
 * written for a person to grade.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captionFrames, defaultGeminiCall, type GeminiCall } from '../../src/longform/captions.js';
import { readSegmentMedia, type SegmentMedia } from '../../src/longform/media.js';
import { planSegments } from '../../src/longform/segmentPlan.js';
import { buildMinuteTimeline, collapseDeadRanges, formatClock, type TimedLine } from '../../src/longform/timeline.js';
import { modelPriceTable, tokenCostUsd } from '../../src/metering/modelPriceTable.js';
import { scoreVariant, PASS_BAR, type MinuteLabel, type VariantScore } from './metrics.js';
import { SpendGuard } from './spendGuard.js';

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Refusing to run: SUPABASE_SERVICE_ROLE_KEY is set. The eval must not hold write access. Unset it (fetch URLs first with fetch-signed-urls.ts).');
  process.exit(2);
}
if (!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
  console.error('GEMINI_API_KEY or GOOGLE_API_KEY must be set in process.env.');
  process.exit(2);
}

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const dir = arg('dir', '/workspace/video-cost/eval')!;
const intervals = arg('intervals', '10,15,20,30')!.split(',').map(Number);
const models = arg('models', 'gemini-3.5-flash-lite')!.split(',');
const reference = arg('reference', 'gemini-3.1-pro-preview')!;
const rereadModel = arg('reread', 'gemini-3.8-flash')!;
const guard = new SpendGuard(Number(arg('budget', process.env.EVAL_BUDGET_USD ?? '150')));
const maxHours = Number(arg('max-hours', '24'));

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { items: any[] };
const table = modelPriceTable();

/** Worst case for one caption call: ~1.3k tokens per frame in, 120 out per frame, at the model's rates. */
function worstCaseUsd(model: string, frames: number): number {
  return (tokenCostUsd(table, { modelId: model, tokens: { inputTokens: frames * 1300 + 1500, outputTokens: frames * 120 + 2000 } as any }) ?? 0.05) * 1.5;
}

function guardedCall(): GeminiCall {
  return async (input) => {
    const frames = input.parts.filter((p) => 'inlineData' in p).length;
    guard.reserve(worstCaseUsd(input.model, frames));
    const res = await defaultGeminiCall(input);
    guard.record(res.usage ? tokenCostUsd(table, { modelId: res.model, tokens: res.usage as any }) ?? 0 : 0);
    return res;
  };
}

const mediaCache = new Map<string, SegmentMedia>();
async function media(item: any, interval: number): Promise<SegmentMedia> {
  const k = `${item.id}:${interval}`;
  const hit = mediaCache.get(k);
  if (hit) return hit;
  const frames: SegmentMedia['frames'] = [];
  const signals: SegmentMedia['signals'] = [];
  for (const seg of planSegments(Number(item.duration_seconds), 600)) {
    const m = await readSegmentMedia({ url: item.signedUrl, startSeconds: seg.startSeconds, endSeconds: seg.endSeconds, intervalSeconds: interval, width: 512 });
    frames.push(...m.frames);
    signals.push(...m.signals);
  }
  const out = { frames, signals };
  mediaCache.set(k, out);
  return out;
}

function transcriptOf(item: any): TimedLine[] {
  return Array.isArray(item.transcript_segments)
    ? item.transcript_segments.map((s: any) => ({ start: Number(s.start), end: Number(s.end ?? s.start), text: String(s.text ?? ''), speaker: s.speaker ?? null }))
    : [];
}

async function runVariant(item: any, model: string, interval: number, reread: boolean) {
  const before = guard.spentUsd;
  const m = await media(item, interval);
  const captions = await captionFrames(m.frames, {
    model,
    rereadModel,
    rereadBelow: reread ? 0.6 : 0,
    batch: 12,
    call: guardedCall(),
  });
  const entries = buildMinuteTimeline({ durationSeconds: Number(item.duration_seconds), captions, transcript: transcriptOf(item), signals: m.signals });
  // Whisper is part of the base layer's cost even though the transcript already exists.
  const whisperUsd = (Number(item.duration_seconds) / 60) * 0.006;
  return { entries, costUsd: guard.spentUsd - before + whisperUsd };
}

const rows: Array<{ proofId: string; hours: number; variant: string; score: VariantScore }> = [];
let totalHours = 0;
mkdirSync(join(dir, 'out'), { recursive: true });
try {
  for (const item of manifest.items) {
    const hours = Number(item.duration_seconds) / 3600;
    if (totalHours + hours > maxHours) break;
    totalHours += hours;
    const labelPath = join(dir, 'labels', `${item.id}.json`);
    const labels: MinuteLabel[] | null = existsSync(labelPath) ? JSON.parse(readFileSync(labelPath, 'utf8')).minutes : null;
    const ref = await runVariant(item, reference, Math.min(...intervals), false);
    writeFileSync(join(dir, 'out', `${item.id}.reference.json`), JSON.stringify(ref.entries, null, 1));
    rows.push({ proofId: item.id, hours, variant: `reference ${reference} @${Math.min(...intervals)}s`, score: scoreVariant({ entries: ref.entries, durationSeconds: Number(item.duration_seconds), costUsd: ref.costUsd, labels }) });
    for (const model of models) {
      for (const interval of intervals) {
        for (const reread of [false, true]) {
          const v = await runVariant(item, model, interval, reread);
          const name = `${model} @${interval}s${reread ? ` + ${rereadModel} re-read` : ''}`;
          writeFileSync(join(dir, 'out', `${item.id}.${model}.${interval}s${reread ? '.reread' : ''}.json`), JSON.stringify(v.entries, null, 1));
          rows.push({ proofId: item.id, hours, variant: name, score: scoreVariant({ entries: v.entries, durationSeconds: Number(item.duration_seconds), costUsd: v.costUsd, labels, reference: ref.entries }) });
          if (!labels) {
            const csv = ['minute,range,label,activity,dead,speech,correct(y/n),notes']
              .concat(collapseDeadRanges(v.entries).map((e) => [Math.round(e.startSeconds / 60), e.range, JSON.stringify(e.label), e.activity, e.dead ?? '', JSON.stringify(e.speech ?? ''), '', ''].join(',')))
              .join('\n');
            writeFileSync(join(dir, 'out', `${item.id}.${model}.${interval}s${reread ? '.reread' : ''}.review.csv`), csv);
          }
        }
      }
    }
  }
} catch (err) {
  if ((err as any)?.spendCap) console.error(String((err as Error).message));
  else throw err;
}

// Aggregate per variant across recordings.
const byVariant = new Map<string, typeof rows>();
for (const r of rows) byVariant.set(r.variant, [...(byVariant.get(r.variant) ?? []), r]);
const lines = [
  `# Long-recording base timeline eval (${new Date().toISOString()})`,
  '',
  `Recordings: ${new Set(rows.map((r) => r.proofId)).size}, ${totalHours.toFixed(2)} h. Spend: $${guard.spentUsd.toFixed(4)} of $${guard.capUsd} cap, ${guard.calls} model calls.`,
  `Pass bar: coverage ${PASS_BAR.coveragePct}%, accuracy ≥ ${PASS_BAR.accuracyPct}% vs human per-minute labels, ${PASS_BAR.missedWorkMinutes} work minutes labelled dead.`,
  totalHours < 4 ? '\n**No recording ≥ 4 h in this run: an 8 h shift is still needed before any switch goes on.**' : '',
  '',
  '| Variant | Coverage | Accuracy (labels) | Missed work min | Agreement vs reference | $/min | $/h | $/8h | Result |',
  '|---|---|---|---|---|---|---|---|---|',
];
for (const [variant, rs] of byVariant) {
  const mins = rs.reduce((a, r) => a + r.score.minutes, 0);
  const cost = rs.reduce((a, r) => a + r.score.costUsd, 0);
  const hrs = rs.reduce((a, r) => a + r.hours, 0);
  const cov = rs.reduce((a, r) => a + (r.score.coveragePct * r.score.minutes) / 100, 0) / Math.max(1, mins) * 100;
  const lab = rs.filter((r) => r.score.accuracyPct != null);
  const acc = lab.length ? lab.reduce((a, r) => a + r.score.accuracyPct! * r.score.labelled, 0) / lab.reduce((a, r) => a + r.score.labelled, 0) : null;
  const missed = lab.length ? lab.reduce((a, r) => a + (r.score.missedWorkMinutes ?? 0), 0) : null;
  const ag = rs.filter((r) => r.score.agreementWithReferencePct != null);
  const agree = ag.length ? ag.reduce((a, r) => a + r.score.agreementWithReferencePct!, 0) / ag.length : null;
  const perH = hrs ? cost / hrs : 0;
  const result = rs.some((r) => r.score.pass === 'FAIL') ? 'FAIL' : rs.every((r) => r.score.pass === 'PASS') ? 'PASS' : 'UNVERIFIED';
  lines.push(`| ${variant} | ${cov.toFixed(1)}% | ${acc == null ? 'n/a' : acc.toFixed(1) + '%'} | ${missed ?? 'n/a'} | ${agree == null ? 'n/a' : agree.toFixed(1) + '%'} | ${(perH / 60).toFixed(4)} | ${perH.toFixed(3)} | ${(perH * 8).toFixed(2)} | ${result} |`);
}
lines.push('', 'Cheapest passing variant: ' + ([...byVariant.entries()]
  .filter(([, rs]) => rs.every((r) => r.score.pass === 'PASS'))
  .map(([v, rs]) => ({ v, perH: rs.reduce((a, r) => a + r.score.costUsd, 0) / Math.max(1e-9, rs.reduce((a, r) => a + r.hours, 0)) }))
  .sort((a, b) => a.perH - b.perH)[0]?.v ?? 'none yet (needs human labels and long footage)'));
lines.push('', `Per-minute outputs and review CSVs: ${join(dir, 'out')}. Timestamps like ${formatClock(9000)} are recording time.`);
writeFileSync(join(dir, 'report.md'), lines.join('\n'));
writeFileSync(join(dir, 'results.json'), JSON.stringify({ spentUsd: guard.spentUsd, capUsd: guard.capUsd, rows }, null, 1));
console.log(lines.join('\n'));
