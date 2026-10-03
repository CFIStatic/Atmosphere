/**
 * Reconcile recorded AI cost against provider billing.
 *
 *   npm run reconcile:ai-costs              # last 30 UTC days
 *   npm run reconcile:ai-costs -- 2026-09-01 2026-10-01
 *
 * Read-only. Prints one table per provider and exits 2 when any settled day
 * (or the window total) differs from the provider by more than 2%, so a
 * scheduler can alert on it. Providers without admin credentials print
 * "not connected" and what they need (see metering/reconciliation.ts).
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';
import { buildReconciliation } from '../metering/reconciliation.js';

function usd(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(6)}`;
}

async function main(): Promise<void> {
  const [fromArg, toArg] = process.argv.slice(2);
  const to = toArg ? new Date(`${toArg}T00:00:00Z`) : new Date();
  const from = fromArg ? new Date(`${fromArg}T00:00:00Z`) : new Date(to.getTime() - 30 * 86_400_000);
  const client = createAdminClient();
  if (!client) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }
  const report = await buildReconciliation({ client, from: from.toISOString(), to: to.toISOString() });
  console.log(`AI cost reconciliation ${report.window.from} → ${report.window.to} (UTC), flag > ${report.thresholdPct}%`);
  for (const p of report.providers) {
    console.log(`\n${p.label} — ${p.status.replace('_', ' ')}`);
    if (p.requires.length) console.log(`  needs: ${p.requires.join('; ')}`);
    if (p.error) console.log(`  error: ${p.error}`);
    for (const d of p.days) {
      const pct = d.variancePct == null ? '' : ` (${d.variancePct > 0 ? '+' : ''}${d.variancePct}%)`;
      const mark = d.flagged ? '  ⚠ over threshold' : d.pending ? '  (pending)' : '';
      console.log(`  ${d.day}  ours ${usd(d.oursUsd)}  provider ${usd(d.theirsUsd)}${pct}${mark}`);
    }
    console.log(`  settled total  ours ${usd(p.totals.oursUsd)}  provider ${usd(p.totals.theirsUsd)}`);
  }
  if (report.flaggedCount > 0) {
    console.error(`\n${report.flaggedCount} variance(s) over ${report.thresholdPct}%.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
