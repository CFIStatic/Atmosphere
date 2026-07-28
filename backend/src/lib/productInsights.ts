/**
 * Product intelligence for the internal Atmosphere team.
 *
 * Turns feature-usage + retention + account engagement into concrete advice:
 * what to cut, where to invest, and how to make the product stickier. Pure
 * functions — no database, no LLM — so the same rules the dashboard shows can
 * be unit-tested and never disagree with an export.
 *
 * Confidence tracks how much telemetry we actually have. Thin data still
 * produces recommendations, but they are labelled as provisional so nobody
 * sunsets a tool on a handful of hours.
 */

import type { AccountRow, FeatureRow, RetentionRow, SummaryPayload } from './analytics.js';

export type InsightKind = 'cut' | 'invest' | 'stickiness' | 'watch';
export type InsightPriority = 'high' | 'medium' | 'low';
export type InsightConfidence = 'low' | 'medium' | 'high';

export interface AreaUsage {
  area: string;
  activeHours: number;
  sharePct: number;
  featuresUsed: number;
  featuresTracked: number;
  sessions: number;
  /** Distinct-ish reach: max users seen on any single feature in the area. */
  peakUsers: number;
}

export interface ProductInsight {
  id: string;
  kind: InsightKind;
  priority: InsightPriority;
  title: string;
  rationale: string;
  action: string;
  featureKeys: string[];
  area: string | null;
  metrics: Record<string, number | string | null>;
}

export interface ProductIntelligence {
  confidence: InsightConfidence;
  confidenceNote: string;
  areas: AreaUsage[];
  hottest: FeatureRow[];
  coldest: FeatureRow[];
  insights: ProductInsight[];
}

/** Platform plumbing — almost never a "cut" recommendation. */
const CORE_KEYS = new Set([
  'dashboard',
  'onboarding',
  'billing_console',
  'credits',
  'pin_signin',
  'org_directory',
  'settings',
  'usage_console',
]);

/** Internal-only surfaces; low usage here is expected, not a product failure. */
const INTERNAL_ONLY_KEYS = new Set(['growth_analytics']);

export function buildProductIntelligence(input: {
  features: FeatureRow[];
  accounts: AccountRow[] | null;
  retention: RetentionRow[];
  summary: SummaryPayload;
}): ProductIntelligence {
  const { features, accounts, retention, summary } = input;
  const trackedHours = summary.engagement.trackedHours;
  const confidence = confidenceFor(trackedHours);
  const confidenceNote =
    confidence === 'high'
      ? `${trackedHours.toFixed(1)} tracked hours — recommendations are on solid ground.`
      : confidence === 'medium'
        ? `${trackedHours.toFixed(1)} tracked hours — useful signal, still provisional.`
        : trackedHours <= 0
          ? 'No product telemetry in this range yet — recommendations will firm up as heartbeats arrive.'
          : `Only ${trackedHours.toFixed(1)} tracked hours — treat every recommendation as a hypothesis.`;

  const areas = rollupAreas(features);
  const hottest = [...features]
    .filter((f) => f.activeHours > 0)
    .sort((a, b) => b.activeHours - a.activeHours)
    .slice(0, 5);
  const coldest = [...features].sort((a, b) => a.activeHours - b.activeHours).slice(0, 5);

  const insights: ProductInsight[] = [];
  insights.push(...cutInsights(features, summary));
  insights.push(...investInsights(features, accounts));
  insights.push(...stickinessInsights(features, accounts, retention, summary, areas));
  insights.push(...watchInsights(features, summary));

  // Stable order: high cut/invest first, then stickiness, then watch.
  const kindRank: Record<InsightKind, number> = { cut: 0, invest: 1, stickiness: 2, watch: 3 };
  const priorityRank: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 };
  insights.sort(
    (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      kindRank[a.kind] - kindRank[b.kind] ||
      a.title.localeCompare(b.title),
  );

  return {
    confidence,
    confidenceNote,
    areas,
    hottest,
    coldest,
    insights: insights.slice(0, 12),
  };
}

function confidenceFor(trackedHours: number): InsightConfidence {
  if (trackedHours >= 50) return 'high';
  if (trackedHours >= 5) return 'medium';
  return 'low';
}

function rollupAreas(features: FeatureRow[]): AreaUsage[] {
  const byArea = new Map<string, FeatureRow[]>();
  for (const f of features) {
    const list = byArea.get(f.area) ?? [];
    list.push(f);
    byArea.set(f.area, list);
  }

  const totalHours = features.reduce((sum, f) => sum + f.activeHours, 0);
  const areas: AreaUsage[] = [];

  for (const [area, rows] of byArea) {
    const activeHours = rows.reduce((sum, f) => sum + f.activeHours, 0);
    areas.push({
      area,
      activeHours,
      sharePct: totalHours > 0 ? (activeHours / totalHours) * 100 : 0,
      featuresUsed: rows.filter((f) => f.activeHours > 0).length,
      featuresTracked: rows.length,
      sessions: rows.reduce((sum, f) => sum + f.sessions, 0),
      peakUsers: rows.reduce((max, f) => Math.max(max, f.users), 0),
    });
  }

  return areas.sort((a, b) => b.activeHours - a.activeHours);
}

function cutInsights(features: FeatureRow[], summary: SummaryPayload): ProductInsight[] {
  const out: ProductInsight[] = [];
  const activeOrgs = Math.max(1, summary.customers.orgsActive);

  const unused = features.filter(
    (f) =>
      f.activeHours === 0 &&
      !CORE_KEYS.has(f.featureKey) &&
      !INTERNAL_ONLY_KEYS.has(f.featureKey),
  );

  if (unused.length >= 3) {
    out.push({
      id: 'cut-unused-cluster',
      kind: 'cut',
      priority: unused.length >= 5 ? 'high' : 'medium',
      title: `${unused.length} tools have no recorded time`,
      rationale: `In this period nobody spent foreground time in: ${unused
        .slice(0, 6)
        .map((f) => f.label)
        .join(', ')}${unused.length > 6 ? '…' : ''}. Shipping surface area nobody opens raises navigation cost for everyone else.`,
      action:
        'Hide these from primary nav (keep deep links), merge into a parent workflow, or schedule a sunset. Confirm with 2–3 customer calls before deleting data paths.',
      featureKeys: unused.map((f) => f.featureKey),
      area: null,
      metrics: { unusedCount: unused.length, trackedHours: summary.engagement.trackedHours },
    });
  } else {
    for (const f of unused.slice(0, 3)) {
      out.push({
        id: `cut-unused-${f.featureKey}`,
        kind: 'cut',
        priority: 'medium',
        title: `Consider cutting or burying “${f.label}”`,
        rationale: `Zero foreground hours and ${f.orgs} orgs reached. It still occupies catalog space and mental load.`,
        action: `Remove from the default shell, fold into ${f.area}, or kill the entry point until a workflow needs it.`,
        featureKeys: [f.featureKey],
        area: f.area,
        metrics: { activeHours: 0, orgs: f.orgs },
      });
    }
  }

  // Near-zero adoption among active orgs — not quite unused, but a drag.
  const weak = features.filter((f) => {
    if (CORE_KEYS.has(f.featureKey) || INTERNAL_ONLY_KEYS.has(f.featureKey)) return false;
    if (f.activeHours === 0) return false;
    const orgPenetration = (f.orgs / activeOrgs) * 100;
    return f.sharePct < 2 && orgPenetration < 15;
  });

  for (const f of weak.slice(0, 2)) {
    out.push({
      id: `cut-weak-${f.featureKey}`,
      kind: 'cut',
      priority: 'low',
      title: `“${f.label}” is barely adopted`,
      rationale: `Only ${f.sharePct.toFixed(1)}% of product time and ${f.orgs}/${activeOrgs} active orgs. Maintenance cost likely exceeds learning value.`,
      action:
        'Either promote it inside the workflow where the job actually happens, or demote it from the shell until demand shows up in support tickets.',
      featureKeys: [f.featureKey],
      area: f.area,
      metrics: {
        sharePct: round1(f.sharePct),
        orgs: f.orgs,
        activeOrgs,
        activeHours: round1(f.activeHours),
      },
    });
  }

  return out;
}

function investInsights(
  features: FeatureRow[],
  accounts: AccountRow[] | null,
): ProductInsight[] {
  const out: ProductInsight[] = [];
  const top = [...features]
    .filter((f) => f.activeHours > 0 && !INTERNAL_ONLY_KEYS.has(f.featureKey))
    .sort((a, b) => b.activeHours - a.activeHours)
    .slice(0, 3);

  if (top.length === 0) return out;

  // Paying accounts' favourite tools — invest where revenue already lives.
  const topFeatureCounts = new Map<string, number>();
  for (const a of accounts ?? []) {
    if (!a.topFeature || a.mrrCents <= 0) continue;
    topFeatureCounts.set(a.topFeature, (topFeatureCounts.get(a.topFeature) ?? 0) + 1);
  }

  for (const f of top) {
    const payingFans = [...topFeatureCounts.entries()].find(([label]) =>
      labelMatchesFeature(label, f),
    )?.[1] ?? 0;

    out.push({
      id: `invest-${f.featureKey}`,
      kind: 'invest',
      priority: f.timeRank <= 2 || payingFans >= 2 ? 'high' : 'medium',
      title: `Double down on “${f.label}”`,
      rationale: `Rank #${f.timeRank} by time (${f.sharePct.toFixed(1)}% of all tracked hours, ${f.users} users, ${f.orgs} orgs)${
        payingFans > 0 ? ` · top tool for ${payingFans} paying account${payingFans === 1 ? '' : 's'}` : ''
      }. This is where Atmosphere already feels like work, not a tour.`,
      action:
        'Ship the next sticky loop here first: faster empty states, clearer next action, and a reason to come back tomorrow. Do not bury this behind more navigation.',
      featureKeys: [f.featureKey],
      area: f.area,
      metrics: {
        sharePct: round1(f.sharePct),
        activeHours: round1(f.activeHours),
        users: f.users,
        orgs: f.orgs,
        payingAccountsWithThisTop: payingFans,
        avgSessionMinutes: round1(f.avgSessionMinutes),
      },
    });
  }

  return out;
}

function stickinessInsights(
  features: FeatureRow[],
  accounts: AccountRow[] | null,
  retention: RetentionRow[],
  summary: SummaryPayload,
  areas: AreaUsage[],
): ProductInsight[] {
  const out: ProductInsight[] = [];

  // Early cohort retention (month offset 1).
  const m1 = retention.filter((r) => r.monthOffset === 1 && r.cohortSize >= 3);
  if (m1.length > 0) {
    const avg =
      m1.reduce((sum, r) => sum + (r.retentionPct ?? 0), 0) / m1.length;
    if (avg < 55) {
      out.push({
        id: 'stickiness-m1-retention',
        kind: 'stickiness',
        priority: avg < 35 ? 'high' : 'medium',
        title: 'Month-1 retention is soft',
        rationale: `Average M1 retention across recent cohorts is ${avg.toFixed(0)}%. Users try Atmosphere, then drift — the habit loop is not forming in the first weeks.`,
        action:
          'Pick one “week-one win” (first job logged, first estimate built, or first drying day closed) and make it unavoidable from the dashboard. Kill optional tours until that win happens.',
        featureKeys: ['dashboard', 'onboarding', ...hottestKeys(features, 2)],
        area: 'Platform',
        metrics: { avgM1RetentionPct: round1(avg), cohorts: m1.length },
      });
    }
  }

  // Dashboard dominance = shallow engagement.
  const dashboard = features.find((f) => f.featureKey === 'dashboard');
  if (dashboard && dashboard.sharePct >= 35 && summary.engagement.featuresUsed >= 2) {
    out.push({
      id: 'stickiness-dashboard-trap',
      kind: 'stickiness',
      priority: dashboard.sharePct >= 50 ? 'high' : 'medium',
      title: 'Too much time stops on the dashboard',
      rationale: `The team dashboard is ${dashboard.sharePct.toFixed(0)}% of tracked time. That usually means people land, look around, and never enter the deep tools that create switching costs.`,
      action:
        'Replace vanity tiles with one primary CTA into each org’s busiest workflow (jobs, PM, or estimator). Surface “continue where you left off” instead of another summary card.',
      featureKeys: ['dashboard', ...hottestKeys(features.filter((f) => f.featureKey !== 'dashboard'), 2)],
      area: 'Platform',
      metrics: { dashboardSharePct: round1(dashboard.sharePct) },
    });
  }

  // Short sessions on popular tools = friction / bounce.
  const friction = features.filter(
    (f) =>
      f.activeHours > 0 &&
      f.sessions >= 5 &&
      f.avgSessionMinutes > 0 &&
      f.avgSessionMinutes < 2.5 &&
      f.sharePct >= 3,
  );
  for (const f of friction.slice(0, 2)) {
    out.push({
      id: `stickiness-friction-${f.featureKey}`,
      kind: 'stickiness',
      priority: 'medium',
      title: `“${f.label}” sessions are too short`,
      rationale: `Average session is ${f.avgSessionMinutes.toFixed(1)} minutes across ${f.sessions} visits. People open it, then leave — classic friction or a missing next step.`,
      action:
        'Instrument the first screen for dead-ends: empty states without a CTA, permission walls, or a form that asks for too much before value. Aim for a 5+ minute productive session.',
      featureKeys: [f.featureKey],
      area: f.area,
      metrics: {
        avgSessionMinutes: round1(f.avgSessionMinutes),
        sessions: f.sessions,
        sharePct: round1(f.sharePct),
      },
    });
  }

  // Paying but quiet accounts — expansion / stickiness risk.
  const quietPaying = (accounts ?? []).filter(
    (a) => a.mrrCents > 0 && a.status === 'active' && a.activeHours < 1,
  );
  if (quietPaying.length >= 2) {
    out.push({
      id: 'stickiness-quiet-paying',
      kind: 'stickiness',
      priority: quietPaying.length >= 5 ? 'high' : 'medium',
      title: `${quietPaying.length} paying orgs barely used the product`,
      rationale:
        'They are billed but almost idle this period. That is churn waiting to happen — and a signal the product is not embedded in their daily work.',
      action:
        'Trigger a success playbook: one workflow they already pay for (estimator, web runs, or PM), booked setup, and a weekly digest of unfinished work inside Atmosphere.',
      featureKeys: hottestKeys(features, 3),
      area: null,
      metrics: {
        quietPayingOrgs: quietPaying.length,
        exampleOrgs: quietPaying
          .slice(0, 3)
          .map((a) => a.orgName)
          .join(', '),
      },
    });
  }

  // Single-area monopoly.
  const lead = areas[0];
  if (lead && lead.sharePct >= 65 && areas.length >= 3 && summary.engagement.trackedHours >= 5) {
    out.push({
      id: 'stickiness-area-monopoly',
      kind: 'stickiness',
      priority: 'low',
      title: `Usage is concentrated in ${lead.area}`,
      rationale: `${lead.sharePct.toFixed(0)}% of time sits in one area. Either that is the real product (and the rest should shrink), or adjacent areas are undiscoverable.`,
      action: `If ${lead.area} is the wedge, lead marketing and onboarding with it. If not, add cross-links from its top screens into the next natural job-to-be-done.`,
      featureKeys: features.filter((f) => f.area === lead.area).map((f) => f.featureKey),
      area: lead.area,
      metrics: { areaSharePct: round1(lead.sharePct), areaHours: round1(lead.activeHours) },
    });
  }

  return out;
}

function watchInsights(features: FeatureRow[], summary: SummaryPayload): ProductInsight[] {
  const out: ProductInsight[] = [];
  const used = features.filter((f) => f.activeHours > 0).length;
  const tracked = features.length;

  if (tracked > 0 && used / tracked < 0.35 && summary.engagement.trackedHours >= 5) {
    out.push({
      id: 'watch-sparse-adoption',
      kind: 'watch',
      priority: 'medium',
      title: 'Most of the catalog is idle',
      rationale: `Only ${used} of ${tracked} instrumented tools saw time. Breadth without depth makes Atmosphere feel unfinished and hard to learn.`,
      action:
        'Publish an internal “core loop” of 4–5 tools. Everything else becomes secondary until the core loop has clear retention.',
      featureKeys: features.filter((f) => f.activeHours === 0).map((f) => f.featureKey).slice(0, 8),
      area: null,
      metrics: { featuresUsed: used, featuresTracked: tracked },
    });
  }

  return out;
}

function hottestKeys(features: FeatureRow[], n: number): string[] {
  return [...features]
    .filter((f) => f.activeHours > 0)
    .sort((a, b) => b.activeHours - a.activeHours)
    .slice(0, n)
    .map((f) => f.featureKey);
}

function labelMatchesFeature(topFeatureLabel: string, feature: FeatureRow): boolean {
  const needle = topFeatureLabel.trim().toLowerCase();
  return (
    needle === feature.label.toLowerCase() ||
    needle === feature.featureKey.toLowerCase() ||
    needle.includes(feature.label.toLowerCase())
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
