/**
 * Replayable playbook steps: what to click and type on a site, in order, by
 * accessible role and name (not pixels), with the change each step should
 * cause. Built from a successful run's trace or a person's demonstration.
 *
 * Privacy rules (same as #662 site playbooks): a typed step stores a slot
 * name such as "task.query" or "job.claimNumber", never the value. A control
 * whose label carries job data, an email, a money figure or other personal
 * text becomes an "explore" step with no label, so the model or the person
 * handles it at run time. Every step list passes assertNoPii before storage.
 */
import { assertNoPii, scrubText, scrubUrl } from '../sitePlaybooks.js';
import type { ProjectedJobField, RecordedAction } from '../types.js';
import type { ConsequentialKind } from '../types.js';

export interface StepTarget {
  role: string | null;
  name: string | null;
  tag: string | null;
}

export interface StepExpect {
  /** The URL path should contain this after the step (a path prefix, never a query). */
  urlIncludes?: string;
  /** This text should be visible after the step. */
  textIncludes?: string;
}

export type PlaybookStep =
  | { kind: 'navigate'; url: string; expect?: StepExpect }
  | { kind: 'click'; target: StepTarget; expect?: StepExpect; consequential?: ConsequentialKind | null }
  | { kind: 'type'; target: StepTarget; slot: string; expect?: StepExpect }
  | { kind: 'press'; key: 'Enter'; target?: StepTarget | null; expect?: StepExpect }
  | { kind: 'explore'; note: string };

export const MAX_PLAYBOOK_STEPS = 40;

/** One action the agent (or replay) actually performed and saw take effect. */
export interface TraceEntry {
  kind: 'click' | 'type' | 'press' | 'navigate';
  target?: StepTarget | null;
  /** Typed text, in memory only, used to pick a slot. Never stored. */
  value?: string | null;
  url?: string | null;
  urlBefore?: string | null;
  urlAfter?: string | null;
  consequential?: ConsequentialKind | null;
}

export interface SlotContext {
  projection: ProjectedJobField[];
  /** Named task inputs (practice catalog params, or values the model passes to use_playbook). */
  params: Record<string, string>;
  instructions: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Which slot a typed value came from. "person" means nobody can fill it automatically. */
export function slotFor(value: string, ctx: SlotContext): string {
  const v = norm(value);
  if (!v) return 'person';
  for (const [k, pv] of Object.entries(ctx.params)) if (norm(pv) === v) return `task.${k}`;
  for (const f of ctx.projection) if (norm(f.value) === v) return `job.${f.key}`;
  return 'person';
}

/** Fill a slot at replay time; null when the value is not known. */
export function valueForSlot(slot: string, ctx: SlotContext): string | null {
  if (slot.startsWith('task.')) return ctx.params[slot.slice(5)] ?? null;
  if (slot.startsWith('job.')) return ctx.projection.find((f) => f.key === slot.slice(4))?.value ?? null;
  return null;
}

/** First path segment of a URL as a stable "you landed here" check ("/s/", "/cart"). */
export function pathPrefix(url: string | null | undefined): string | undefined {
  const scrubbed = scrubUrl(url ?? null);
  if (!scrubbed) return undefined;
  try {
    const seg = new URL(scrubbed).pathname.split('/').filter(Boolean)[0];
    return seg && !seg.startsWith(':') ? `/${seg}` : undefined;
  } catch {
    return undefined;
  }
}

function cleanLabel(name: string | null | undefined): string | null {
  const s = scrubText(String(name ?? '').replace(/\s+/g, ' ').trim()).slice(0, 80);
  return s || null;
}

/** A label that carries a job value, a task value, an email, a figure or other personal text. */
function labelCarriesData(label: string, ctx: SlotContext): boolean {
  const l = norm(label);
  if (/\[(?:email|amount|id)\]/.test(label)) return true;
  const values = [...Object.values(ctx.params), ...ctx.projection.map((f) => f.value)].map(norm).filter((v) => v.length >= 3);
  if (values.some((v) => l.includes(v))) return true;
  try {
    assertNoPii(label);
  } catch {
    return true;
  }
  return false;
}

function safeTarget(t: StepTarget | null | undefined, ctx: SlotContext): StepTarget | null {
  if (!t) return null;
  const name = cleanLabel(t.name);
  if (!name || labelCarriesData(name, ctx)) return null;
  return { role: t.role ? String(t.role).slice(0, 30) : null, name, tag: t.tag ? String(t.tag).slice(0, 20) : null };
}

const WITHHELD = 'Find the right item on this screen (its label is not saved for privacy).';

/** Final scrub and PII check; a step that still fails becomes an explore step. */
export function sanitizeSteps(steps: PlaybookStep[]): PlaybookStep[] {
  const out: PlaybookStep[] = [];
  for (const step of steps.slice(0, MAX_PLAYBOOK_STEPS)) {
    try {
      assertNoPii(step);
      out.push(step);
    } catch {
      out.push({ kind: 'explore', note: WITHHELD });
    }
  }
  // Collapse runs of explore steps.
  return out.filter((s, i) => !(s.kind === 'explore' && out[i - 1]?.kind === 'explore'));
}

/** Steps from the actions a successful run actually performed (failed or unverified actions are not in the trace). */
export function stepsFromTrace(trace: TraceEntry[], ctx: SlotContext): PlaybookStep[] {
  const steps: PlaybookStep[] = [];
  for (const e of trace) {
    const moved = e.urlAfter && e.urlBefore && scrubUrl(e.urlAfter) !== scrubUrl(e.urlBefore) ? pathPrefix(e.urlAfter) : undefined;
    const expect: StepExpect | undefined = moved ? { urlIncludes: moved } : undefined;
    if (e.kind === 'navigate') {
      const url = scrubUrl(e.url ?? null);
      if (url) steps.push({ kind: 'navigate', url, ...(pathPrefix(e.url) ? { expect: { urlIncludes: pathPrefix(e.url) } } : {}) });
      continue;
    }
    const target = safeTarget(e.target, ctx);
    if (e.kind === 'click') {
      if (!target) {
        steps.push({ kind: 'explore', note: WITHHELD });
        continue;
      }
      const prev = steps[steps.length - 1];
      // Clicking into a field right before typing in it is implied by the type step.
      if (prev?.kind === 'click' && prev.target.name === target.name && prev.target.role === target.role && !prev.expect) steps.pop();
      steps.push({ kind: 'click', target, ...(expect ? { expect } : {}), ...(e.consequential ? { consequential: e.consequential } : {}) });
      continue;
    }
    if (e.kind === 'type') {
      const slot = slotFor(String(e.value ?? ''), ctx);
      if (!target) {
        steps.push({ kind: 'explore', note: 'Fill in the field the task needs on this screen.' });
        continue;
      }
      const prev = steps[steps.length - 1];
      if (prev?.kind === 'click' && prev.target.name === target.name && !prev.expect) steps.pop();
      if (prev?.kind === 'type' && prev.target.name === target.name) steps.pop();
      steps.push({ kind: 'type', target, slot });
      continue;
    }
    if (e.kind === 'press') {
      steps.push({ kind: 'press', key: 'Enter', target, ...(expect ? { expect } : {}) });
    }
  }
  return sanitizeSteps(steps);
}

/**
 * Steps from what a person did in Take control. Navigation that followed a
 * click is implied by that click; a typed value maps to a slot and is dropped;
 * sign-in is never recorded beyond "sign in here".
 */
export function stepsFromRecording(actions: RecordedAction[], ctx: SlotContext): PlaybookStep[] {
  const trace: TraceEntry[] = [];
  let lastUrl: string | null = null;
  const steps: PlaybookStep[] = [];
  const flush = () => {
    if (trace.length) steps.push(...stepsFromTrace(trace.splice(0), ctx));
  };
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    const prev = actions[i - 1];
    if (a.kind === 'sign_in') {
      flush();
      if (steps[steps.length - 1]?.kind !== 'explore') steps.push({ kind: 'explore', note: 'Sign in here with the saved Login, or the person signs in. Nothing typed here is recorded.' });
      continue;
    }
    if (a.kind === 'navigate') {
      const causedByAction = prev && prev.kind !== 'navigate' && a.at - prev.at < 5_000;
      if (causedByAction) {
        const last = trace[trace.length - 1];
        if (last && !last.urlAfter) {
          last.urlBefore = lastUrl;
          last.urlAfter = a.url ?? null;
        }
      } else if (a.url && a.url !== lastUrl) {
        trace.push({ kind: 'navigate', url: a.url });
      }
      lastUrl = a.url ?? lastUrl;
      continue;
    }
    const target = { role: a.role ?? null, name: a.name ?? null, tag: a.tag ?? null };
    if (a.kind === 'click') trace.push({ kind: 'click', target });
    else if (a.kind === 'type') trace.push({ kind: 'type', target, value: a.value ?? '' });
    else if (a.kind === 'press') trace.push({ kind: 'press', target: a.name ? target : null });
  }
  flush();
  return sanitizeSteps(steps);
}

/** Same steps (ignoring expectations) means the playbook was confirmed, not changed. */
export function sameSteps(a: PlaybookStep[], b: PlaybookStep[]): boolean {
  const key = (s: PlaybookStep) => {
    switch (s.kind) {
      case 'navigate':
        return `n:${s.url}`;
      case 'click':
        return `c:${s.target.role}:${s.target.name}`;
      case 'type':
        return `t:${s.target.name}:${s.slot}`;
      case 'press':
        return `p:${s.target?.name ?? ''}`;
      default:
        return 'e';
    }
  };
  return a.length === b.length && a.every((s, i) => key(s) === key(b[i]));
}

/** One line per step, for the model's prompt and the review screen. */
export function describeStep(s: PlaybookStep): string {
  const t = (x: StepTarget | null | undefined) => (x?.name ? `“${x.name}”${x.role && x.role !== 'generic' ? ` (${x.role})` : ''}` : 'the field');
  switch (s.kind) {
    case 'navigate':
      return `Open ${s.url}`;
    case 'click':
      return `${s.consequential ? 'Approval needed: ' : ''}Click ${t(s.target)}${s.expect?.urlIncludes ? `, then expect ${s.expect.urlIncludes}` : ''}`;
    case 'type':
      return `Type ${s.slot === 'person' ? 'the value the task needs' : s.slot} into ${t(s.target)}`;
    case 'press':
      return `Press Enter${s.target ? ` in ${t(s.target)}` : ''}`;
    default:
      return s.note;
  }
}

/** Parse untrusted JSON (from the database) into steps; drops anything malformed. */
export function parseSteps(raw: unknown): PlaybookStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaybookStep[] = [];
  const tgt = (x: unknown): StepTarget | null => {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.slice(0, 120) : null;
    return name ? { role: typeof o.role === 'string' ? o.role : null, name, tag: typeof o.tag === 'string' ? o.tag : null } : null;
  };
  const exp = (x: unknown): StepExpect | undefined => {
    if (!x || typeof x !== 'object') return undefined;
    const o = x as Record<string, unknown>;
    const e: StepExpect = {};
    if (typeof o.urlIncludes === 'string') e.urlIncludes = o.urlIncludes.slice(0, 200);
    if (typeof o.textIncludes === 'string') e.textIncludes = o.textIncludes.slice(0, 200);
    return Object.keys(e).length ? e : undefined;
  };
  for (const r of raw.slice(0, MAX_PLAYBOOK_STEPS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const expect = exp(o.expect);
    if (o.kind === 'navigate' && typeof o.url === 'string' && /^https?:\/\//.test(o.url)) out.push({ kind: 'navigate', url: o.url, ...(expect ? { expect } : {}) });
    else if (o.kind === 'click' && tgt(o.target)) out.push({ kind: 'click', target: tgt(o.target)!, ...(expect ? { expect } : {}), ...(typeof o.consequential === 'string' ? { consequential: o.consequential as ConsequentialKind } : {}) });
    else if (o.kind === 'type' && tgt(o.target) && typeof o.slot === 'string') out.push({ kind: 'type', target: tgt(o.target)!, slot: o.slot.slice(0, 60), ...(expect ? { expect } : {}) });
    else if (o.kind === 'press') out.push({ kind: 'press', key: 'Enter', target: tgt(o.target), ...(expect ? { expect } : {}) });
    else if (o.kind === 'explore' && typeof o.note === 'string') out.push({ kind: 'explore', note: o.note.slice(0, 200) });
  }
  return out;
}
