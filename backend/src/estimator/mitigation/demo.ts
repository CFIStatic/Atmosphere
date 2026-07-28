/**
 * Run the whole estimator against the sample job and print the result.
 *
 *   npm run estimator:demo
 *
 * No database, no network, no Xactimate account. This is the fastest way to see
 * what the agent produces and to check a rule change end-to-end before wiring
 * anything up.
 */

import { buildEstimate, DEFAULT_ESTIMATOR_CONFIG } from './agent.js';
import { SAMPLE_JOB } from './fixtures/sampleJob.js';
import { reconcileCatalog } from './catalog/priceList.js';
import { MockXactimateDriver } from './xactimate/mockDriver.js';
import { createConsent } from './xactimate/consent.js';
import { toScopeSheet } from './export/xactimateExport.js';
import { formatCitation } from './standards/s500.js';
import { formatCheck } from './standards/compliance.js';
import { MockSlaSource } from './carrier/source.js';
import { identifyCarrier } from './carrier/identify.js';
import { normalizeSources } from './ingest/index.js';

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd = (value: number) => usdFormatter.format(value);

async function main(): Promise<void> {
  const showScopeSheet = process.argv.includes('--scope-sheet');

  // Pull the mock price list so the run exercises reconciliation rather than
  // silently using placeholder prices — which is the state a real user starts in
  // and the one the estimator is loudest about.
  const grant = createConsent({
    userId: 'demo-user',
    orgId: 'demo-org',
    xactimateUsername: 'demo@example.com',
    scopes: ['read_profile', 'read_price_list'],
  });

  const driver = new MockXactimateDriver();
  const connection = await driver.connect(
    { username: 'demo@example.com', password: 'demo-password' },
    grant,
  );
  if (connection.status !== 'connected') throw new Error('Mock driver failed to connect.');

  const priceList = await driver.fetchPriceList(connection.session, grant, 'DEMO8X_JAN26');
  const reconciled = reconcileCatalog(priceList);

  // Identify the carrier from the sources, then pull that program's terms. The
  // identification runs on the assessment, so it happens once here and again
  // inside buildEstimate — cheap, deterministic, and it keeps the agent's
  // signature free of a pre-computed argument only the demo would supply.
  const probe = identifyCarrier(normalizeSources(SAMPLE_JOB));
  const agreement = probe.carrierId
    ? await new MockSlaSource().fetchAgreement({ carrierId: probe.carrierId, programId: probe.programId })
    : null;

  const estimate = buildEstimate(SAMPLE_JOB, {
    ...DEFAULT_ESTIMATOR_CONFIG,
    priceList,
    catalog: reconciled.catalog,
    agreement,
  });

  if (showScopeSheet) {
    console.log(toScopeSheet(estimate));
    return;
  }

  const { assessment, profitability } = estimate;

  console.log('═'.repeat(78));
  console.log('MITIGATION ESTIMATOR — DEMO RUN');
  console.log('═'.repeat(78));
  console.log();
  console.log(
    `Price list      ${priceList.id} — ${reconciled.matched}/${reconciled.catalog.length} codes matched ` +
      `(${reconciled.remapped.length} by description, ${reconciled.unmatched.length} unmatched)`,
  );
  console.log(`Sources         ${assessment.sourcesUsed.join(', ')}`);
  console.log(`Classification  Category ${assessment.category} (source ${assessment.sourceCategory}) / Class ${assessment.class}`);
  console.log(`Rooms           ${assessment.rooms.map((r) => r.name).join(', ')}`);
  console.log(`Drying          ${assessment.dryingDays} days, ${assessment.monitoringVisits} monitoring visits`);
  console.log(`Evidence        ${assessment.evidence.length} items (${assessment.evidence.filter((e) => e.kind === 'photo').length} photos, ${assessment.moistureReadings.length} readings)`);
  console.log();

  console.log('NARRATIVE');
  console.log('─'.repeat(78));
  console.log(estimate.narrative);
  console.log();

  console.log(`LINE ITEMS (${estimate.lineItems.length})`);
  console.log('─'.repeat(78));
  for (const line of estimate.lineItems) {
    console.log(
      `${line.code.padEnd(11)} ${(line.roomName ?? 'Job-wide').padEnd(14)} ` +
        `${String(line.quantity).padStart(9)} ${line.unit.padEnd(3)} ` +
        `${usd(line.rcv).padStart(11)}  ${line.priceVerified ? ' ' : '~'} ${line.description.slice(0, 44)}`,
    );
  }
  console.log(`${' '.repeat(39)}${'─'.repeat(12)}`);
  console.log(`${'Subtotal'.padEnd(39)}${usd(profitability.subtotal).padStart(12)}`);
  console.log(`${'Overhead & profit'.padEnd(39)}${usd(profitability.overheadAndProfit).padStart(12)}`);
  console.log(`${'Tax'.padEnd(39)}${usd(profitability.tax).padStart(12)}`);
  console.log(`${'TOTAL'.padEnd(39)}${usd(profitability.total).padStart(12)}`);
  console.log();

  console.log('PROFITABILITY');
  console.log('─'.repeat(78));
  console.log(`Cost basis        ${usd(profitability.totalCost)}`);
  console.log(`Gross profit      ${usd(profitability.grossProfit)}`);
  console.log(
    `Gross margin      ${(profitability.grossMargin * 100).toFixed(1)}% against a ${(profitability.targetMargin * 100).toFixed(0)}% target`,
  );
  console.log(`Margin gap        ${usd(profitability.marginGap)} of revenue to reach target`);
  console.log(`Recoverable       ${usd(profitability.recoverableRevenue)} across ${profitability.findings.length} findings`);
  console.log();

  console.log('FINDINGS');
  console.log('─'.repeat(78));
  for (const finding of profitability.findings) {
    const marker = { critical: '!!', warning: ' !', info: '  ' }[finding.severity];
    const impact = finding.revenueImpact !== 0 ? `  ${usd(finding.revenueImpact)}` : '';
    console.log(`${marker} ${finding.title}${impact}`);
    console.log(`   ${finding.detail}`);
    if (finding.actionRequired) console.log(`   → ${finding.actionRequired}`);
    console.log();
  }

  console.log('PROGRAM (SLA) REVIEW');
  console.log('─'.repeat(78));
  const { sla } = estimate;
  console.log(
    `Carrier         ${sla.identification.carrierName ?? 'not identified'} (${sla.identification.confidence})` +
      `${sla.identification.programName ? ` via ${sla.identification.programName}` : ''}`,
  );
  console.log(sla.summary);
  console.log();
  for (const check of sla.checks) {
    if (check.status === 'not_applicable') continue;
    const mark = {
      met: '[x]',
      violated: '[!]',
      deviation_documented: '[~]',
      approval_required: '[A]',
      undetermined: '[?]',
      not_applicable: '[-]',
    }[check.status];
    console.log(`${mark} ${check.title}${check.sourceRef ? `  (${check.sourceRef})` : ''}`);
    console.log(`    ${check.detail}`);
    if (check.remedy) console.log(`    → ${check.remedy}`);
  }
  if (sla.proposedDeviations.length > 0) {
    console.log();
    console.log(`    ${sla.proposedDeviations.length} documented deviation(s) available for a human to accept:`);
    for (const proposal of sla.proposedDeviations) {
      console.log(`    · ${proposal.ruleId}: ${proposal.reason}`);
      console.log(`      evidence: ${proposal.evidenceIds.join(', ')}`);
    }
  }
  console.log();

  console.log('STANDARDS REVIEW');
  console.log('─'.repeat(78));
  console.log(estimate.compliance.summary);
  console.log();
  for (const check of estimate.compliance.checks) {
    if (check.status === 'not_applicable') continue;
    console.log(formatCheck(check));
  }
  console.log();

  if (estimate.openQuestions.length > 0) {
    console.log('BEFORE SUBMITTING');
    console.log('─'.repeat(78));
    for (const question of estimate.openQuestions) console.log(`• ${question}`);
    console.log();
  }

  console.log(`STANDARDS REFERENCED (${estimate.references.length})`);
  console.log('─'.repeat(78));
  for (const reference of estimate.references) {
    console.log(`${reference.title.padEnd(48)} ${formatCitation(reference.id)}`);
  }
  console.log();

  console.log('Re-run with --scope-sheet to see the adjuster-facing document.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
