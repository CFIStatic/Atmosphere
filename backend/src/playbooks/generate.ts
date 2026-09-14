/**
 * Deterministic playbook generation from completed job analysis findings.
 * No LLM required for v1 — maps workPerformed / scopeVerdicts / concerns
 * into ordered checklist / skill-card steps.
 */

import { normaliseAction } from '../episodes/actions.js';
import type {
  DraftPlaybookStep,
  GeneratedPlaybookDraft,
  ScopeVerdictLine,
} from './types.js';

export type ProofForGenerate = {
  id: string;
  phase?: string | null;
  analysis_status?: string | null;
  ai_summary?: string | null;
  ai_findings?: Record<string, unknown> | null;
  work_date?: string | null;
  captured_at?: string | null;
};

export type JobForGenerate = {
  id: string;
  title?: string | null;
  work_type?: string | null;
};

function asStringList(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > 400) continue;
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function parseScopeVerdicts(value: unknown): ScopeVerdictLine[] {
  if (!Array.isArray(value)) return [];
  const out: ScopeVerdictLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const verdict = typeof row.verdict === 'string' ? row.verdict.trim() : '';
    if (!title) continue;
    const because = typeof row.because === 'string' ? row.because.trim() : undefined;
    out.push({ title, verdict: verdict || 'not_visible', because: because || undefined });
    if (out.length >= 24) break;
  }
  return out;
}

function skillKeyFromText(text: string): string | null {
  const words = text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  for (const word of words) {
    const key = normaliseAction(word);
    if (key) return key;
  }
  // Multi-word phrases common in trades
  const lower = text.toLowerCase();
  if (/\btear[- ]?off\b|\btear[- ]?out\b|\bdemo\b/.test(lower)) return 'remove';
  if (/\bdry[- ]?in\b|\bunderlayment\b|\bfelt\b/.test(lower)) return 'protect';
  if (/\binspect\b|\bwalkaround\b|\bcheck\b/.test(lower)) return 'inspect';
  if (/\bfasten\b|\bnail\b|\bscrew\b|\bstaple\b/.test(lower)) return 'fasten';
  return null;
}

function titleCaseTrade(trade: string | null | undefined): string | null {
  if (!trade) return null;
  const t = trade.trim();
  if (!t) return null;
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferTrade(
  job: JobForGenerate,
  findings: Record<string, unknown>,
  partiesTrade?: string | null,
): string | null {
  if (partiesTrade?.trim()) return partiesTrade.trim().toLowerCase().replace(/\s+/g, '_');
  const scope = asStringList(findings.scopeTouched).join(' ').toLowerCase();
  const work = asStringList(findings.workPerformed).join(' ').toLowerCase();
  const blob = `${scope} ${work} ${job.title ?? ''}`.toLowerCase();
  if (/\broof/.test(blob) || /\bshingle/.test(blob) || /\bdry-?in\b/.test(blob)) return 'roofing';
  if (/\bmitigat|\bwater.?damage|\bdry.?out|\bextract/.test(blob)) return 'mitigation';
  if (job.work_type === 'mitigation') return 'mitigation';
  if (job.work_type === 'construction') return 'construction';
  return null;
}

function buildTitle(opts: {
  trade: string | null;
  workPerformed: string[];
  scopeVerdicts: ScopeVerdictLine[];
  jobTitle: string | null;
}): string {
  const tradeLabel = titleCaseTrade(opts.trade);
  const phrases = [
    ...opts.workPerformed,
    ...opts.scopeVerdicts.map((s) => s.title),
  ].map((p) => p.toLowerCase());

  const hasTearOff = phrases.some((p) => /tear[- ]?off|tear[- ]?out|demo|remove.*shingle/.test(p));
  const hasDryIn = phrases.some((p) => /dry[- ]?in|underlayment|felt|ice.?water/.test(p));

  if (tradeLabel && hasTearOff && hasDryIn) {
    return `${tradeLabel} — tear-off to dry-in`.slice(0, 200);
  }
  if (tradeLabel && hasTearOff) {
    return `${tradeLabel} — tear-off`.slice(0, 200);
  }
  if (tradeLabel && opts.workPerformed[0]) {
    const first = opts.workPerformed[0].replace(/\.$/, '');
    return `${tradeLabel} — ${first}`.slice(0, 200);
  }
  if (opts.scopeVerdicts[0]?.title) {
    const base = tradeLabel ? `${tradeLabel} — ${opts.scopeVerdicts[0].title}` : opts.scopeVerdicts[0].title;
    return base.slice(0, 200);
  }
  const job = (opts.jobTitle ?? '').trim();
  if (job) return `Playbook from ${job}`.slice(0, 200);
  return 'Playbook from job analysis';
}

function stepFromWork(text: string, positionHint: number): DraftPlaybookStep {
  return {
    title: text.slice(0, 200),
    instruction: `Complete: ${text}`.slice(0, 4000),
    skillKey: skillKeyFromText(text),
    evidenceHint: 'Footage should show this work clearly before moving on.',
    metadata: { origin: 'workPerformed', orderHint: positionHint },
  };
}

function stepFromVerdict(line: ScopeVerdictLine, positionHint: number): DraftPlaybookStep {
  const verdictLabel =
    line.verdict === 'appears_complete'
      ? 'Verify complete'
      : line.verdict === 'in_progress'
        ? 'Finish in progress'
        : 'Confirm visible';
  return {
    title: line.title.slice(0, 200),
    instruction: [verdictLabel, line.because].filter(Boolean).join(' — ').slice(0, 4000) || null,
    skillKey: skillKeyFromText(line.title) ?? 'inspect',
    evidenceHint: 'Scope item should be visible in the day film with before/after context when possible.',
    metadata: { origin: 'scopeVerdict', verdict: line.verdict, orderHint: positionHint },
  };
}

function stepFromConcern(text: string, positionHint: number): DraftPlaybookStep {
  return {
    title: `Watch: ${text}`.slice(0, 200),
    instruction: `Address or document this concern: ${text}`.slice(0, 4000),
    skillKey: 'inspect',
    evidenceHint: 'Capture the concern and any corrective work.',
    metadata: { origin: 'concern', orderHint: positionHint },
  };
}

function dedupeSteps(steps: DraftPlaybookStep[]): DraftPlaybookStep[] {
  const seen = new Set<string>();
  const out: DraftPlaybookStep[] = [];
  for (const step of steps) {
    const key = step.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

/** Prefer after-phase / latest analysed proofs; any done analysis is usable. */
export function selectProofsForPlaybook(proofs: ProofForGenerate[]): ProofForGenerate[] {
  const done = proofs.filter(
    (p) =>
      p.analysis_status === 'done' &&
      (Boolean(p.ai_summary?.trim()) ||
        (p.ai_findings && typeof p.ai_findings === 'object' && Object.keys(p.ai_findings).length > 0)),
  );
  if (!done.length) return [];
  const after = done.filter((p) => p.phase === 'after');
  const pool = after.length ? after : done;
  return [...pool].sort((a, b) => {
    const at = a.captured_at ?? a.work_date ?? '';
    const bt = b.captured_at ?? b.work_date ?? '';
    return bt.localeCompare(at);
  });
}

export function mergeFindings(proofs: ProofForGenerate[]): {
  summary: string | null;
  workPerformed: string[];
  scopeTouched: string[];
  scopeVerdicts: ScopeVerdictLine[];
  concerns: string[];
  proofIds: string[];
} {
  const workPerformed: string[] = [];
  const scopeTouched: string[] = [];
  const scopeVerdicts: ScopeVerdictLine[] = [];
  const concerns: string[] = [];
  const summaries: string[] = [];
  const proofIds: string[] = [];

  for (const proof of proofs) {
    proofIds.push(proof.id);
    if (proof.ai_summary?.trim()) summaries.push(proof.ai_summary.trim());
    const findings = proof.ai_findings && typeof proof.ai_findings === 'object' ? proof.ai_findings : {};
    workPerformed.push(...asStringList(findings.workPerformed ?? findings.changes));
    scopeTouched.push(...asStringList(findings.scopeTouched));
    scopeVerdicts.push(...parseScopeVerdicts(findings.scopeVerdicts));
    concerns.push(...asStringList(findings.concerns, 12));
  }

  const uniq = (items: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const k = item.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  return {
    summary: summaries[0] ?? null,
    workPerformed: uniq(workPerformed).slice(0, 24),
    scopeTouched: uniq(scopeTouched).slice(0, 24),
    scopeVerdicts: scopeVerdicts.slice(0, 24),
    concerns: uniq(concerns).slice(0, 12),
    proofIds,
  };
}

/**
 * Build a draft playbook from analysed proofs. Returns null when there is
 * nothing usable to turn into steps.
 */
export function generatePlaybookFromAnalysis(input: {
  job: JobForGenerate;
  proofs: ProofForGenerate[];
  partyTrade?: string | null;
}): GeneratedPlaybookDraft | null {
  const selected = selectProofsForPlaybook(input.proofs);
  if (!selected.length) return null;

  const merged = mergeFindings(selected);
  if (
    !merged.workPerformed.length &&
    !merged.scopeVerdicts.length &&
    !merged.concerns.length &&
    !merged.summary
  ) {
    return null;
  }

  const trade = inferTrade(input.job, {
    workPerformed: merged.workPerformed,
    scopeTouched: merged.scopeTouched,
  }, input.partyTrade);

  const steps = dedupeSteps([
    ...merged.workPerformed.map((w, i) => stepFromWork(w, i)),
    ...merged.scopeVerdicts.map((v, i) => stepFromVerdict(v, 100 + i)),
    ...merged.concerns.map((c, i) => stepFromConcern(c, 200 + i)),
  ]).slice(0, 40);

  // If we only have a summary, still produce one reading step so Save as playbook works.
  if (!steps.length && merged.summary) {
    steps.push({
      title: 'Review completed work',
      instruction: merged.summary.slice(0, 4000),
      skillKey: 'inspect',
      evidenceHint: 'Day film should match this summary.',
      metadata: { origin: 'summary' },
    });
  }

  if (!steps.length) return null;

  const skillTags = [
    ...new Set(steps.map((s) => s.skillKey).filter((k): k is string => Boolean(k))),
  ].slice(0, 12);

  const title = buildTitle({
    trade,
    workPerformed: merged.workPerformed,
    scopeVerdicts: merged.scopeVerdicts,
    jobTitle: input.job.title ?? null,
  });

  return {
    title,
    trade,
    summary: merged.summary,
    sourceKind: 'job_analysis',
    sourceJobId: input.job.id,
    skillTags,
    steps,
    analysisSnapshot: {
      summary: merged.summary,
      workPerformed: merged.workPerformed,
      scopeTouched: merged.scopeTouched,
      scopeVerdicts: merged.scopeVerdicts,
      concerns: merged.concerns,
      proofIds: merged.proofIds,
    },
    proofIds: merged.proofIds,
  };
}
