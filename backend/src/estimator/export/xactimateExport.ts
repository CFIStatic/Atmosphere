import { formatCitation, formatCitations } from '../standards/s500.js';
import { formatCheck } from '../standards/compliance.js';
import type { EstimateLineItem, MitigationEstimate } from '../types.js';

/**
 * File export — the path that works for everyone.
 *
 * No Verisk integration agreement, no browser automation, no password: the user
 * downloads a file and imports it. It is the least glamorous of the three
 * routes into Xactimate and the one most orgs will actually use, so it gets the
 * same care as the others.
 *
 * Three formats:
 *
 *   - **CSV** — a line-item sheet in the column order Xactimate's import expects.
 *     Universally readable, trivially checkable by a human before it goes in.
 *   - **Sketch XML** — room geometry, so the rooms do not have to be re-measured
 *     by hand after a DocuSketch scan already measured them.
 *   - **Scope sheet** — the human-readable narrative, justifications and standard
 *     references. This is the one that goes to the adjuster.
 */

/** RFC 4180 quoting. Estimator notes contain commas and quotes constantly. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

const LINE_ITEM_COLUMNS = [
  'Selector',
  'Category',
  'Description',
  'Room',
  'Quantity',
  'Unit',
  'Unit Price',
  'Total',
  'Note',
  'Standard',
] as const;

/**
 * Line items as CSV.
 *
 * Excel decides a file is UTF-8 only when it sees a BOM, and without one every
 * degree sign and dash in the notes column arrives as mojibake — so the BOM is
 * prepended deliberately.
 */
export function toLineItemCsv(lineItems: EstimateLineItem[]): string {
  const rows = [
    csvRow([...LINE_ITEM_COLUMNS]),
    ...lineItems.map((line) =>
      csvRow([
        line.code,
        line.category,
        line.description,
        line.roomName ?? '',
        line.quantity,
        line.unit,
        line.unitPrice.toFixed(2),
        line.rcv.toFixed(2),
        line.justification,
        formatCitations(line.citations),
      ]),
    ),
  ];
  return `﻿${rows.join('\r\n')}\r\n`;
}

/** XML-escape. */
function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Room geometry as XML.
 *
 * An ESX file is a zip of XML documents whose full schema is proprietary, so
 * this is not an ESX — it is a clean, documented geometry export that a mapping
 * step (or an ESX writer, if one is ever added) can consume, and that a human
 * can read. Claiming ESX compatibility without the schema would produce a file
 * that fails on import for reasons nobody could debug.
 */
export function toSketchXml(estimate: MitigationEstimate): string {
  const { assessment } = estimate;
  const rooms = assessment.rooms
    .map(
      (room) => `    <Room id="${xml(room.id)}" name="${xml(room.name)}" level="${xml(room.level)}">
      <Dimensions length="${room.geometry.lengthFt}" width="${room.geometry.widthFt}" height="${room.geometry.heightFt}" />
      <Areas floorSF="${room.geometry.floorSF}" wallSF="${room.geometry.wallSF}" ceilingSF="${room.geometry.ceilingSF}" perimeterLF="${room.geometry.perimeterLF}" openingSF="${room.geometry.openingSF}" />
      <Affected floorFraction="${room.affectedFloorFraction}" ceiling="${room.ceilingAffected}" />
    </Room>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<MitigationEstimate generatedAt="${xml(estimate.generatedAt)}" jobId="${xml(estimate.jobId)}">
  <Claim number="${xml(assessment.claimNumber ?? '')}" carrier="${xml(assessment.carrier ?? '')}" insured="${xml(assessment.insuredName ?? '')}" />
  <Loss cause="${xml(assessment.cause)}" category="${assessment.category}" class="${assessment.class}" dateOfLoss="${xml(assessment.dateOfLoss ?? '')}" />
  <Rooms>
${rooms}
  </Rooms>
</MitigationEstimate>
`;
}

/**
 * The scope sheet that goes to the adjuster.
 *
 * Every line carries its quantity, its price, the reasoning, and the standard it
 * rests on. An estimate defended line-by-line in writing is one that gets paid
 * without a negotiation — which is worth more than any individual line item on
 * it.
 */
export function toScopeSheet(estimate: MitigationEstimate): string {
  const { assessment, profitability } = estimate;
  const out: string[] = [];

  out.push('MITIGATION SCOPE AND ESTIMATE');
  out.push('='.repeat(72));
  out.push('');
  if (assessment.claimNumber) out.push(`Claim:        ${assessment.claimNumber}`);
  if (assessment.carrier) out.push(`Carrier:      ${assessment.carrier}`);
  if (assessment.insuredName) out.push(`Insured:      ${assessment.insuredName}`);
  if (assessment.propertyAddress) out.push(`Loss address: ${assessment.propertyAddress}`);
  if (assessment.dateOfLoss) out.push(`Date of loss: ${assessment.dateOfLoss.slice(0, 10)}`);
  out.push(`Category ${assessment.category} / Class ${assessment.class}`);
  out.push('');

  out.push('SUMMARY');
  out.push('-'.repeat(72));
  out.push(wrap(estimate.narrative, 72));
  out.push('');

  const byRoom = new Map<string, EstimateLineItem[]>();
  for (const line of estimate.lineItems) {
    const key = line.roomName ?? 'Job-wide';
    byRoom.set(key, [...(byRoom.get(key) ?? []), line]);
  }

  for (const [room, lines] of byRoom) {
    out.push(room.toUpperCase());
    out.push('-'.repeat(72));
    for (const line of lines) {
      out.push(
        `${line.code.padEnd(12)} ${String(line.quantity).padStart(9)} ${line.unit.padEnd(3)} @ ${line.unitPrice.toFixed(2).padStart(9)} = ${line.rcv.toFixed(2).padStart(10)}`,
      );
      out.push(`  ${line.description}`);
      out.push(wrap(`  Basis: ${line.justification}`, 72));
      if (line.citations.length > 0) {
        out.push(wrap(`  Standard: ${formatCitations(line.citations)}`, 72));
      }
      if (line.evidenceGap) out.push(`  ** ${line.evidenceGap} **`);
      out.push('');
    }
  }

  out.push('TOTALS');
  out.push('-'.repeat(72));
  out.push(`Subtotal            ${profitability.subtotal.toFixed(2).padStart(12)}`);
  out.push(`Overhead & profit   ${profitability.overheadAndProfit.toFixed(2).padStart(12)}`);
  out.push(`Tax                 ${profitability.tax.toFixed(2).padStart(12)}`);
  out.push(`TOTAL               ${profitability.total.toFixed(2).padStart(12)}`);
  out.push('');

  /* ---- Program terms ---- */

  const { sla } = estimate;
  if (sla.agreement) {
    out.push('PROGRAM TERMS');
    out.push('-'.repeat(72));
    out.push(
      `${sla.agreement.carrierName} via ${sla.agreement.programName} (agreement ${sla.agreement.version})`,
    );
    out.push(wrap(sla.summary, 72));
    out.push('');
    for (const check of sla.checks) {
      if (check.status === 'not_applicable' || check.status === 'met') continue;
      const mark = { violated: '[!]', deviation_documented: '[~]', approval_required: '[A]', undetermined: '[?]' }[
        check.status as 'violated' | 'deviation_documented' | 'approval_required' | 'undetermined'
      ];
      out.push(`${mark} ${check.title}${check.sourceRef ? `  (${check.sourceRef})` : ''}`);
      out.push(wrap(`    ${check.detail}`, 72));
      // A documented deviation is printed in full. The point of requiring it in
      // writing is that it travels with the estimate to the carrier.
      if (check.deviation) {
        out.push(wrap(`    Authorised by: ${check.deviation.authorizedBy ?? 'unrecorded'}`, 72));
        out.push(wrap(`    Evidence: ${check.deviation.evidenceIds.join(', ')}`, 72));
      }
      out.push('');
    }
  }

  /* ---- Standards compliance ---- */

  const { compliance } = estimate;
  out.push('STANDARDS REVIEW');
  out.push('-'.repeat(72));
  out.push(wrap(compliance.summary, 72));
  out.push('');
  for (const check of compliance.checks) {
    // Not-applicable checks are omitted from the printed sheet — a page of
    // "[-] does not apply" buries the four lines the reader needs.
    if (check.status === 'not_applicable') continue;
    out.push(formatCheck(check));
    out.push('');
  }

  if (estimate.openQuestions.length > 0) {
    out.push('BEFORE SUBMITTING');
    out.push('-'.repeat(72));
    for (const question of estimate.openQuestions) out.push(wrap(`- ${question}`, 72));
    out.push('');
  }

  /* ---- Reference appendix ---- */

  if (estimate.references.length > 0) {
    out.push('STANDARDS REFERENCED');
    out.push('-'.repeat(72));
    out.push(
      wrap(
        'Locations are given so a reader with their own copy of the standard can turn to them. The standards are copyrighted publications of the IICRC and are not reproduced here; each requirement below is paraphrased.',
        72,
      ),
    );
    out.push('');

    for (const reference of estimate.references) {
      out.push(`${reference.title}`);
      out.push(`  ${formatCitation(reference.id)}`);
      out.push(wrap(`  ${reference.requirement}`, 72));
      if (reference.caveat) {
        // The caveats are the honest part: they mark where the industry says
        // "the standard requires" about something it leaves to judgement.
        out.push(wrap(`  NOTE: ${reference.caveat}`, 72));
      }
      out.push('');
    }
  }

  return out.join('\n');
}

function wrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
