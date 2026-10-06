/**
 * Playbook replay: follow a saved playbook's steps without a model call.
 *
 * Each step finds its element through the DOM / accessibility outline (role +
 * accessible name, not pixels), passes the same approval gate as the agent,
 * acts, and verifies the change. Cookie banners and promo pop-ups are cleared
 * before each step; a missing element gets a retry and an alternate match
 * (name without role). A consequential control (submit, send, pay, save,
 * accept) is never clicked here: replay stops in front of it so the agent can
 * ask for approval, or a practice run can record "stopped before submit".
 */
import { classifyClick, classifyKey, classifyType } from '../gate.js';
import { siteOf } from '../sites.js';
import type { ComputerDriver, ConsequentialKind, ElementTarget, LocatedElement } from '../types.js';
import { describeStep, valueForSlot, type PlaybookStep, type SlotContext, type StepTarget, type TraceEntry } from './playbookSteps.js';
import { fingerprint, waitForChange, waitForExpectation } from './verify.js';

export interface ReplayDeps {
  driver: ComputerDriver;
  sleep(ms: number): Promise<void>;
  audit(event: string, detail?: Record<string, unknown>): Promise<unknown>;
  /** Called after each completed step (practice runs keep a screenshot). */
  onStep?(index: number, label: string): Promise<void>;
}

export interface ReplayInput {
  steps: PlaybookStep[];
  slots: SlotContext;
  /** Sites the task may open (empty = any). */
  sites: Set<string>;
}

export interface ReplayStepLog {
  index: number;
  label: string;
  ok: boolean;
  note?: string;
}

export interface ReplayResult {
  status: 'completed' | 'stopped_at_consequential' | 'needs_model' | 'failed';
  done: number;
  failedStep: number | null;
  reason: string | null;
  stoppedAt: { kind: ConsequentialKind; label: string } | null;
  log: ReplayStepLog[];
  /** What replay actually did, in the same shape as an agent trace (for re-capture). */
  trace: TraceEntry[];
}

const STEP_RETRIES = 2;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function clearOverlays(deps: ReplayDeps): Promise<void> {
  if (!deps.driver.dismissOverlays) return;
  const closed = await deps.driver.dismissOverlays().catch(() => []);
  for (const o of closed) await deps.audit('overlay_dismissed', { kind: o.kind, label: o.label.slice(0, 60) });
}

/** Find the element: exact role + name, then name only (layout changed), with overlay clearing between tries. */
async function find(deps: ReplayDeps, target: StepTarget): Promise<LocatedElement | null> {
  if (!deps.driver.locate) return null;
  const attempts: ElementTarget[] = [
    { role: target.role, name: target.name, tag: target.tag },
    { role: null, name: target.name, tag: null },
  ];
  for (let round = 0; round <= STEP_RETRIES; round += 1) {
    for (const a of attempts) {
      const hit = await deps.driver.locate(a).catch(() => null);
      if (hit) return hit;
    }
    await clearOverlays(deps);
    await deps.sleep(800);
  }
  return null;
}

export async function replayPlaybook(deps: ReplayDeps, input: ReplayInput): Promise<ReplayResult> {
  const { driver } = deps;
  const log: ReplayStepLog[] = [];
  const trace: TraceEntry[] = [];
  const result = (
    status: ReplayResult['status'],
    extra: Partial<Pick<ReplayResult, 'failedStep' | 'reason' | 'stoppedAt'>> = {},
  ): ReplayResult => ({
    status,
    done: log.filter((l) => l.ok).length,
    failedStep: extra.failedStep ?? null,
    reason: extra.reason ?? null,
    stoppedAt: extra.stoppedAt ?? null,
    log,
    trace,
  });

  if (!driver.locate || !driver.pageFingerprint) {
    return result('needs_model', { reason: 'This browser cannot read the page structure, so the playbook cannot be replayed.' });
  }

  for (let i = 0; i < input.steps.length; i += 1) {
    const step = input.steps[i];
    const label = describeStep(step);
    const fail = (reason: string) => {
      log.push({ index: i, label, ok: false, note: reason });
      return result('failed', { failedStep: i, reason });
    };
    await clearOverlays(deps);

    if (step.kind === 'explore') {
      log.push({ index: i, label, ok: false, note: 'Handed to the model for this part.' });
      return result('needs_model', { failedStep: i, reason: step.note });
    }

    if (step.kind === 'navigate') {
      const host = hostOf(step.url);
      if (!host || (input.sites.size > 0 && !input.sites.has(siteOf(host)))) return fail('The playbook opens a site this task does not name.');
      let opened = false;
      for (let attempt = 0; attempt <= STEP_RETRIES && !opened; attempt += 1) {
        try {
          await driver.navigate(step.url);
          opened = true;
        } catch {
          await deps.sleep(1_500 * (attempt + 1));
        }
      }
      if (!opened) return fail('The page did not load after retries.');
      const unmet = await waitForExpectation(driver, step.expect, deps.sleep);
      if (unmet) return fail(`Opened the page but ${unmet}.`);
      trace.push({ kind: 'navigate', url: step.url });
      await deps.audit('navigate', { host, via: 'playbook' });
      log.push({ index: i, label, ok: true });
      await deps.onStep?.(i, label);
      continue;
    }

    if (step.kind === 'click' || step.kind === 'type') {
      let value: string | null = null;
      if (step.kind === 'type') {
        value = valueForSlot(step.slot, input.slots);
        if (value == null) {
          log.push({ index: i, label, ok: false, note: 'The value for this field is not known to the playbook.' });
          return result('needs_model', { failedStep: i, reason: `Needs a value for ${step.slot === 'person' ? 'a field' : step.slot}.` });
        }
      }
      let done = false;
      let lastReason = 'The element was not found on the page.';
      for (let attempt = 0; attempt <= STEP_RETRIES && !done; attempt += 1) {
        const el = await find(deps, step.target);
        if (!el) {
          lastReason = `Could not find “${step.target.name}” on the page (the layout may have changed).`;
          break;
        }
        const desc = await driver.describeTarget(el.x, el.y);
        const decision = classifyClick(desc);
        if (decision.type === 'consequential') {
          log.push({ index: i, label, ok: true, note: `Stopped before “${decision.label}” (needs approval).` });
          await deps.audit('playbook_stopped_at_approval', { kind: decision.kind, label: decision.label.slice(0, 80) });
          return result('stopped_at_consequential', { stoppedAt: { kind: decision.kind, label: decision.label } });
        }
        if (decision.type !== 'allow') return fail('The page needs a person here (sign-in, code or captcha).');
        const urlBefore = await driver.currentUrl().catch(() => null);
        const before = await fingerprint(driver);
        await driver.click(el.x, el.y);
        if (step.kind === 'type') {
          const focused = await driver.focusedElement();
          const gate = classifyType(value!, focused);
          if (gate.type !== 'allow') return fail('The field is a password, code or submit-type field, so it is left to a person.');
          await driver.key('ctrl+a');
          await driver.type(value!);
        }
        const { changed } = await waitForChange(driver, before, deps.sleep);
        const unmet = await waitForExpectation(driver, step.expect, deps.sleep, changed ? 6_000 : 1_500);
        if (changed && !unmet) {
          done = true;
          const urlAfter = await driver.currentUrl().catch(() => null);
          const target = { role: el.role, name: el.name, tag: el.tag };
          trace.push(step.kind === 'type' ? { kind: 'type', target, value } : { kind: 'click', target, urlBefore, urlAfter });
          await deps.audit('action', { action: step.kind === 'type' ? 'type' : 'left_click', via: 'playbook', target: { tag: el.tag, label: el.name.slice(0, 80) }, ...(step.kind === 'type' ? { chars: value!.length } : {}) });
        } else {
          lastReason = unmet ? `Clicked “${el.name}” but ${unmet}.` : `Clicked “${el.name}” but nothing on the page changed.`;
          await clearOverlays(deps);
          await deps.sleep(700);
        }
      }
      if (!done) return fail(lastReason);
      log.push({ index: i, label, ok: true });
      await deps.onStep?.(i, label);
      continue;
    }

    if (step.kind === 'press') {
      if (step.target) {
        const el = await find(deps, step.target);
        if (el) await driver.click(el.x, el.y);
      }
      const focused = await driver.focusedElement();
      const decision = classifyKey('Return', focused);
      if (decision.type === 'consequential') {
        log.push({ index: i, label, ok: true, note: `Stopped before ${decision.label} (needs approval).` });
        await deps.audit('playbook_stopped_at_approval', { kind: decision.kind, label: decision.label.slice(0, 80) });
        return result('stopped_at_consequential', { stoppedAt: { kind: decision.kind, label: decision.label } });
      }
      if (decision.type !== 'allow') return fail('The page needs a person here.');
      const before = await fingerprint(driver);
      await driver.key('Return');
      const { changed } = await waitForChange(driver, before, deps.sleep);
      const unmet = await waitForExpectation(driver, step.expect, deps.sleep, changed ? 6_000 : 1_500);
      if (!changed || unmet) return fail(unmet ? `Pressed Enter but ${unmet}.` : 'Pressed Enter but nothing changed.');
      trace.push({ kind: 'press', target: focused ? { role: null, name: focused.label, tag: focused.tag } : null });
      log.push({ index: i, label, ok: true });
      await deps.onStep?.(i, label);
    }
  }
  return result('completed');
}

/** Short summary of a playbook for the model's prompt. */
export function playbookBrief(steps: PlaybookStep[], max = 15): string {
  return steps
    .slice(0, max)
    .map((s, i) => `${i + 1}. ${describeStep(s)}`)
    .join('\n');
}
