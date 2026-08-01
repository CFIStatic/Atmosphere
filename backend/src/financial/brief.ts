import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { formatCents, totalCashCents } from './jobCost.js';
import { finishRun, recordUsage, startRun, step } from './ledger.js';
import { loadOrgSnapshot } from './snapshot.js';
import { createBrief, getBrief, listAlerts } from './store.js';
import type { FinanceAlert, FinanceBrief, FinanceSnapshot } from './types.js';

/**
 * CFO morning brief.
 *
 * Facts are computed first. The model (when available) only narrates. Without
 * ANTHROPIC_API_KEY the same facts render through a deterministic template.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = config.financial?.anthropicApiKey || config.pm.anthropicApiKey;
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key });
  return client;
}

export function writingEnabled(): boolean {
  return Boolean(config.financial?.anthropicApiKey || config.pm.anthropicApiKey);
}

export interface BriefFacts {
  forDate: string;
  timezone: string;
  cashCents: number;
  cashFloorCents: number;
  openArCents: number;
  totalCostCents: number;
  jobCount: number;
  criticalAlerts: number;
  warnAlerts: number;
  topAlerts: {
    severity: string;
    title: string;
    detail: string | null;
    suggestedAction: string | null;
  }[];
  thinMarginJobs: {
    title: string;
    jobNumber: number | null;
    marginPct: number | null;
    costCents: number;
    contractCents: number | null;
  }[];
  agedAr: {
    title: string;
    jobNumber: number | null;
    openArCents: number;
    agingDays: number | null;
  }[];
  connections: {
    label: string;
    provider: string;
    status: string;
    accessMode: string;
    lastSyncAt: string | null;
  }[];
}

function localDayKey(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function buildBriefFacts(
  snapshot: FinanceSnapshot,
  alerts: FinanceAlert[],
): BriefFacts {
  const open = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged');
  const topAlerts = [...open]
    .sort((a, b) => {
      const rank = { critical: 0, warn: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity];
    })
    .slice(0, 8)
    .map((a) => ({
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      suggestedAction: a.suggestedAction,
    }));

  const thinMarginJobs = snapshot.rollups
    .filter((r) => r.marginPct !== null && r.marginPct < snapshot.settings.marginFloorPct)
    .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      jobNumber: r.jobNumber,
      marginPct: r.marginPct,
      costCents: r.costCents,
      contractCents: r.contractCents,
    }));

  const agedAr = snapshot.rollups
    .filter((r) => r.openArCents > 0 && (r.agingDays ?? 0) >= snapshot.settings.arWarnDays)
    .sort((a, b) => (b.agingDays ?? 0) - (a.agingDays ?? 0))
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      jobNumber: r.jobNumber,
      openArCents: r.openArCents,
      agingDays: r.agingDays,
    }));

  return {
    forDate: localDayKey(snapshot.now, snapshot.settings.timezone),
    timezone: snapshot.settings.timezone,
    cashCents: totalCashCents(snapshot.accounts),
    cashFloorCents: snapshot.settings.cashFloorCents,
    openArCents: snapshot.rollups.reduce((s, r) => s + r.openArCents, 0),
    totalCostCents: snapshot.rollups.reduce((s, r) => s + r.costCents, 0),
    jobCount: snapshot.jobs.length,
    criticalAlerts: open.filter((a) => a.severity === 'critical').length,
    warnAlerts: open.filter((a) => a.severity === 'warn').length,
    topAlerts,
    thinMarginJobs,
    agedAr,
    connections: snapshot.connections.map((c) => ({
      label: c.label,
      provider: c.provider,
      status: c.status,
      accessMode: c.accessMode,
      lastSyncAt: c.lastSyncAt,
    })),
  };
}

function templateBrief(facts: BriefFacts): { headline: string; body: string } {
  const lines: string[] = [];
  lines.push(`Cash on hand: ${formatCents(facts.cashCents)} (floor ${formatCents(facts.cashFloorCents)}).`);
  lines.push(`Open AR: ${formatCents(facts.openArCents)} across ${facts.jobCount} job(s).`);
  lines.push(`Job cost to date: ${formatCents(facts.totalCostCents)}.`);
  lines.push('');
  lines.push(
    `Alerts: ${facts.criticalAlerts} critical, ${facts.warnAlerts} needing attention.`,
  );

  if (facts.topAlerts.length) {
    lines.push('');
    lines.push('Top items:');
    for (const a of facts.topAlerts) {
      lines.push(`- [${a.severity}] ${a.title}`);
      if (a.suggestedAction) lines.push(`  Next: ${a.suggestedAction}`);
    }
  }

  if (facts.agedAr.length) {
    lines.push('');
    lines.push('Aged receivables:');
    for (const j of facts.agedAr) {
      const label = j.jobNumber != null ? `#${j.jobNumber} ${j.title}` : j.title;
      lines.push(`- ${label}: ${formatCents(j.openArCents)} · ${j.agingDays}d`);
    }
  }

  if (facts.thinMarginJobs.length) {
    lines.push('');
    lines.push('Thin margins:');
    for (const j of facts.thinMarginJobs) {
      const label = j.jobNumber != null ? `#${j.jobNumber} ${j.title}` : j.title;
      lines.push(
        `- ${label}: ${j.marginPct?.toFixed(1)}% · cost ${formatCents(j.costCents)} / contract ${formatCents(j.contractCents)}`,
      );
    }
  }

  if (facts.connections.length) {
    lines.push('');
    lines.push('Connections (read-only observation):');
    for (const c of facts.connections) {
      lines.push(`- ${c.label} (${c.provider}): ${c.status}, mode ${c.accessMode}`);
    }
  }

  const headline =
    facts.criticalAlerts > 0
      ? `${facts.criticalAlerts} critical finance item${facts.criticalAlerts === 1 ? '' : 's'} need you`
      : facts.warnAlerts > 0
        ? `Books are watchful — ${facts.warnAlerts} item${facts.warnAlerts === 1 ? '' : 's'} to review`
        : 'Financial picture is quiet this morning';

  return { headline, body: lines.join('\n') };
}

async function llmBrief(
  facts: BriefFacts,
): Promise<{ headline: string; body: string; modelId: string; inputTokens: number; outputTokens: number } | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const model = config.financial?.model || config.pm.model;
  const response = await anthropic.messages.create({
    model,
    max_tokens: 900,
    system: [
      'You are the CFO desk for a restoration/construction company using Atmosphere.',
      'Write a short morning brief for the CEO, CFO, and accountants.',
      'Only use the facts provided. Do not invent balances, invoices, or bank activity.',
      'Connections are read-only observation — never imply the agent moved money.',
      'Be direct. Lead with cash and risk. End with the three most useful next moves.',
      'Return plain text: first line is a headline (≤120 chars), then a blank line, then the body.',
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: `Facts for ${facts.forDate} (${facts.timezone}):\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  const [first, ...rest] = text.split('\n');
  const headline = (first || 'Morning financial brief').slice(0, 240);
  const body = rest.join('\n').trim() || text;

  return {
    headline,
    body,
    modelId: model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function generateBrief(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  options: { refresh?: boolean } = {},
): Promise<FinanceBrief> {
  const snapshot = await loadOrgSnapshot(supabase, orgId);
  const forDate = localDayKey(snapshot.now, snapshot.settings.timezone);

  if (!options.refresh) {
    const existing = await getBrief(supabase, orgId, forDate);
    if (existing) return existing;
  }

  const alerts = await listAlerts(supabase, orgId, { limit: 100 });
  const facts = buildBriefFacts(snapshot, alerts);

  const run = await startRun(supabase, {
    orgId,
    title: 'CFO morning brief',
    actorType: 'user',
    actorUserId: userId,
    input: { forDate },
  });
  const startedAt = Date.now();

  try {
    await step(supabase, run, {
      type: 'observation',
      action: 'brief_facts',
      detail: `${facts.criticalAlerts} critical, ${facts.warnAlerts} warn, cash ${facts.cashCents}.`,
      payload: facts as unknown as Record<string, unknown>,
    });

    let headline: string;
    let body: string;
    let modelId: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    const written = await llmBrief(facts);
    if (written) {
      headline = written.headline;
      body = written.body;
      modelId = written.modelId;
      inputTokens = written.inputTokens;
      outputTokens = written.outputTokens;
      await recordUsage(supabase, {
        orgId,
        modelId: written.modelId,
        requestId: run.id ?? `finance-brief-${forDate}`,
        inputTokens,
        outputTokens,
        feature: 'financial_brief',
      });
    } else {
      const templated = templateBrief(facts);
      headline = templated.headline;
      body = templated.body;
    }

    const brief = await createBrief(supabase, orgId, {
      forDate,
      kind: 'morning',
      headline,
      body,
      modelId,
      agentRunId: run.id,
      facts: facts as unknown as Record<string, unknown>,
      createdBy: userId,
    });

    await finishRun(supabase, run, {
      status: 'succeeded',
      summary: headline,
      result: { briefId: brief.id, modelId },
      inputTokens,
      outputTokens,
      startedAt,
    });

    return brief;
  } catch (err) {
    await finishRun(supabase, run, {
      status: 'failed',
      error: (err as Error).message,
      startedAt,
    });
    throw err;
  }
}
