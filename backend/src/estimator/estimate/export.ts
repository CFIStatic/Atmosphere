import type { ConstructionEstimate, EstimateLineItem } from '../types.js';

/**
 * Estimate export.
 *
 * Xactimate's native `.esx` is a proprietary binary container, so nothing
 * outside Verisk's tooling can legitimately author one. What every Xactimate
 * workflow *does* accept is a structured line-item interchange: rooms, category
 * and selector codes, units, and quantities. This module emits that in two
 * shapes:
 *
 *   • **XML** — grouped by room, mirroring how Xactimate models a sketch, for
 *     import via the platform's estimate-interchange endpoint.
 *   • **CSV** — the format estimators actually paste into a worksheet when they
 *     want to eyeball the scope before committing it.
 *
 * Both carry the rationale and evidence for every line. That is not decoration:
 * an estimate an adjuster can trace back to a photo gets approved, and one that
 * arrives as bare quantities gets a phone call.
 */

/** Quantities go out at two decimals — Xactimate's own precision. */
function qty(value: number): string {
  return value.toFixed(2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function groupByRoom(lineItems: EstimateLineItem[]): Map<string, EstimateLineItem[]> {
  const rooms = new Map<string, EstimateLineItem[]>();
  for (const item of lineItems) {
    const bucket = rooms.get(item.roomId);
    if (bucket) bucket.push(item);
    else rooms.set(item.roomId, [item]);
  }
  return rooms;
}

export function toXactimateXml(estimate: ConstructionEstimate): string {
  const rooms = groupByRoom(estimate.lineItems);

  const roomXml = [...rooms.entries()]
    .map(([roomId, items]) => {
      const lines = items
        .map(
          (item) =>
            `        <LineItem ` +
            `category="${escapeXml(item.category)}" ` +
            `selector="${escapeXml(item.selector)}" ` +
            `code="${escapeXml(item.code)}" ` +
            `unit="${escapeXml(item.unit)}" ` +
            `quantity="${qty(item.quantityWithWaste)}" ` +
            `quantityBeforeWaste="${qty(item.quantity)}" ` +
            `trade="${escapeXml(item.trade)}" ` +
            `confidence="${item.confidence.toFixed(2)}"` +
            `${item.needsReview ? ' needsReview="true"' : ''}>\n` +
            `          <Description>${escapeXml(item.description)}</Description>\n` +
            `          <Rationale>${escapeXml(item.rationale)}</Rationale>\n` +
            `          <Evidence>${escapeXml(item.evidence.join(','))}</Evidence>\n` +
            `        </LineItem>`,
        )
        .join('\n');

      return (
        `      <Room id="${escapeXml(roomId)}" name="${escapeXml(items[0]!.roomName)}">\n` +
        `${lines}\n` +
        `      </Room>`
      );
    })
    .join('\n');

  const warnings = estimate.warnings
    .map((w) => `      <Warning>${escapeXml(w)}</Warning>`)
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Estimate generator="Atmosphere Construction Estimator" generatedAt="${escapeXml(estimate.generatedAt)}" basis="${escapeXml(estimate.basis)}">\n` +
    `  <Claim>\n` +
    `    <JobId>${escapeXml(estimate.jobId)}</JobId>\n` +
    `    <JobNumber>${escapeXml(estimate.jobNumber ?? '')}</JobNumber>\n` +
    `    <ClaimNumber>${escapeXml(estimate.claimNumber ?? '')}</ClaimNumber>\n` +
    `    <Insured>${escapeXml(estimate.insuredName ?? '')}</Insured>\n` +
    `    <Address>\n` +
    `      <Street>${escapeXml(estimate.address.street ?? '')}</Street>\n` +
    `      <City>${escapeXml(estimate.address.city ?? '')}</City>\n` +
    `      <State>${escapeXml(estimate.address.state ?? '')}</State>\n` +
    `      <PostalCode>${escapeXml(estimate.address.postalCode ?? '')}</PostalCode>\n` +
    `    </Address>\n` +
    `  </Claim>\n` +
    `  <Scope>\n` +
    `${roomXml}\n` +
    `  </Scope>\n` +
    (warnings ? `  <Warnings>\n${warnings}\n  </Warnings>\n` : '') +
    `</Estimate>\n`
  );
}

/** RFC 4180 quoting — descriptions routinely contain commas and quotes. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(estimate: ConstructionEstimate): string {
  const header = [
    'Room',
    'Category',
    'Selector',
    'Code',
    'Description',
    'Unit',
    'Quantity',
    'QuantityBeforeWaste',
    'Trade',
    'Confidence',
    'NeedsReview',
    'Rationale',
    'Evidence',
  ];

  const rows = estimate.lineItems.map((item) =>
    [
      item.roomName,
      item.category,
      item.selector,
      item.code,
      item.description,
      item.unit,
      qty(item.quantityWithWaste),
      qty(item.quantity),
      item.trade,
      item.confidence.toFixed(2),
      item.needsReview ? 'yes' : 'no',
      item.rationale,
      item.evidence.join(' '),
    ].map((cell) => csvCell(String(cell))),
  );

  return [header.map(csvCell).join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}
