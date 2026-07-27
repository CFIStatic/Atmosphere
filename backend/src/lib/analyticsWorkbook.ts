/**
 * Excel export for the growth dashboards.
 *
 * Every number on screen is downloadable, and it arrives as a NUMBER, not a
 * pre-formatted string: money is written in dollars with a currency format and
 * percentages as real percentages, so the recipient can sum, pivot and chart the
 * export without retyping anything. Cents-to-dollars conversion happens here,
 * once, rather than being scattered through the sheets.
 */

import ExcelJS from 'exceljs';
import type {
  AccountRow,
  AnalyticsScope,
  FeatureRow,
  MonthlyRow,
  OverviewPayload,
  PlanMixRow,
  RetentionRow,
  SummaryPayload,
} from './analytics.js';

export type Dataset =
  | 'all'
  | 'summary'
  | 'monthly'
  | 'features'
  | 'plans'
  | 'retention'
  | 'accounts';

const MONEY = '$#,##0.00';
const COUNT = '#,##0';
const DECIMAL = '#,##0.00';
const PERCENT = '0.0"%"';

// Brand header band: the warm near-black canvas with the off-white wordmark ink.
const INK = 'FF1A1A1A';
const PAPER = 'FFF5F4F1';
const BRAND_ORANGE = 'FFF26522';

interface Column<T> {
  header: string;
  width: number;
  format?: string;
  value: (row: T) => string | number | Date | null;
}

const dollars = (cents: number | null | undefined): number | null =>
  cents === null || cents === undefined ? null : Math.round(cents) / 100;

const asDate = (value: string | null): Date | null => (value ? new Date(value) : null);

/** Header styling + freeze + autofilter, applied identically to every sheet. */
function dressSheet(sheet: ExcelJS.Worksheet, columnCount: number, headerRow = 1): void {
  const header = sheet.getRow(headerRow);
  header.font = { bold: true, color: { argb: PAPER }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.height = 22;
  // The orange rule under the header echoes the logo's accent bar.
  header.border = { bottom: { style: 'medium', color: { argb: BRAND_ORANGE } } };

  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  if (columnCount > 0) {
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: columnCount },
    };
  }
}

function addTable<T>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Column<T>[],
  rows: T[],
  note?: string,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 18 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  let headerRowIndex = 1;
  if (note) {
    sheet.addRow([note]);
    sheet.getRow(1).font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    sheet.addRow([]);
    headerRowIndex = 3;
  }

  sheet.addRow(columns.map((c) => c.header));

  for (const row of rows) {
    sheet.addRow(columns.map((c) => c.value(row)));
  }

  columns.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = column.width;
    if (column.format) {
      // Skip the note/header rows so the format lands only on data cells.
      col.numFmt = column.format;
    }
  });

  dressSheet(sheet, columns.length, headerRowIndex);

  // Re-apply header text styling: numFmt on a column would otherwise format the
  // header cell too, which turns a text label into a stray zero in some readers.
  const header = sheet.getRow(headerRowIndex);
  header.eachCell((cell) => {
    cell.numFmt = 'General';
  });
  if (note) {
    sheet.getRow(1).getCell(1).numFmt = 'General';
  }

  return sheet;
}

/** The KPI sheet: one metric per row, so it reads top-to-bottom like a brief. */
function addSummarySheet(workbook: ExcelJS.Workbook, summary: SummaryPayload, note: string): void {
  const sheet = workbook.addWorksheet('Summary', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.addRow([note]);
  sheet.getRow(1).font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sheet.addRow([]);
  sheet.addRow(['Section', 'Metric', 'Value', 'Unit']);

  const r = summary.revenue;
  const rows: [string, string, number | string | null, string][] = [
    ['Revenue', 'MRR (monthly recurring revenue)', dollars(r.mrrCents), 'USD / month'],
    ['Revenue', 'ARR (annual run-rate)', dollars(r.arrCents), 'USD / year'],
    ['Revenue', 'MRR on annual contracts', dollars(r.annualContractedMrrCents), 'USD / month'],
    ['Revenue', 'ARR on annual contracts', dollars(r.annualContractedArrCents), 'USD / year'],
    ['Revenue', 'MRR billed monthly', dollars(r.monthlyBilledMrrCents), 'USD / month'],
    ['Revenue', 'Trial pipeline MRR', dollars(r.trialPipelineMrrCents), 'USD / month'],
    ['Revenue', 'Net new MRR this month', dollars(r.netNewMrrCents), 'USD'],
    ['Revenue', 'MRR growth (month over month)', r.mrrGrowthMomPct, '%'],
    ['Revenue', 'Collected in range', dollars(r.collectedInRangeCents), 'USD'],
    ['Revenue', 'Subscription revenue in range', dollars(r.subscriptionRevenueCents), 'USD'],
    ['Revenue', 'Credit revenue in range', dollars(r.creditRevenueCents), 'USD'],
    ['Revenue', 'Trailing 12-month revenue', dollars(r.trailing12mRevenueCents), 'USD'],
    ['Revenue', 'Average monthly spend per account', dollars(r.avgMonthlySpendPerAccountCents), 'USD / month'],
    ['Revenue', 'Average monthly spend per seat', dollars(r.avgMonthlySpendPerSeatCents), 'USD / month'],
    ['Revenue', 'ARPA (MRR per paying account)', dollars(r.arpaMrrCents), 'USD / month'],

    ['Customers', 'Organizations (total)', summary.customers.orgsTotal, 'count'],
    ['Customers', 'Organizations (paying)', summary.customers.orgsPaying, 'count'],
    ['Customers', 'Organizations (new in range)', summary.customers.orgsNew, 'count'],
    ['Customers', 'Organizations (active in range)', summary.customers.orgsActive, 'count'],
    ['Customers', 'Organization growth (month over month)', summary.customers.orgsGrowthMomPct, '%'],

    ['Users', 'Users (total)', summary.users.usersTotal, 'count'],
    ['Users', 'Users (new in range)', summary.users.usersNew, 'count'],
    ['Users', 'Users (active in range)', summary.users.usersActive, 'count'],
    ['Users', 'User growth (month over month)', summary.users.usersGrowthMomPct, '%'],

    ['Seats', 'Seats licensed', summary.seats.seatsLicensed, 'count'],
    ['Seats', 'Seats filled', summary.seats.seatsFilled, 'count'],
    ['Seats', 'Seat utilization', summary.seats.seatUtilizationPct, '%'],
    ['Seats', 'Seat growth (month over month)', summary.seats.seatsGrowthMomPct, '%'],

    ['Engagement', 'Tracked hours in product', summary.engagement.trackedHours, 'hours'],
    ['Engagement', 'Feature sessions', summary.engagement.sessions, 'count'],
    ['Engagement', 'Features used', summary.engagement.featuresUsed, 'count'],
    ['Engagement', 'Features instrumented', summary.engagement.featuresTracked, 'count'],
    ['Engagement', 'AI requests', summary.engagement.aiRequests, 'count'],
  ];

  if (summary.unitEconomics) {
    const u = summary.unitEconomics;
    rows.push(
      ['Unit economics', 'Billed usage', dollars(u.billedUsageCents), 'USD'],
      ['Unit economics', 'Model cost', dollars(u.modelCostCents), 'USD'],
      ['Unit economics', 'Gross margin', dollars(u.grossMarginCents), 'USD'],
      ['Unit economics', 'Gross margin', u.grossMarginPct, '%'],
    );
  }

  for (const [section, metric, value, unit] of rows) {
    const added = sheet.addRow([section, metric, value, unit]);
    const cell = added.getCell(3);
    if (unit === '%') cell.numFmt = PERCENT;
    else if (unit.startsWith('USD')) cell.numFmt = MONEY;
    else if (unit === 'hours') cell.numFmt = DECIMAL;
    else cell.numFmt = COUNT;
  }

  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 42;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 14;
  dressSheet(sheet, 4, 3);
  sheet.getRow(3).eachCell((cell) => {
    cell.numFmt = 'General';
  });
}

const monthlyColumns: Column<MonthlyRow>[] = [
  { header: 'Month', width: 12, value: (r) => r.month },
  { header: 'MRR', width: 14, format: MONEY, value: (r) => dollars(r.mrrCents) },
  { header: 'ARR', width: 14, format: MONEY, value: (r) => dollars(r.arrCents) },
  { header: 'MRR growth %', width: 14, format: PERCENT, value: (r) => r.mrrGrowthPct },
  { header: 'Revenue collected', width: 16, format: MONEY, value: (r) => dollars(r.revenueCents) },
  { header: 'Subscription revenue', width: 18, format: MONEY, value: (r) => dollars(r.subscriptionRevenueCents) },
  { header: 'Credit revenue', width: 15, format: MONEY, value: (r) => dollars(r.creditRevenueCents) },
  { header: 'ARPA', width: 12, format: MONEY, value: (r) => dollars(r.arpaCents) },
  { header: 'Seats', width: 10, format: COUNT, value: (r) => r.seats },
  { header: 'Seat growth %', width: 14, format: PERCENT, value: (r) => r.seatGrowthPct },
  { header: 'Users (total)', width: 13, format: COUNT, value: (r) => r.totalUsers },
  { header: 'Users (new)', width: 12, format: COUNT, value: (r) => r.newUsers },
  { header: 'Users (active)', width: 13, format: COUNT, value: (r) => r.activeUsers },
  { header: 'User growth %', width: 14, format: PERCENT, value: (r) => r.userGrowthPct },
  { header: 'Orgs (total)', width: 12, format: COUNT, value: (r) => r.totalOrgs },
  { header: 'Orgs (new)', width: 11, format: COUNT, value: (r) => r.newOrgs },
  { header: 'Orgs (paying)', width: 13, format: COUNT, value: (r) => r.payingOrgs },
  { header: 'Orgs (active)', width: 13, format: COUNT, value: (r) => r.activeOrgs },
  { header: 'Orgs churned', width: 13, format: COUNT, value: (r) => r.churnedOrgs },
  { header: 'Hours in product', width: 16, format: DECIMAL, value: (r) => r.trackedHours },
];

const featureColumns: Column<FeatureRow>[] = [
  { header: 'Rank', width: 7, format: COUNT, value: (r) => r.timeRank },
  { header: 'Feature', width: 24, value: (r) => r.label },
  { header: 'Area', width: 14, value: (r) => r.area },
  { header: 'Hours used', width: 13, format: DECIMAL, value: (r) => r.activeHours },
  { header: 'Share of time %', width: 15, format: PERCENT, value: (r) => r.sharePct },
  { header: 'Sessions', width: 11, format: COUNT, value: (r) => r.sessions },
  { header: 'Avg session (min)', width: 17, format: DECIMAL, value: (r) => r.avgSessionMinutes },
  { header: 'Users', width: 9, format: COUNT, value: (r) => r.users },
  { header: 'Orgs', width: 9, format: COUNT, value: (r) => r.orgs },
  { header: 'AI requests', width: 12, format: COUNT, value: (r) => r.aiRequests },
  { header: 'Last used', width: 20, format: 'yyyy-mm-dd hh:mm', value: (r) => asDate(r.lastUsedAt) },
  { header: 'Key', width: 18, value: (r) => r.featureKey },
];

const planColumns: Column<PlanMixRow>[] = [
  { header: 'Plan', width: 18, value: (r) => r.planName },
  { header: 'Billing interval', width: 15, value: (r) => r.billingInterval },
  { header: 'Organizations', width: 14, format: COUNT, value: (r) => r.orgs },
  { header: 'Seats', width: 10, format: COUNT, value: (r) => r.seats },
  { header: 'MRR', width: 14, format: MONEY, value: (r) => dollars(r.mrrCents) },
  { header: 'ARR', width: 14, format: MONEY, value: (r) => dollars(r.arrCents) },
  { header: 'Share of MRR %', width: 15, format: PERCENT, value: (r) => r.mrrSharePct },
  { header: 'Plan code', width: 14, value: (r) => r.planCode },
];

const retentionColumns: Column<RetentionRow>[] = [
  { header: 'Cohort month', width: 14, value: (r) => r.cohortMonth },
  { header: 'Cohort size', width: 12, format: COUNT, value: (r) => r.cohortSize },
  { header: 'Months since signup', width: 19, format: COUNT, value: (r) => r.monthOffset },
  { header: 'Active orgs', width: 12, format: COUNT, value: (r) => r.activeOrgs },
  { header: 'Retention %', width: 13, format: PERCENT, value: (r) => r.retentionPct },
];

const accountColumns: Column<AccountRow>[] = [
  { header: 'Organization', width: 28, value: (r) => r.orgName },
  { header: 'Plan', width: 14, value: (r) => r.planName },
  { header: 'Billing interval', width: 15, value: (r) => r.billingInterval },
  { header: 'Status', width: 12, value: (r) => r.status },
  { header: 'MRR', width: 13, format: MONEY, value: (r) => dollars(r.mrrCents) },
  { header: 'ARR', width: 14, format: MONEY, value: (r) => dollars(r.arrCents) },
  { header: 'Revenue in range', width: 16, format: MONEY, value: (r) => dollars(r.revenueInRangeCents) },
  { header: 'Usage billed', width: 14, format: MONEY, value: (r) => (r.creditSpendCents ?? 0) / 100 },
  { header: 'Seats', width: 9, format: COUNT, value: (r) => r.seats },
  { header: 'Members', width: 10, format: COUNT, value: (r) => r.members },
  { header: 'Hours in product', width: 16, format: DECIMAL, value: (r) => r.activeHours },
  { header: 'Most-used tool', width: 22, value: (r) => r.topFeature },
  { header: 'Signed up', width: 13, format: 'yyyy-mm-dd', value: (r) => asDate(r.createdAt) },
  { header: 'Last active', width: 20, format: 'yyyy-mm-dd hh:mm', value: (r) => asDate(r.lastActiveAt) },
];

function formatRange(payload: OverviewPayload): string {
  const from = new Date(payload.range.from).toISOString().slice(0, 10);
  const to = new Date(payload.range.to).toISOString().slice(0, 10);
  return `${from} → ${to}`;
}

function header(payload: OverviewPayload, label: string): string {
  const view = payload.scope === 'internal' ? 'Internal' : 'Investor';
  return `Atmosphere — ${label} · ${view} view · ${formatRange(payload)} · generated ${new Date(
    payload.generatedAt,
  )
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16)} UTC`;
}

/**
 * The definitions sheet. A revenue number without its definition is an argument
 * waiting to happen, so every export carries the arithmetic with it.
 */
function addDefinitionsSheet(workbook: ExcelJS.Workbook, scope: AnalyticsScope): void {
  const rows: [string, string][] = [
    ['MRR', 'Monthly recurring revenue: each active or past-due subscription at its plan price (annual plans use the annual per-month rate), multiplied by seats on per-seat plans.'],
    ['ARR', 'MRR × 12 — the annualised run-rate of today’s subscriptions, not trailing revenue.'],
    ['MRR on annual contracts', 'The slice of MRR from subscriptions billed annually (prepaid, hardest to churn).'],
    ['Trial pipeline MRR', 'What trialing subscriptions would add to MRR if they converted as-is. Never counted inside MRR.'],
    ['Revenue collected', 'Cash from succeeded payments in the period — subscriptions plus credit purchases. Independent of MRR.'],
    ['Average monthly spend', 'Revenue collected in the range, normalised to a 30-day month, divided by paying accounts (or by seats).'],
    ['ARPA', 'MRR divided by the number of paying accounts.'],
    ['Seats', 'Licensed seats on active, past-due or trialing subscriptions. "Filled" counts members actually linked to those orgs.'],
    ['Active org / user', 'Recorded product activity in the period: a feature session or an AI request.'],
    ['Hours in product', 'Foreground time in a tool, accumulated from 30-second client heartbeats. Each heartbeat is capped at 5 minutes so a backgrounded tab cannot inflate it.'],
    ['Share of time %', 'A feature’s hours as a percentage of all tracked hours in the period.'],
    ['Least-used tools', 'Instrumented features are always listed, including those with zero recorded time — that is how the bottom of the ranking stays meaningful.'],
    ['Churned orgs', 'Subscriptions moving to canceled in the month, having previously carried MRR.'],
    ['Retention', 'Of the orgs that signed up in a cohort month, the share showing product activity N months later.'],
    ['Point-in-time history', 'Monthly seats and MRR are reconstructed from the subscription change log, so past months reflect the plans and prices in force then. Months before the log was introduced show the state at its backfill.'],
  ];

  if (scope === 'internal') {
    rows.push([
      'Unit economics',
      'Billed usage is what customers were charged for AI usage; model cost is what it cost us; gross margin is the difference. Internal view only.',
    ]);
  }

  const sheet = workbook.addWorksheet('Definitions');
  sheet.addRow(['Metric', 'Definition']);
  rows.forEach((row) => sheet.addRow(row));
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 110;
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  dressSheet(sheet, 2);
}

/**
 * Build the workbook for a dataset. `all` produces the full multi-sheet export;
 * the per-dataset options produce a single sheet plus definitions.
 *
 * The Accounts sheet is written only for internal scope — the investor workbook
 * has no customer-identifying sheet to accidentally forward.
 */
export function buildWorkbook(payload: OverviewPayload, dataset: Dataset = 'all'): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Atmosphere';
  workbook.created = new Date(payload.generatedAt);
  workbook.title = `Atmosphere growth analytics (${payload.scope})`;

  const want = (name: Dataset): boolean => dataset === 'all' || dataset === name;

  if (want('summary')) {
    addSummarySheet(workbook, payload.summary, header(payload, 'Key metrics'));
  }
  if (want('monthly')) {
    addTable(workbook, 'Monthly growth', monthlyColumns, payload.monthly, header(payload, 'Monthly growth'));
  }
  if (want('features')) {
    addTable(workbook, 'Feature usage', featureColumns, payload.features, header(payload, 'Feature usage by time spent'));
  }
  if (want('plans')) {
    addTable(workbook, 'Plan mix', planColumns, payload.planMix, header(payload, 'Plan mix'));
  }
  if (want('retention')) {
    addTable(workbook, 'Retention', retentionColumns, payload.retention, header(payload, 'Cohort retention'));
  }
  if (want('accounts') && payload.accounts) {
    addTable(workbook, 'Accounts', accountColumns, payload.accounts, header(payload, 'Accounts'));
  }

  addDefinitionsSheet(workbook, payload.scope);
  return workbook;
}

export function workbookFilename(payload: OverviewPayload, dataset: Dataset): string {
  const stamp = new Date(payload.generatedAt).toISOString().slice(0, 10);
  const view = payload.scope === 'internal' ? 'internal' : 'investor';
  const suffix = dataset === 'all' ? 'growth-analytics' : `growth-${dataset}`;
  return `atmosphere-${suffix}-${view}-${stamp}.xlsx`;
}
