import { decorateInstruction, type TaskSpec } from './taskTypes.js';
import type { ChatMessage } from './providers/types.js';
import type { ExemplarRow } from './store.js';

/**
 * Prompt assembly.
 *
 * A prompt is built from three layers, and keeping them separate is what makes
 * the results attributable:
 *
 *   1. the task's **instruction** — fixed, written by us;
 *   2. the arm's **variant decoration** — the axis the policy explores;
 *   3. the org's **exemplars** — mined from work this organization accepted.
 *
 * Layer 3 is the quiet workhorse. Global stats can only ever learn which model
 * is better *on average across every customer*. Exemplars are how the platform
 * learns that this particular company always itemises drywall by linear foot,
 * or never promises a completion date — knowledge that is real, valuable, and
 * belongs to exactly one org. No fine-tuning, no weights, and it takes effect
 * on the very next run after a human accepts an output.
 */

export interface BuiltPrompt {
  system: string;
  messages: ChatMessage[];
}

export function buildPrompt(
  spec: TaskSpec,
  promptVariant: string,
  input: unknown,
  exemplars: ExemplarRow[],
): BuiltPrompt {
  const sections = [decorateInstruction(spec.instruction, promptVariant)];

  if (spec.json) {
    sections.push(
      'Respond with a single JSON object and nothing else. No markdown fences, ' +
        'no commentary before or after.',
    );
  }

  if (exemplars.length > 0) {
    sections.push(
      'Below are past outputs from this organization that their team accepted. ' +
        'Match their level of detail, terminology and house style. Do not copy their ' +
        'content — only their form.',
    );
  }

  const messages: ChatMessage[] = [];

  // Exemplars go in as real conversational turns rather than pasted into the
  // system prompt: every provider we target is trained to imitate the shape of
  // prior assistant turns, so this generalises across all five without any
  // vendor-specific formatting.
  for (const exemplar of exemplars) {
    messages.push({ role: 'user', content: renderInput(exemplar.input_payload) });
    messages.push({ role: 'assistant', content: exemplar.output_text });
  }

  messages.push({ role: 'user', content: renderInput(input) });

  return { system: sections.join('\n\n'), messages };
}

function renderInput(input: unknown): string {
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
}
