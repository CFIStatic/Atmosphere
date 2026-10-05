/**
 * Print (or dry-run) the daily on-site digest for one job.
 *
 *   cd backend
 *   npx tsx src/scripts/runSiteDigest.ts --job <jobId>
 *
 * Does not send email. Homeowner updates require Computer Approve.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';
import { buildSiteDigest, formatSiteDigestForContractor } from '../shared/siteDigest.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const jobId = arg('--job');
  if (!jobId) {
    console.error('Usage: npx tsx src/scripts/runSiteDigest.ts --job <jobId>');
    process.exit(1);
  }
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set.');
    process.exit(1);
  }
  const { data: job } = await admin.from('jobs').select('id, title, claim_number').eq('id', jobId).maybeSingle();
  const { data: proofs } = await admin
    .from('job_proofs')
    .select('work_date, title, custom_title, ai_summary, narration_text, transcript_text, ai_findings')
    .eq('job_id', jobId)
    .order('work_date', { ascending: false })
    .limit(12);

  const clips = (proofs ?? []).map((row: any) => {
    const findings = row.ai_findings && typeof row.ai_findings === 'object' ? row.ai_findings : {};
    return {
      workDate: row.work_date,
      title: row.custom_title || row.title,
      summary: row.ai_summary ?? findings.summary ?? null,
      narration: row.narration_text ?? null,
      transcript: row.transcript_text ?? null,
      concerns: Array.isArray(findings.concerns) ? findings.concerns : [],
      changes: Array.isArray(findings.changes) ? findings.changes : [],
    };
  });

  const digest = buildSiteDigest({
    jobTitle: job?.title ?? null,
    claimNumber: job?.claim_number ?? null,
    clips,
  });
  console.log(formatSiteDigestForContractor(digest));
  console.log('\n---\nHomeowner draft requires Approve before Send. Nothing was emailed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
