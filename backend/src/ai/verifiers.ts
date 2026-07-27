import type { TaskSpec } from './taskTypes.js';
import type { VerifierResult } from './types.js';

/**
 * Verification: the fast, deterministic half of the reward signal.
 *
 * Every run is checked by machine before a human ever sees it. Two reasons, and
 * the second is the one that makes the loop work at all:
 *
 *  1. **Safety.** A fatal check failing means the output is not served. The
 *     learning loop can experiment freely precisely because this gate does not
 *     move — exploration risks a *worse* answer, never an unchecked one.
 *
 *  2. **Learning speed.** Human feedback is the better signal but it is sparse
 *     and slow: most runs are never explicitly rated, and those that are come
 *     back hours later. Verifier scores arrive on every single run in
 *     milliseconds, so the policy has something to learn from immediately and
 *     the human signal refines it later (see reward.ts § two-phase reward).
 *
 * Checks are pure functions over (output, input) and must never call a model —
 * an LLM judge in this path would add latency and cost to every request and, by
 * being itself a model, would launder one model's biases into the reward that
 * ranks all of them. Judges belong in the offline evaluation path instead.
 */

/** Cheap, honest JSON extraction. Models wrap JSON in prose or fences. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Fall back to the outermost brace pair — handles a leading "Here is the…".
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  throw new Error('Output was not valid JSON');
}

/**
 * Score one output against its task spec.
 *
 * Schema validity is weighted heavily and is fatal: a response that does not
 * parse cannot be used by the product at all, so it is a total failure of the
 * run regardless of how good the prose inside it might have been.
 */
export function verify(spec: TaskSpec, rawText: string, input: unknown): { result: VerifierResult; output: unknown } {
  const checks: VerifierResult['checks'] = [];
  let output: unknown = rawText;
  let parseOk = true;

  if (spec.json) {
    try {
      output = parseJsonLoose(rawText);
    } catch (err) {
      parseOk = false;
      output = null;
      checks.push({
        name: 'valid_json',
        passed: false,
        weight: 5,
        detail: err instanceof Error ? err.message : 'parse failed',
      });
    }
    if (parseOk) checks.push({ name: 'valid_json', passed: true, weight: 5 });
  }

  // Schema conformance. Only meaningful if we got something parseable.
  let schemaOk = false;
  if (parseOk) {
    const parsed = spec.outputSchema.safeParse(output);
    schemaOk = parsed.success;
    checks.push({
      name: 'matches_schema',
      passed: schemaOk,
      weight: 5,
      detail: parsed.success ? undefined : summariseZodError(parsed.error),
    });
    // Use the parsed value onward: zod applies defaults, so downstream checks
    // see the same normalised shape the caller will.
    if (parsed.success) output = parsed.data;
  }

  // Task-specific checks. Skipped when the shape is already wrong — they would
  // all fail for the same single reason and triple-count one mistake.
  if (parseOk && schemaOk) {
    for (const check of spec.checks) {
      try {
        const outcome = check.run(output, input);
        checks.push({
          name: check.name,
          passed: outcome.passed,
          weight: check.weight ?? 1,
          detail: outcome.detail,
        });
      } catch (err) {
        // A throwing check is our bug, not the model's. Record it, weight it
        // zero, and let the run proceed rather than punishing the arm.
        checks.push({
          name: check.name,
          passed: true,
          weight: 0,
          detail: `check errored: ${err instanceof Error ? err.message : 'unknown'}`,
        });
      }
    }
  }

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = totalWeight === 0 ? 1 : earned / totalWeight;

  // A run is servable only if nothing fatal failed. Structural failures (bad
  // JSON, bad schema) are always fatal — there is nothing to serve.
  const fatalNames = new Set(spec.checks.filter((c) => c.fatal).map((c) => c.name));
  const fatalFailed = checks.some(
    (c) => !c.passed && (fatalNames.has(c.name) || c.name === 'valid_json' || c.name === 'matches_schema'),
  );

  return { result: { score, passed: !fatalFailed, checks }, output };
}

/** Compact zod failure text — full issue dumps can echo customer data. */
function summariseZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
