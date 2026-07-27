import { exportPreferencePairs, runLearningCycle } from '../ai/learn.js';
import { createAdminClient } from '../lib/supabase.js';
import { TASK_TYPES } from '../ai/taskTypes.js';
import type { TaskType } from '../ai/types.js';

/**
 * The learning cycle, as a CLI. Run it on a schedule (hourly is plenty):
 *
 *   npm run learn                      evaluate promotions + mine exemplars
 *   npm run learn -- --export <task>   dump preference pairs as JSONL
 *
 * Kept out of the web process on purpose. Promotion runs golden-set evaluations,
 * which make real model calls — that is minutes of work and dollars of spend,
 * and it has no business sharing a process with request handling.
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exportIndex = args.indexOf('--export');

  if (exportIndex !== -1) {
    const taskType = args[exportIndex + 1];
    if (!taskType || !TASK_TYPES.includes(taskType as TaskType)) {
      console.error(`Usage: npm run learn -- --export <${TASK_TYPES.join('|')}>`);
      process.exitCode = 1;
      return;
    }

    const admin = createAdminClient();
    if (!admin) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is required to export training data.');
      process.exitCode = 1;
      return;
    }

    const pairs = await exportPreferencePairs(admin, taskType as TaskType);
    // JSONL on stdout so it pipes straight into a training job; all logging
    // goes to stderr to keep the stream clean.
    for (const pair of pairs) process.stdout.write(`${JSON.stringify(pair)}\n`);
    console.error(`[learn] exported ${pairs.length} preference pair(s) for ${taskType}`);
    return;
  }

  const report = await runLearningCycle();

  for (const decision of report.decisions) {
    const marker = decision.action === 'promoted' ? '↑' : decision.action === 'retired' ? '✕' : '·';
    console.log(
      `${marker} [${decision.taskType}] ${decision.candidateLabel} — ${decision.action}: ${decision.reason}`,
    );
  }

  console.log(`[learn] exemplars mined: ${report.exemplarsMined}`);

  if (report.errors.length > 0) {
    for (const error of report.errors) console.error(`[learn] error: ${error}`);
    // Non-zero so a scheduler surfaces a partial failure instead of it passing
    // silently — a learning loop that has quietly stopped learning is the worst
    // failure mode this system has, because everything still looks fine.
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`[learn] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
