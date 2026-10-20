/**
 * Build the clip-summary training set from people's ratings and corrections.
 *
 *   cd backend
 *   npx tsx src/scripts/exportTrainingSet.ts                  # dry run: counts only, writes nothing
 *   npx tsx src/scripts/exportTrainingSet.ts --out ./training # write JSONL files to that folder
 *
 * Reads only workspaces with "Help improve Atmosphere's AI" turned on, and only
 * text (see src/shared/trainingSet.ts for what is left out and scrubbed).
 * Writes to the local folder given and nowhere else: it never uploads. With
 * --out it writes:
 *   summaries.sft.jsonl         {messages:[system,user,assistant], meta}   (chat fine-tuning)
 *   summaries.preference.jsonl  {prompt, chosen, rejected, meta}           (DPO-style tuning)
 *   manifest.json               counts, splits, skip reasons, checksums
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Customer data: run only
 * with sign-off, keep the output off shared drives and CI logs, and review a
 * sample for names the scrubber missed before training on it.
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAdminClient } from '../lib/supabase.js';
import { collectTrainingSet } from '../shared/trainingSet.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function countSplits(rows: Array<{ meta: { split: string } }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.meta.split] = (out[row.meta.split] ?? 0) + 1;
  return out;
}

async function main() {
  const outDir = argValue('--out');
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was read.');
    process.exit(1);
  }
  const set = await collectTrainingSet(admin);
  const summary = {
    generatedAt: new Date().toISOString(),
    orgsOptedIn: set.orgsOptedIn,
    feedbackRows: set.feedbackRows,
    sftExamples: set.sft.length,
    sftBySource: {
      correction: set.sft.filter((e) => e.meta.source === 'correction').length,
      approved: set.sft.filter((e) => e.meta.source === 'approved').length,
    },
    sftSplits: countSplits(set.sft),
    preferencePairs: set.preference.length,
    preferenceSplits: countSplits(set.preference),
    skipped: set.skipped,
  };

  if (!outDir) {
    console.log(JSON.stringify({ ...summary, dryRun: true }, null, 2));
    return;
  }

  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    'summaries.sft.jsonl': jsonl(set.sft),
    'summaries.preference.jsonl': jsonl(set.preference),
  };
  const checksums: Record<string, string> = {};
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
    checksums[name] = createHash('sha256').update(body).digest('hex');
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...summary, checksums }, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, wroteTo: dir }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
