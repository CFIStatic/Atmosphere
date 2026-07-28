import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { config } from '../config.js';
import { agentHub } from './agentHub.js';
import { findModel, type CaptureQuality, type ComputerModel } from './models.js';
import type { ComputerAction } from './protocol.js';

/**
 * The agent loop: Claude looks at a screenshot, asks for an action, we perform
 * it on the operator's machine, and the result goes back as a tool result.
 *
 * A run is a live object, not a request/response. The browser subscribes to it
 * over SSE and can leave and come back — which matters because a real task
 * ("reconcile these invoices") runs for minutes, and the person who started it
 * will close the laptop lid.
 */

export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped';

/** One entry in a run's transcript, before the envelope is stamped on. */
export type RunEventBody =
  | { type: 'status'; status: RunStatus; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: string; summary: string; ok: boolean; error?: string }
  | { type: 'screenshot'; image: string | null; width: number; height: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string };

export type RunEvent = RunEventBody & { seq: number; at: string };

export interface RunSummary {
  id: string;
  orgId: string;
  agentId: string;
  agentName: string;
  instruction: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  error: string | null;
}

/**
 * Screenshots are the bulk of a run's memory footprint. The transcript keeps
 * every event so a reconnecting browser can replay the story, but only the most
 * recent images keep their pixels — older ones become placeholders. Without
 * this a long run quietly grows into hundreds of megabytes of PNG.
 */
const KEEP_IMAGES = 4;

/** Runs are held for inspection after they finish, then evicted oldest-first. */
const MAX_RETAINED_RUNS = 40;

export class Run {
  readonly id = randomUUID();
  readonly startedAt = new Date().toISOString();

  status: RunStatus = 'starting';
  endedAt: string | null = null;
  error: string | null = null;
  steps = 0;
  usage = { inputTokens: 0, outputTokens: 0 };

  private readonly events: RunEvent[] = [];
  private readonly subscribers = new Set<(event: RunEvent) => void>();
  private readonly abort = new AbortController();
  private seq = 0;

  constructor(
    readonly orgId: string,
    readonly agentId: string,
    readonly agentName: string,
    readonly instruction: string,
    readonly model: ComputerModel,
  ) {}

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  summary(): RunSummary {
    return {
      id: this.id,
      orgId: this.orgId,
      agentId: this.agentId,
      agentName: this.agentName,
      instruction: this.instruction,
      model: this.model.id,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      steps: this.steps,
      usage: this.usage,
      error: this.error,
    };
  }

  /** Replay everything since `afterSeq`, for a browser that just (re)connected. */
  since(afterSeq: number): RunEvent[] {
    return this.events.filter((event) => event.seq > afterSeq);
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  emit(event: RunEventBody): void {
    this.seq += 1;
    const full: RunEvent = { ...event, seq: this.seq, at: new Date().toISOString() };
    this.events.push(full);
    if (full.type === 'screenshot') this.pruneImages();
    for (const listener of this.subscribers) {
      try {
        listener(full);
      } catch {
        // A broken SSE pipe must not take down the run driving the computer.
      }
    }
  }

  stop(reason = 'Stopped by the operator.'): void {
    if (this.isFinished()) return;
    this.abort.abort();
    this.finish('stopped', reason);
  }

  finish(status: RunStatus, message?: string): void {
    if (this.isFinished()) return;
    this.status = status;
    this.endedAt = new Date().toISOString();
    if (status === 'failed') this.error = message ?? 'The run failed.';
    this.emit({ type: 'status', status, message });
  }

  isFinished(): boolean {
    return this.status === 'completed' || this.status === 'failed' || this.status === 'stopped';
  }

  private pruneImages(): void {
    let kept = 0;
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event.type !== 'screenshot' || event.image === null) continue;
      kept += 1;
      if (kept > KEEP_IMAGES) event.image = null;
    }
  }
}

/* ------------------------------ registry ------------------------------ */

const runs = new Map<string, Run>();

export function getRun(orgId: string, runId: string): Run | null {
  const run = runs.get(runId);
  return run && run.orgId === orgId ? run : null;
}

export function listRuns(orgId: string): RunSummary[] {
  return [...runs.values()]
    .filter((run) => run.orgId === orgId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => run.summary());
}

export function activeRunForAgent(orgId: string, agentId: string): Run | null {
  return (
    [...runs.values()].find(
      (run) => run.orgId === orgId && run.agentId === agentId && !run.isFinished(),
    ) ?? null
  );
}

function retain(run: Run): void {
  runs.set(run.id, run);
  if (runs.size <= MAX_RETAINED_RUNS) return;
  const finished = [...runs.values()]
    .filter((r) => r.isFinished())
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (runs.size > MAX_RETAINED_RUNS && finished.length > 0) {
    runs.delete(finished.shift()!.id);
  }
}

/* ------------------------------ the loop ------------------------------ */

export interface StartRunInput {
  orgId: string;
  agentId: string;
  instruction: string;
  apiKey: string;
  modelId?: string;
  quality: CaptureQuality;
}

export function startRun(input: StartRunInput): Run {
  const model = findModel(input.modelId);
  const agent = agentHub.get(input.orgId, input.agentId);
  if (!agent) throw new Error('That computer is not connected.');

  const run = new Run(input.orgId, input.agentId, agent.name, input.instruction, model);
  agentHub.claim(input.orgId, input.agentId, run.id);
  retain(run);

  // Deliberately not awaited: the HTTP request that started the run returns
  // immediately with an id, and the browser watches progress over SSE.
  void execute(run, input, model).finally(() => agentHub.release(input.agentId, run.id));

  return run;
}

async function execute(run: Run, input: StartRunInput, model: ComputerModel): Promise<void> {
  const client = new Anthropic({ apiKey: input.apiKey });

  // A whole run must be bounded in wall-clock time, not just in steps: a model
  // waiting on a spinner that never resolves would otherwise hold the computer
  // for as long as the process lives.
  const deadline = setTimeout(() => {
    run.emit({ type: 'error', message: 'The run exceeded its time limit and was stopped.' });
    run.stop('Time limit reached.');
  }, config.computerUse.runTimeoutMs);
  deadline.unref?.();

  try {
    const agent = agentHub.get(run.orgId, run.agentId);
    if (!agent) throw new Error('That computer disconnected before the run could start.');

    // Tell the agent what resolution to capture at *before* declaring the tool,
    // because the tool must advertise exactly the dimensions Claude will see.
    const capture = agentHub.configure(run.agentId, model, input.quality);

    run.status = 'running';
    run.emit({ type: 'status', status: 'running' });

    const tools: BetaToolUnion[] = [
      {
        type: model.toolType,
        name: 'computer',
        display_width_px: capture.width,
        display_height_px: capture.height,
        ...(model.supportsZoom ? { enable_zoom: true } : {}),
      } as BetaToolUnion,
    ];

    const messages: BetaMessageParam[] = [
      { role: 'user', content: input.instruction },
    ];

    while (!run.isFinished()) {
      if (run.steps >= config.computerUse.maxIterations) {
        run.emit({
          type: 'error',
          message: `Stopped after ${config.computerUse.maxIterations} steps without finishing.`,
        });
        run.finish('failed', 'Step limit reached.');
        return;
      }

      const stream = client.beta.messages.stream(
        {
          model: model.id,
          max_tokens: config.computerUse.maxTokens,
          betas: [model.beta, 'context-management-2025-06-27'],
          system: [
            {
              type: 'text',
              text: systemPrompt(agent.platform, capture, agent.capabilities),
              // Tools and system are byte-identical every turn, so one
              // breakpoint here caches the whole stable prefix.
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools,
          messages,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'high' },
          // Screenshots dominate the context and go stale the moment the next
          // one arrives. Clearing old ones keeps long runs affordable and, more
          // importantly, keeps them inside the context window at all.
          context_management: {
            edits: [{ type: 'clear_tool_uses_20250919', keep: { type: 'tool_uses', value: 4 } }],
          },
        },
        { signal: run.signal },
      );

      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta') {
          run.emit({ type: 'text', text: event.delta.text });
        } else if (event.delta.type === 'thinking_delta') {
          run.emit({ type: 'thinking', text: event.delta.thinking });
        }
      }

      const message = await stream.finalMessage();
      run.usage.inputTokens += message.usage.input_tokens ?? 0;
      run.usage.outputTokens += message.usage.output_tokens ?? 0;
      run.emit({
        type: 'usage',
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
      });

      messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason === 'refusal') {
        run.emit({
          type: 'error',
          message:
            'Claude declined this request. ' +
            (message.stop_details?.explanation ?? 'No further detail was provided.'),
        });
        run.finish('failed', 'The request was declined.');
        return;
      }

      if (message.stop_reason === 'pause_turn') {
        // A server-side pause: resend the conversation unchanged to resume.
        continue;
      }

      const toolUses = message.content.filter(
        (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        run.finish('completed');
        return;
      }

      const results: BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (run.isFinished()) return;
        run.steps += 1;
        results.push(await performAction(run, toolUse.id, toolUse.input, capture));
      }

      // Every tool_use must get exactly one tool_result, in one user message.
      messages.push({ role: 'user', content: results as BetaContentBlockParam[] });
    }
  } catch (err) {
    if (run.signal.aborted) return; // Already reported as 'stopped'.
    const message = describeError(err);
    run.emit({ type: 'error', message });
    run.finish('failed', message);
  } finally {
    clearTimeout(deadline);
  }
}

/** Send one action to the computer and turn whatever comes back into a tool result. */
async function performAction(
  run: Run,
  toolUseId: string,
  rawInput: unknown,
  capture: { width: number; height: number },
): Promise<BetaToolResultBlockParam> {
  const action = rawInput as ComputerAction;
  const summary = describeAction(action);

  try {
    const output = await agentHub.invoke(run.agentId, action);
    run.emit({ type: 'action', action: action.action, summary, ok: true });

    if (output.kind === 'image') {
      run.emit({
        type: 'screenshot',
        image: output.data,
        width: capture.width,
        height: capture.height,
      });
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: output.data },
          },
        ],
      };
    }

    if (output.kind === 'text') {
      return { type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: output.text }] };
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [{ type: 'text', text: 'Done.' }],
    };
  } catch (err) {
    const message = (err as Error).message;
    run.emit({ type: 'action', action: action.action, summary, ok: false, error: message });
    // Reported as an error result rather than thrown: Claude can recover from
    // "that element is not there" if it is told, and cannot if the run stalls.
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [{ type: 'text', text: message }],
      is_error: true,
    };
  }
}

function describeAction(action: ComputerAction): string {
  const at = action.coordinate ? ` at (${action.coordinate[0]}, ${action.coordinate[1]})` : '';
  switch (action.action) {
    case 'type':
      return `Type "${truncate(action.text ?? '', 60)}"`;
    case 'key':
      return `Press ${action.text ?? ''}`;
    case 'scroll':
      return `Scroll ${action.scroll_direction ?? 'down'}${at}`;
    case 'wait':
      return `Wait ${action.duration ?? 1}s`;
    case 'zoom':
      return `Zoom into ${action.region?.join(', ') ?? 'a region'}`;
    case 'screenshot':
      return 'Take a screenshot';
    default:
      return `${action.action.replace(/_/g, ' ')}${at}`;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Turn SDK errors into something an operator can act on. The default
 * stringification of an Anthropic error is a wall of JSON, and the two failures
 * that actually happen here — a bad key and a rate limit — deserve a sentence.
 */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key. Check the key in Computer Use settings.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'This Anthropic API key is not allowed to use the selected model.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate-limited this account. Wait a moment and try again.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status ?? 'unknown'}): ${err.message}`;
  }
  return (err as Error)?.message ?? 'The run failed for an unknown reason.';
}

function systemPrompt(
  platform: string,
  capture: { width: number; height: number },
  capabilities: string[],
): string {
  const os =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux (X11 desktop)';
  const modifier = platform === 'darwin' ? 'cmd' : 'ctrl';

  return [
    `You are operating a real ${os} computer belonging to a person who is watching you work.`,
    `The screen is ${capture.width}×${capture.height} in the coordinates you see and use.`,
    '',
    'How to work:',
    '- Take a screenshot first. Never act on an assumption about what is on screen.',
    '- After an action that changes the screen, take another screenshot to confirm what happened before continuing.',
    `- Use ${modifier} for shortcuts on this platform (for example ${modifier}+c to copy).`,
    '- If text is too small to read, zoom into that region rather than guessing at it.',
    '- Prefer keyboard navigation over clicking when it is more reliable, such as typing an address instead of hunting for a bookmark.',
    '',
    'Boundaries:',
    '- This is a real machine with real consequences. Do not delete files, uninstall software, change system settings, or send messages unless the task explicitly asked for it.',
    '- If a step needs a credential, a payment, or a decision you were not given, stop and say what you need instead of guessing.',
    '- If the screen does not match what you expected, say so and re-orient. Do not keep clicking in the same place.',
    '',
    'When you are done, stop calling tools and describe plainly what you did and what the result was.',
    `Actions available on this computer: ${capabilities.join(', ')}.`,
  ].join('\n');
}
