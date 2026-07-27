import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import type { Expectation, ExpectationKind } from './verifierTypes.js';

/**
 * Turns a task into a list of things that can be checked against the site.
 *
 * This module is where the verifier earns the name. The expectations for a
 * data-entry run are derived from the ORIGINAL instruction and the data the
 * user supplied — never from the first agent's summary, its step trace, or its
 * claim of success. That exclusion is the entire guarantee: an agent that is
 * allowed to describe what it did is an agent that gets to define what
 * "correct" means, and checking its work against its own account of its work
 * confirms nothing at all.
 *
 * The exception is a data pull, and it is a real exception rather than a leak.
 * For a pull, the reported rows ARE the claim under test — "the site says
 * these eleven invoices exist" is the thing a human would want confirmed — so
 * they are supplied deliberately, as the assertion to check, not as guidance
 * about where to look.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Keeps a pathological input_data payload from dominating the prompt. */
const MAX_DATA_CHARS = 8000;
/** More than this and a verification pass costs more than the run it checks. */
const MAX_EXPECTATIONS = 12;

export interface ExpectationSource {
  kind: 'pull' | 'push';
  instruction: string;
  /** The rows the user asked to have entered. Push only. */
  inputData?: unknown;
  siteLabel: string;
  /**
   * The rows the first agent reported reading. Supplied for a pull, where they
   * are the claim being tested. Ignored outright for a push — see above.
   */
  reportedRecords?: unknown[];
}

const EXPECTATION_TOOL: Anthropic.Tool = {
  name: 'record_expectations',
  description: 'Record the checkable expectations derived from the task.',
  input_schema: {
    type: 'object',
    properties: {
      expectations: {
        type: 'array',
        description:
          'The things that must be true on the site if the task was carried out. Empty if the task states nothing that can be checked by looking.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: [
                'record_exists',
                'field_value',
                'record_absent',
                'state_change',
                'reported_data_matches',
              ],
              description: 'What sort of claim this makes about the site.',
            },
            description: {
              type: 'string',
              description:
                'One plain sentence a person could verify by hand, naming the concrete values.',
            },
            where: {
              type: 'string',
              description:
                "Where to look, in the site's own vocabulary — a section, list, or screen name. Not a URL.",
            },
            identifiers: {
              type: 'object',
              description:
                'The field values that locate the record: a claim number, an invoice number, a date, a name.',
              additionalProperties: { type: 'string' },
            },
            expected: {
              type: 'object',
              description: 'The field values that must hold once the record is located.',
              additionalProperties: { type: 'string' },
            },
            critical: {
              type: 'boolean',
              description:
                'True if the task plainly fails without this. False for incidental detail the instruction mentioned in passing.',
            },
          },
          required: ['kind', 'description', 'where', 'identifiers', 'expected', 'critical'],
        },
      },
    },
    required: ['expectations'],
  },
};

const PUSH_SYSTEM = [
  'You prepare the checklist a second person will use to confirm that a data-entry task was really carried out on a website.',
  '',
  'You are given the task exactly as the user wrote it, and the data they supplied. You are NOT given any account of what was done, and you must not assume the work succeeded — you are describing what the site must look like IF it succeeded.',
  '',
  'Write each expectation so it can be settled by looking at the site:',
  '- Name concrete values. "An invoice for $1,240.00 dated 20 July 2026 against claim 88213" is checkable; "the invoice was entered correctly" is not.',
  '- Put the values that FIND the record in identifiers, and the values that must be RIGHT once found in expected.',
  '- Prefer few strong expectations over many weak ones. One per record the task asked to be entered is usually right.',
  '- Mark critical false only for detail the task mentioned incidentally, where a mismatch would not mean the task failed.',
  '',
  'If the instruction is too vague to yield anything checkable, return an empty list rather than inventing criteria. An honest "nothing here can be verified by looking" is useful; a fabricated checklist is worse than none, because it will be reported as a real failure.',
].join('\n');

const PULL_SYSTEM = [
  'You prepare the checklist a second person will use to confirm that data read out of a website was reported accurately.',
  '',
  'You are given the task as the user wrote it and the rows that were reported back. The rows are the CLAIM being tested: your job is to write expectations that check whether the site really shows them.',
  '',
  'Write each expectation so it can be settled by looking at the site:',
  '- Use kind "reported_data_matches" for rows that should appear on the site as reported.',
  '- Put the values that locate each row in identifiers, and the reported values that must match in expected.',
  '- Group sensibly. Checking a handful of representative rows against the site beats one expectation per row when many were returned; say in the description which rows a grouped expectation covers.',
  '- Also check the shape of the answer where the task specified one — a date range asked for, a filter applied.',
  '',
  'If nothing was reported, write one expectation checking that the site genuinely has nothing matching the request, rather than assuming the run simply missed it.',
].join('\n');

/** Serialises supplied data for the prompt without letting it run away. */
function describeData(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_DATA_CHARS
    ? `${text.slice(0, MAX_DATA_CHARS)}\n… (truncated; ${text.length} characters in total)`
    : text;
}

function coerceStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined) continue;
    out[key] = typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  return out;
}

const VALID_KINDS: readonly ExpectationKind[] = [
  'record_exists',
  'field_value',
  'record_absent',
  'state_change',
  'reported_data_matches',
];

/**
 * Derives the expectations for a run.
 *
 * Returns an empty list when the task states nothing checkable. The caller
 * treats that as "not verifiable" rather than "verified" — a run nobody can
 * check must not be reported as confirmed.
 */
export interface DerivedChecklist {
  expectations: Expectation[];
  /**
   * True when the task produced more checkable claims than one pass may carry.
   *
   * Surfaced rather than swallowed: a run whose checklist was cut short can be
   * "all clear" on everything actually looked at while the items that were
   * dropped are the ones that failed. Reporting that as verified is the exact
   * false assurance this subsystem exists to prevent, so the caller says so.
   */
  truncated: boolean;
}

export async function deriveExpectations(source: ExpectationSource): Promise<DerivedChecklist> {
  if (!config.webAccess.anthropicApiKey) {
    throw new HttpError(503, 'The verifier is not configured on this server.', 'verifier_unconfigured');
  }

  const client = new Anthropic({ apiKey: config.webAccess.anthropicApiKey });
  const isPush = source.kind === 'push';

  const parts = [
    `Site: ${source.siteLabel}`,
    `Task as the user wrote it:\n${source.instruction}`,
  ];

  if (isPush) {
    const data = describeData(source.inputData);
    if (data) parts.push(`Data the user supplied to enter:\n${data}`);
  } else {
    // Pull only. For a push this branch is unreachable, which is what keeps the
    // first agent's account of its own work out of the checklist entirely.
    const reported = describeData(source.reportedRecords ?? []);
    parts.push(`Rows that were reported back (the claim to test):\n${reported}`);
  }

  const response = await client.messages.create({
    model: config.verifier.model,
    max_tokens: 8000,
    system: isPush ? PUSH_SYSTEM : PULL_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.verifier.effort },
    tools: [EXPECTATION_TOOL],
    tool_choice: { type: 'tool', name: 'record_expectations' },
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  if (response.stop_reason === 'refusal') {
    throw new HttpError(
      502,
      'The verifier declined to prepare a checklist for this task.',
      'verifier_refused',
    );
  }

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'record_expectations',
  );
  if (!call) return { expectations: [], truncated: false };

  const raw = (call.input as any)?.expectations;
  if (!Array.isArray(raw)) return { expectations: [], truncated: false };

  const expectations = raw.slice(0, MAX_EXPECTATIONS).map((item: any, index: number): Expectation => {
    const kind: ExpectationKind = VALID_KINDS.includes(item?.kind) ? item.kind : 'record_exists';
    return {
      id: `e${index + 1}`,
      kind,
      description: String(item?.description ?? '').slice(0, 600) || 'Unnamed expectation',
      where: String(item?.where ?? '').slice(0, 300),
      identifiers: coerceStringMap(item?.identifiers),
      expected: coerceStringMap(item?.expected),
      // Anything not explicitly marked incidental counts. A model that omits
      // the flag should not thereby downgrade a real requirement.
      critical: item?.critical !== false,
    };
  });

  return { expectations, truncated: raw.length > MAX_EXPECTATIONS };
}
