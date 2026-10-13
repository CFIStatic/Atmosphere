/**
 * Side-by-side model test for video analysis. Read-only on production.
 *
 * Re-runs the passes that dominate video spend on real filed clips with
 * whatever models the environment names, and writes what each one produced
 * plus what it cost. Nothing is written back: these calls run outside any
 * metering scope and no job_proofs row is touched.
 *
 *   ANTHROPIC_MODEL=claude-sonnet-5-5 VERIFICATION_PRIMARY_MODEL=gemini-3.8-flash \
 *   EVAL_ARM=cheap EVAL_PROOF_IDS=id1,id2 EVAL_OUT=cheap.json npx tsx scripts/videoModelEval.ts
 *
 *   npx tsx scripts/videoModelEval.ts --compare baseline.json cheap.json > report.md
 *
 * Passes covered: Gemini dictation (summary, Analysis events, rooms, people),
 * the 6-still day-film read, and the conversation summary. Cost comes from
 * the providers' own usage numbers on each response, priced by the rate card.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { modelPriceTable, tokenCostUsd } from '../src/metering/modelPriceTable.js';

type Call = { model: string; inputTokens: number; outputTokens: number; usd: number };

const calls: Call[] = [];
const table = modelPriceTable();

function record(model: string, inputTokens: number, outputTokens: number): void {
  const usd = tokenCostUsd(table, { modelId: model, tokens: { inputTokens, outputTokens } }) ?? 0;
  calls.push({ model, inputTokens, outputTokens, usd });
}

function maxInt(text: string, key: string): number {
  let best = 0;
  for (const m of text.matchAll(new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'g'))) best = Math.max(best, Number(m[1]));
  return best;
}

/** Tap provider responses for usage. Bodies are cloned; callers see the original. */
function tapFetch(): void {
  const real = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const res = await real(input, init);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (/api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(url)) {
      void res
        .clone()
        .text()
        .then((body) => {
          if (/anthropic/.test(url)) {
            const model = body.match(/"model"\s*:\s*"([^"]+)"/)?.[1] ?? 'claude-unknown';
            record(
              model,
              maxInt(body, 'input_tokens') + maxInt(body, 'cache_read_input_tokens'),
              maxInt(body, 'output_tokens'),
            );
          } else {
            const model = decodeURIComponent(url.match(/models\/([^:]+):/)?.[1] ?? 'gemini-unknown');
            record(
              model,
              maxInt(body, 'promptTokenCount'),
              maxInt(body, 'candidatesTokenCount') + maxInt(body, 'thoughtsTokenCount'),
            );
          }
        })
        .catch(() => undefined);
    }
    return res;
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 250));
}

async function runArm(): Promise<void> {
  tapFetch();
  const { unscopedAdminOrNull } = await import('../src/lib/scopedAdmin.js');
  const { describeRecordingWithoutScope } = await import('../src/shared/workerActivityAnalysis.js');
  const { analyseDayFilm } = await import('../src/shared/proofAnalyst.js');
  const { analyzeConversation } = await import('../src/audio/conversationDetails.js');
  const { verificationConfig } = await import('../src/verification/config.js');
  const { config } = await import('../src/config.js');

  const admin = unscopedAdminOrNull() as any;
  if (!admin) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const ids = (process.env.EVAL_PROOF_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('EVAL_PROOF_IDS is empty.');

  const clips: any[] = [];
  for (const id of ids) {
    const { data: proof } = await admin
      .from('job_proofs')
      .select('id, duration_seconds, work_date, transcript_text')
      .eq('id', id)
      .maybeSingle();
    if (!proof) continue;
    const { data: rows } = await admin
      .from('job_proof_frames')
      .select('at_seconds, storage_path')
      .eq('proof_id', id)
      .order('at_seconds');
    const frames: Array<{ atSeconds: number; base64: string }> = [];
    for (const row of (rows ?? []) as any[]) {
      const { data: blob } = await admin.storage.from('job-proofs').download(row.storage_path);
      if (blob) frames.push({ atSeconds: Number(row.at_seconds), base64: Buffer.from(await blob.arrayBuffer()).toString('base64') });
    }
    const duration = Number(proof.duration_seconds) || frames[frames.length - 1]?.atSeconds || 60;
    const out: any = { id, durationSeconds: duration, frames: frames.length };

    const step = async (name: string, fn: () => Promise<any>) => {
      const before = calls.length;
      const started = Date.now();
      try {
        out[name] = await fn();
      } catch (err) {
        out[name] = { error: err instanceof Error ? err.message : String(err) };
      }
      await settle();
      const mine = calls.slice(before);
      out[`${name}Cost`] = {
        usd: Number(mine.reduce((s, c) => s + c.usd, 0).toFixed(4)),
        calls: mine.length,
        models: [...new Set(mine.map((c) => c.model))],
        seconds: Math.round((Date.now() - started) / 100) / 10,
      };
    };

    let visionSummary = '';
    await step('dictation', async () => {
      const d = await describeRecordingWithoutScope({ proofId: id, durationSeconds: duration, frames });
      visionSummary = d.narrationSummary || d.narrationText;
      return {
        model: d.model,
        summary: d.narrationSummary,
        narration: d.narrationText,
        events: d.events.map((e: any) => `${Math.round(e.atSeconds)}s ${e.text}`),
        rooms: d.roomSegments.map((r) => `${Math.round(r.startSec)}–${Math.round(r.endSec)}s ${r.room}`),
        people: (d.people as any[]).map((p) => p?.label ?? p?.id).filter(Boolean),
      };
    });
    await step('dayFilm', async () => {
      const a = await analyseDayFilm({ frames: frames.slice(0, 12), scopeTitles: [], workDate: proof.work_date });
      return a && { model: a.model, summary: a.summary, workPerformed: a.workPerformed, concerns: a.concerns };
    });
    await step('conversation', async () => {
      const c = await analyzeConversation(proof.transcript_text, { durationSeconds: duration, visionContext: visionSummary });
      return {
        model: c.model,
        source: c.source,
        summary: c.summary,
        executiveSummary: c.executiveSummary,
        agreements: c.agreements,
        concerns: c.concerns,
        rooms: c.roomsMentioned,
      };
    });
    clips.push(out);
  }

  await settle();
  const total = calls.reduce((s, c) => s + c.usd, 0);
  const minutes = clips.reduce((s, c) => s + c.durationSeconds, 0) / 60;
  const outPath = process.env.EVAL_OUT;
  if (!outPath) throw new Error('EVAL_OUT is required (module logs share stdout).');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        arm: process.env.EVAL_ARM ?? 'unnamed',
        models: { anthropic: config.technician.assistant.model, gemini: verificationConfig.primaryModel },
        totalUsd: Number(total.toFixed(4)),
        usdPerMinute: Number((total / Math.max(minutes, 1 / 60)).toFixed(4)),
        clips,
      },
      null,
      2,
    ),
  );
}

function list(items: unknown): string {
  const arr = Array.isArray(items) ? items : [];
  return arr.length ? arr.map((i) => `- ${String(i)}`).join('\n') : '- (none)';
}

function compare(paths: string[]): void {
  const arms = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const lines: string[] = ['# Video model test', '', '| Arm | Claude | Gemini | Cost (these clips) | Per minute of video |', '|---|---|---|---|---|'];
  for (const a of arms) {
    lines.push(`| ${a.arm} | ${a.models.anthropic} | ${a.models.gemini} | $${a.totalUsd.toFixed(3)} | $${a.usdPerMinute.toFixed(3)} |`);
  }
  const ids: string[] = arms[0].clips.map((c: any) => c.id);
  for (const id of ids) {
    const first = arms[0].clips.find((c: any) => c.id === id);
    lines.push('', `## Clip ${id.slice(0, 8)} (${Math.round(first.durationSeconds)} s, ${first.frames} stills)`);
    for (const pass of ['dictation', 'dayFilm', 'conversation']) {
      lines.push('', `### ${pass}`);
      for (const a of arms) {
        const c = a.clips.find((x: any) => x.id === id) ?? {};
        const r = c[pass] ?? {};
        const cost = c[`${pass}Cost`] ?? {};
        lines.push('', `**${a.arm}** (${(cost.models ?? []).join(', ') || 'no call'}, $${(cost.usd ?? 0).toFixed(4)}, ${cost.seconds ?? 0}s)`, '');
        if (r.error) {
          lines.push(`Error: ${r.error}`);
          continue;
        }
        if (pass === 'dictation') {
          lines.push(`Summary: ${r.summary ?? r.narration ?? '(none)'}`, '', 'Events:', list(r.events), '', 'Rooms:', list(r.rooms), '', 'People:', list(r.people));
        } else if (pass === 'dayFilm') {
          lines.push(`Summary: ${r.summary ?? '(none)'}`, '', 'Work performed:', list(r.workPerformed));
        } else {
          lines.push(`Summary: ${r.executiveSummary || r.summary || '(none)'} _(source: ${r.source ?? '?'})_`, '', 'Agreements:', list(r.agreements), '', 'Concerns:', list(r.concerns));
        }
      }
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

const argv = process.argv.slice(2);
if (argv[0] === '--compare') {
  compare(argv.slice(1));
} else {
  runArm()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
