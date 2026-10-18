/**
 * Job Chat as one agent (the "new Chat").
 *
 * One model sees the whole job file (cached once per job), the conversation so
 * far, and every tool: job lookups, web search, Computer for outside sites,
 * and the office actions (texts, job-file updates, access, CRM). It decides
 * what to look up or do and keeps going until the request is done, streaming
 * from the first word. No keyword routing picks a path for it.
 *
 * Kept from the classic path: approval cards for anything that reaches a
 * person or removes access (the tools only propose), and the quote check
 * (every quote must be an exact transcript line). The quote check fixes
 * quotes only; it never deletes the rest of an answer.
 *
 * Model: every turn starts on the fast model, which hands the turn to the
 * deepest model itself (think_harder) when the request deserves it. No keyword
 * list picks the model.
 *
 * Switch: ASK_AGENT=on (default: everyone; a turn can still ask for "classic"),
 * off (nobody: the classic path answers), or beta (only turns that ask for
 * engine "agent").
 */
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicClientForKey, tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import { mergeMeasuredUsages } from '../lib/providerUsage.js';
import {
  anthropicAskApiKey,
  anthropicReasoningRequest,
  askFastAnthropicModel,
  askInteractiveDeepEffort,
  askReasoningConfig,
  logAskFailure,
} from '../lib/askModel.js';
import { CHAT_VOICE_RULES } from './askProse.js';
import {
  ASK_LOOKUP_TOOLS,
  askClipCite,
  clipAskPreview,
  clipsInScope,
  executeAskLookup,
  scrubStoredAskText,
  type AskLookupCatalog,
  type AskLookupClip,
  type AskLookupResult,
  type AskLookupTraceStep,
} from './askLookup.js';
import { localStamp } from './askPolish.js';
import { parseMomentSource } from './askMoments.js';
import { chunkClipTranscript, type TranscriptChunk } from './askTranscriptIndex.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import {
  askClockSystemRules,
  isAskWebSearchConfigured,
  plainWebModelText,
  stripExternalAskLinks,
  webSearchModelPayload,
  type AskWebHit,
} from './askWebSearch.js';
import type { AskActionModelTool } from './askReasoning.js';
import type { ClipStillsResult } from './clipStills.js';

export type AskEngine = 'agent' | 'classic';

/** Whether this turn runs on the agent. */
export function askAgentEnabled(requested?: string | null): boolean {
  const mode = (process.env.ASK_AGENT ?? 'on').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') return false;
  if (mode === 'on' || mode === '1' || mode === 'true') return requested !== 'classic';
  return requested === 'agent';
}

const MAX_ROUNDS = 10;
const TURN_BUDGET_MS = 120_000;
const FAST_MAX_TOKENS = 8_192;
/** One clip's transcript in the cached file. Longer ones are read with get_clip. */
const CLIP_TRANSCRIPT_CHARS = 12_000;
/** The whole cached job file. Past this, clips keep their summary and cite only. */
const JOB_CONTEXT_CHARS = 160_000;

export const ASK_AGENT_SYSTEM = `You are Atmosphere's Chat, the assistant inside a restoration and construction contractor's job file. You are as capable as ChatGPT, Claude or Grok: answer anything (the job, the trade, codes, insurance, math, writing, the news), and do real work for the person, using the tools below.

THE JOB FILE
- The request starts with the whole open job file: project, people, history, notes, documents, and every clip with its transcript, AI summary, findings and cite id. You already know this job. Answer from it directly; use the lookup tools only to read something longer or more exact (a full transcript, timed lines for a quote, another job).
- Facts about this job come only from the file and tool results. Never invent clips, quotes, people, dates, prices or work. If something is not on the file, say so in one short sentence and give what the file does show.
- The raw transcript is authoritative for what was said. The AI summary can be stale.
- Speakers: use a diarization label ("Speaker 1") or a name the file attaches to that speaker. Otherwise "an unidentified speaker". Never infer a name or role from who filmed the clip.
- Never assume anyone's gender. Use their name, or they/them, unless the file states their pronouns.
- Quotes: only exact words from a transcript line, in “ ”, followed by the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15). Get the time from search_transcripts or get_clip when the file does not show it. A quote that is not an exact line is removed before the person sees it.

EVERYTHING ELSE
- General know-how (trade practice, IICRC drying and mitigation, codes, Xactimate line items, insurance terms, how-to, math, definitions) comes from what you know. Apply it to this job's facts. Say when a point is general guidance rather than from the file.
- Anything current or that you are not sure of (weather, prices, product availability, news, scores, a code section's exact wording): call web_search. Put the calendar date in the query for "today", "tomorrow", "Thursday".

DOING THINGS
- A request to do something is work, not a question. Look up what you need from the file first (the homeowner's phone or email, the claim number, what was done), then act. Chain as many steps as the job needs.
- Text someone: send_job_sms. Change the job file: update_job_fields. Remove access: propose_revoke_access. CRM and access lists: get_crm_record, search_crm, list_who_has_access.
- A text or an access removal only becomes a card the person approves. Say it is ready for them to send or confirm. Never say it was sent or removed.
- Anything on an outside website or app (Restore 365 / DASH, Outlook or Gmail email, Xactimate, AccuLynx, JobNimbus, supplier and permit sites, any saved Login): start_computer_task with clear instructions that include the details from the file. Computer signs in with the saved Login and asks before submitting anything. That hands the turn to Computer.
- Drafts (homeowner update, email, scope note, punch list, estimate outline) are finished documents wrapped as:
  ⟦artifact⟧
  the document
  ⟦/artifact⟧
  with one sentence before it. Never invent a price.

HOW HARD TO THINK
- You start on a fast model. Before writing anything, call think_harder when the request deserves the deepest model: money, estimates, supplements or line items; a dispute, claim denial, liability or safety question; deadlines and legal or insurance wording; a summary or recap of a whole job; a draft that will be sent to a homeowner, adjuster or crew; comparing several clips or jobs; a multi-step task; or whenever you are unsure you would get it right. Quick look-ups, simple facts, chit-chat and short how-tos do not need it.

COMPUTER RESULTS
- A message that starts "Computer finished:" comes from the app, not the person: Computer just finished a task they asked for. Report what it found or did from the Computer results (the numbers, names, what was sent), plainly and briefly, and offer the obvious next step. If it failed or stopped, say why in one sentence and what they can do.
- When a Computer task is waiting on the person (Status: needs_you), and they ask about it ("what's the code?", "is it stuck?"), tell them exactly what it needs from the Computer results, including the authenticator number when one is listed. Never make a number up.

WRITING
${CHAT_VOICE_RULES}
- Markdown is rendered. Short paragraphs; bullets only for parallel items; a table for comparisons.
- After the answer, when you used the job file, add one line with the clips or records you relied on, using their cite ids:
  ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>, …⟧
  Omit @seconds when you do not know the time. Skip this line for answers that do not use the file.
- Then, when useful, two or three short follow-up questions the person might ask next:
  ⟦followups: question one? ;; question two?⟧
- Never write raw ids, UTC times, URLs from the web, or these machine lines inside sentences.`;

const WEB_TOOL = {
  name: 'web_search',
  description:
    'Search the public web for anything current or not on the job file: weather, prices, products, codes, news, how-to. Include the calendar date for relative days. Optional include_domains limits results to sites such as homedepot.com.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The search query.' },
      include_domains: { type: 'array', items: { type: 'string' }, description: 'Optional hostnames.' },
    },
    required: ['query'],
  },
};

const LOOK_TOOL = {
  name: 'look_at_clip',
  description:
    'See a clip: returns up to 4 still frames from the video as images, nearest to atSeconds when given, otherwise spread across the clip. Use for anything visual (what a room, ceiling, wall, damage, equipment or work looks like; is something there; colors, materials, condition). Transcripts only say what was heard. Private moments and children are never shown.',
  input_schema: {
    type: 'object' as const,
    properties: {
      proofId: { type: 'string', description: 'Clip id: the id after the job id in a clip cite (video/<jobId>/<proofId>/…).' },
      atSeconds: { type: 'number', description: 'Optional second in the clip to look near.' },
      count: { type: 'number', description: 'How many stills, 1 to 4 (default 3).' },
    },
    required: ['proofId'],
  },
};

const DEEP_TOOL = {
  name: 'think_harder',
  description:
    'Hand this turn to the deepest model before answering. Call it alone, first, for money, estimates, disputes, safety, deadlines, whole-job summaries, drafts that will be sent, comparisons, multi-step work, or when unsure.',
  input_schema: {
    type: 'object' as const,
    properties: { reason: { type: 'string', description: 'A few words on why.' } },
    required: [],
  },
};

const COMPUTER_TOOL = {
  name: 'start_computer_task',
  description:
    'Open a real browser and do the work on an outside website or app (Restore 365 / DASH, Outlook, Gmail, Xactimate, AccuLynx, JobNimbus, supplier or permit sites, any saved Login). Use for logging in, checking, looking up, filling in or sending something there, including email from their own mailbox. Instructions must carry the details from the job file. Computer types saved passwords itself, shows a live view, and asks before anything is submitted.',
  input_schema: {
    type: 'object' as const,
    properties: {
      instructions: { type: 'string', description: 'What to do on the site, with every needed detail resolved.' },
      start_url: { type: 'string', description: 'Website to open first, if known.' },
    },
    required: ['instructions'],
  },
};

function clipCard(clip: AskLookupClip, catalog: AskLookupCatalog, withTranscript: boolean): string {
  const when = clip.workDate ? localStamp(clip.workDate, catalog.timeZone) || clip.workDate : 'Undated';
  const preview = clipAskPreview(clip);
  return [
    `- ${when} — ${clip.title} (cite: ${askClipCite(clip, null)})`,
    withTranscript && preview.transcript
      ? `  Raw transcript (authoritative): ${preview.transcript.slice(0, CLIP_TRANSCRIPT_CHARS)}`
      : '',
    preview.summary ? `  AI summary (may be stale): ${preview.summary}` : '',
    preview.findings ? `  Findings: ${preview.findings}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The whole job file, the same for every question on this job, so the prompt
 * cache is reused across a conversation. Nothing question-specific goes here.
 */
export function agentJobContext(catalog: AskLookupCatalog, jobFileRecord: string | null | undefined): string {
  const head: string[] = [`Open job id: ${catalog.jobId}`, `Project: ${catalog.jobTitle?.trim() || 'Untitled job'}`];
  if (catalog.jobAddress?.trim()) head.push(`Address: ${catalog.jobAddress.trim()}`);
  if (catalog.clientName?.trim()) head.push(`Client: ${catalog.clientName.trim()}`);
  if (catalog.jobDescription?.trim()) head.push(`Description: ${catalog.jobDescription.trim()}`);
  const people = (catalog.people ?? []).filter((p) => p.onThisJob !== false && p.name?.trim());
  head.push(`People: ${people.length ? people.map((p) => p.name).join(', ') : 'none listed'}`);
  const history = (catalog.history ?? []).slice(0, 60);
  if (history.length) {
    head.push(
      `Job history:\n${history.map((e) => `- ${localStamp(e.at, catalog.timeZone) || 'Recorded'}: ${e.summary}`).join('\n')}`,
    );
  }
  const record = (jobFileRecord ?? '').trim();
  const clips = clipsInScope(catalog);
  const build = (withTranscript: boolean) =>
    [
      head.join('\n'),
      record ? `Job file record:\n${record}` : '',
      clips.length ? `Clips (${clips.length}):\n${clips.map((c) => clipCard(c, catalog, withTranscript)).join('\n')}` : 'Clips: none',
    ]
      .filter(Boolean)
      .join('\n\n');
  const full = build(true);
  if (full.length <= JOB_CONTEXT_CHARS) return full;
  // Too big: keep every clip's summary and cite; read transcripts with get_clip.
  return `${build(false).slice(0, JOB_CONTEXT_CHARS)}\n\n(Transcripts are not inlined for this large job. Use search_transcripts and get_clip.)`;
}

/** The fast model every turn starts on, and the deep model it can hand the turn to. */
export function agentModels(): { fast: string; deep: string } {
  const fast = (process.env.ASK_AGENT_MODEL ?? '').trim() || askFastAnthropicModel();
  const deep = (process.env.ASK_AGENT_DEEP_MODEL ?? '').trim() || askReasoningConfig().anthropicModel;
  return { fast, deep };
}

/** Keep only source ids that point at this job's clips (or non-clip job records). */
function filterSources(answer: string, catalog: AskLookupCatalog): string {
  const known = new Set(clipsInScope(catalog).map((c) => c.proofId));
  return answer.replace(/⟦sources:\s*([^⟧]*)⟧/gi, (_full, body: string) => {
    const kept = body
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .filter((id) => {
        const moment = parseMomentSource(id);
        if (moment) return moment.jobId === catalog.jobId && known.has(moment.proofId);
        return /^(?:job|doc|document|clip:)/i.test(id);
      });
    return kept.length ? `⟦sources: ${[...new Set(kept)].join(', ')}⟧` : '';
  });
}

export type AskAgentInput = {
  question: string;
  catalog: AskLookupCatalog;
  /** Everything on the file outside the clips (brief, scope, notes, documents, crew, tasks). */
  jobFileRecord?: string | null;
  history?: Array<{ role?: string | null; text?: string | null; officeOnly?: boolean }> | null;
  /** Thread summary, durable notes, company memory, chat uploads, Computer results, @mention dossier. */
  turnContext?: string | null;
  apiKey?: string | null;
  timeZone?: string | null;
  now?: Date;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onStatus?: (phase: string) => void;
  onPreviewReset?: () => void;
  /** Public web search. Absent: no web tool. */
  webSearch?: ((query: string, includeDomains?: string[]) => Promise<{ hits: AskWebHit[]; answer: string }>) | null;
  /** Loads clips on the company's other jobs the first time the model searches them (office only). */
  loadOrgClips?: (() => Promise<AskLookupClip[]>) | null;
  /** Loads a clip's saved stills (privacy ranges already left out). Offers look_at_clip when set. */
  clipStills?: ((clip: AskLookupClip, opts: { atSeconds: number | null; count: number }) => Promise<ClipStillsResult>) | null;
  /** Office actions. Absent for homeowners and subs. */
  actions?: {
    tools: AskActionModelTool[];
    run: (name: string, input: Record<string, unknown>) => Promise<AskLookupResult>;
  } | null;
  /** Outside sites. Returns the turn's reply (with the Computer card trailer). */
  computer?: ((args: { instructions: string; start_url?: string | null }) => Promise<string>) | null;
  /** Extra transcript chunks the quote check accepts (uploaded documents). */
  extraChunks?: TranscriptChunk[];
  /** Test hook: replaces the Anthropic stream. */
  callModel?: AskAgentModelCall;
};

export type AskAgentModelTurn = {
  model: string;
  blocks: Anthropic.ContentBlock[];
  usage: MeasuredUsage | null;
};

export type AskAgentModelCall = (request: {
  model: string;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  maxTokens: number;
  thinking?: unknown;
  outputConfig?: unknown;
  onText: (delta: string) => void;
  signal: AbortSignal;
}) => Promise<AskAgentModelTurn>;

export type AskAgentResult = {
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  trace: AskLookupTraceStep[];
  webHits: AskWebHit[];
  computerStarted: boolean;
  /** The fast model handed this turn to the deep model. */
  escalated: boolean;
};

const anthropicCall: AskAgentModelCall = async (req) => {
  const apiKey = anthropicAskApiKey();
  const stream = anthropicClientForKey(apiKey).messages.stream(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      tools: req.tools as Anthropic.Tool[],
      ...(req.thinking ? { thinking: req.thinking as Anthropic.ThinkingConfigParam } : {}),
      ...(req.outputConfig ? { output_config: req.outputConfig } : {}),
    } as Anthropic.MessageStreamParams,
    { signal: req.signal },
  );
  stream.on('text', (delta: string) => req.onText(delta));
  const response = await stream.finalMessage();
  return { model: response.model, blocks: response.content, usage: tryExtractUsage(response.usage, response.model ?? null) };
};

function historyMessages(history: AskAgentInput['history'], catalog: AskLookupCatalog): Anthropic.MessageParam[] {
  const turns = (history ?? [])
    .filter((t) => (t.text ?? '').trim())
    .slice(-16)
    .map((t) => ({
      role: (t.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: scrubStoredAskText(String(t.text).trim(), catalog.clips).slice(0, 4000),
    }));
  // The API wants alternating roles starting with the user.
  const out: Anthropic.MessageParam[] = [];
  for (const turn of turns) {
    const last = out[out.length - 1];
    if (!last && turn.role === 'assistant') continue;
    if (last && last.role === turn.role) {
      last.content = `${String(last.content)}\n\n${turn.content}`;
      continue;
    }
    out.push({ ...turn });
  }
  if (out.length && out[out.length - 1]!.role === 'user') out.pop();
  return out;
}

/**
 * What every turn sends ahead of the question: the tool list and the two cached
 * system blocks. The warm call sends exactly this, so its cache entry is the one
 * the real first round reads.
 */
function agentRequestShape(input: AskAgentInput) {
  const models = agentModels();
  const baseTools = [
    ...ASK_LOOKUP_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    ...(input.webSearch && isAskWebSearchConfigured() ? [WEB_TOOL] : []),
    ...(input.computer ? [COMPUTER_TOOL] : []),
    ...(input.clipStills ? [LOOK_TOOL] : []),
    ...(input.actions?.tools ?? []),
  ];
  const canEscalate = models.deep !== models.fast;
  const tools = canEscalate ? [...baseTools, DEEP_TOOL] : baseTools;
  // Cached: the instructions, then the whole job file. Both stay the same for
  // every question on this job; the question and this turn's context follow.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: ASK_AGENT_SYSTEM, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: `JOB FILE\n${agentJobContext(input.catalog, input.jobFileRecord)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  return { models, baseTools, tools, system };
}

export type AskAgentWarmCall = (request: {
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}) => Promise<MeasuredUsage | null>;

/** max_tokens 0: the API reads the prompt into the cache and answers nothing. */
const anthropicWarm: AskAgentWarmCall = async (req) => {
  const response = await anthropicClientForKey(anthropicAskApiKey()).messages.create({
    model: req.model,
    max_tokens: 0,
    system: req.system,
    tools: req.tools as Anthropic.Tool[],
    messages: [{ role: 'user', content: 'warmup' }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  return tryExtractUsage(response.usage, response.model ?? null);
};

/**
 * Loads this job's instructions and job file into the model's prompt cache
 * while the person is still typing, so the first answer starts as fast as the
 * later ones. Same model, tools and system blocks as the first round of
 * runAskAgent (which sends no thinking settings on that round).
 */
export async function warmAskAgent(
  input: AskAgentInput & { warmCall?: AskAgentWarmCall },
): Promise<{ model: string; usage: MeasuredUsage | null } | null> {
  const { models, tools, system } = agentRequestShape(input);
  const usage = await (input.warmCall ?? anthropicWarm)({ model: models.fast, system, tools }).catch((err: unknown) => {
    logAskFailure('ask_agent_warm_failed', err);
    return undefined;
  });
  return usage === undefined ? null : { model: models.fast, usage };
}

export async function runAskAgent(input: AskAgentInput): Promise<AskAgentResult> {
  const { catalog } = input;
  const zone = input.timeZone || catalog.timeZone || 'America/Chicago';
  const shape = agentRequestShape(input);
  const { models, baseTools, system } = shape;
  let model = models.fast;
  let shaped: ReturnType<typeof anthropicReasoningRequest> | null = null;
  let escalated = false;
  let tools = shape.tools;
  const actionNames = new Set((input.actions?.tools ?? []).map((t) => t.name));
  const turnContext = (input.turnContext ?? '').trim();
  const userText =
    `${askClockSystemRules(input.now ?? new Date(), zone)}` +
    (turnContext ? `\n\n${turnContext}` : '') +
    `\n\n${input.question.trim()}`;
  const opening: Anthropic.MessageParam[] = [...historyMessages(input.history, catalog), { role: 'user', content: userText }];
  let messages: Anthropic.MessageParam[] = [...opening];
  const call = input.callModel ?? anthropicCall;
  const deadline = AbortSignal.timeout(TURN_BUDGET_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  const trace: AskLookupTraceStep[] = [];
  const webHits: AskWebHit[] = [];
  const usages: Array<MeasuredUsage | null> = [];
  let servedBy: string | null = null;
  let answer = '';

  for (let round = 0; round < MAX_ROUNDS && !signal.aborted; round += 1) {
    let streamed = '';
    let sawTool = false;
    const turn = await call({
      model,
      system,
      messages,
      tools,
      maxTokens: shaped?.max_tokens ?? FAST_MAX_TOKENS,
      thinking: shaped?.thinking,
      outputConfig: shaped?.output_config,
      signal,
      onText: (delta) => {
        if (!delta || sawTool) return;
        streamed += delta;
        input.onToken?.(delta);
      },
    }).catch((err: unknown) => {
      logAskFailure('ask_agent_failed', err);
      return null;
    });
    if (!turn) break;
    servedBy = turn.model || servedBy;
    usages.push(turn.usage);
    const calls = turn.blocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const wantsDeep = !escalated && calls.some((c) => c.name === DEEP_TOOL.name);
    const text = turn.blocks
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!calls.length) {
      answer = text || streamed.trim();
      break;
    }
    sawTool = true;
    // A "let me check" line before a tool call is not the answer.
    if (streamed) input.onPreviewReset?.();

    const computerCall = input.computer ? calls.find((c) => c.name === 'start_computer_task') : undefined;
    if (computerCall && input.computer) {
      input.onStatus?.('Starting Computer…');
      const args = (computerCall.input ?? {}) as Record<string, unknown>;
      const reply = await input.computer({
        instructions: String(args.instructions ?? '').trim() || input.question,
        start_url: typeof args.start_url === 'string' ? args.start_url : null,
      });
      input.onToken?.(reply);
      return { answer: reply, model: servedBy, usage: mergeMeasuredUsages(usages, servedBy), trace, webHits, computerStarted: true, escalated };
    }

    messages.push({ role: 'assistant', content: turn.blocks as Anthropic.ContentBlockParam[] });
    if (
      input.loadOrgClips &&
      !catalog.orgClips &&
      catalog.access === 'org' &&
      calls.some((c) => c.name === 'search_other_jobs' || (c.name === 'get_clip' && !clipsInScope(catalog).some((clip) => clip.proofId === String((c.input as Record<string, unknown>)?.proofId ?? ''))))
    ) {
      input.onStatus?.('Checking other jobs…');
      try {
        catalog.orgClips = await input.loadOrgClips();
      } catch (err) {
        logAskFailure('ask_agent_org_clips_failed', err);
        catalog.orgClips = [];
      }
    }
    const results = await Promise.all(
      calls.filter((c) => c.name !== DEEP_TOOL.name).map(async (c) => {
        const args = (c.input ?? {}) as Record<string, unknown>;
        input.onStatus?.(statusFor(c.name));
        let result: AskLookupResult;
        let images: Anthropic.ImageBlockParam[] = [];
        try {
          if (c.name === 'web_search' && input.webSearch) {
            const query = String(args.query ?? '').trim();
            const domains = Array.isArray(args.include_domains) ? args.include_domains.map(String) : undefined;
            const outcome = query ? await input.webSearch(query, domains) : { hits: [], answer: '' };
            for (const hit of outcome.hits) if (hit?.url && !webHits.some((h) => h.url === hit.url)) webHits.push(hit);
            result = {
              ok: true,
              tool: 'web_search',
              summary: outcome.answer ? plainWebModelText(outcome.answer) : `${outcome.hits.length} web result(s).`,
              data: webSearchModelPayload({ answer: outcome.answer, results: outcome.hits }),
            };
          } else if (c.name === LOOK_TOOL.name && input.clipStills) {
            const look = await lookAtClip(catalog, args, input.clipStills);
            images = look.images;
            result = look.result;
          } else if (actionNames.has(c.name) && input.actions) {
            result = await input.actions.run(c.name, args);
          } else {
            result = executeAskLookup(c.name, args, catalog);
          }
        } catch (err) {
          logAskFailure('ask_agent_tool_failed', err);
          result = { ok: false, tool: c.name, summary: 'That step did not go through.' };
        }
        trace.push({ tool: c.name, input: args, result });
        const json = JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null }).slice(0, 12_000);
        return {
          type: 'tool_result' as const,
          tool_use_id: c.id,
          content: images.length ? [{ type: 'text' as const, text: json }, ...images] : json,
          is_error: !result.ok,
        };
      }),
    );
    messages.push({ role: 'user', content: results });
    if (wantsDeep) {
      // Start the turn over on the deep model. Lookups already done this turn
      // ride along as notes, so the deep model does not repeat them.
      escalated = true;
      model = models.deep;
      shaped = anthropicReasoningRequest(model, askInteractiveDeepEffort());
      tools = baseTools;
      if (streamed) input.onPreviewReset?.();
      input.onStatus?.('Thinking it through…');
      const done = trace.map((t) => `- ${t.tool}: ${t.result.summary}`).join('\n').slice(0, 6000);
      messages = done
        ? [...opening.slice(0, -1), { role: 'user', content: `${userText}\n\n(Looked up so far this turn:\n${done})` }]
        : [...opening];
      continue;
    }
  }

  if (!answer) {
    answer = signal.aborted && !input.signal?.aborted
      ? 'That took too long to finish. Try asking again, or narrow it down.'
      : '';
  }
  // Quotes must be exact transcript lines (or uploaded document text).
  const chunks: TranscriptChunk[] = [
    ...clipsInScope(catalog).flatMap((clip) => chunkClipTranscript(clip)),
    ...(input.extraChunks ?? []),
  ];
  let finished = scrubStoredAskText(answer, catalog.clips);
  finished = filterSources(finished, catalog);
  if (chunks.length) finished = enforceQuoteGrounding(finished, { chunks, question: input.question }).answer;
  finished = stripExternalAskLinks(finished).trim();
  return { answer: finished, model: servedBy, usage: mergeMeasuredUsages(usages, servedBy), trace, webHits, computerStarted: false, escalated };
}

/** look_at_clip: stills from a clip this person can see, as image blocks for the model. */
async function lookAtClip(
  catalog: AskLookupCatalog,
  args: Record<string, unknown>,
  load: NonNullable<AskAgentInput['clipStills']>,
): Promise<{ result: AskLookupResult; images: Anthropic.ImageBlockParam[] }> {
  const id = String(args.proofId ?? '').trim();
  const clip = clipsInScope(catalog).find((row) => row.proofId === id);
  if (!clip) return { result: { ok: false, tool: LOOK_TOOL.name, summary: 'That clip is not on this job.' }, images: [] };
  const at = typeof args.atSeconds === 'number' && Number.isFinite(args.atSeconds) ? args.atSeconds : null;
  const count = typeof args.count === 'number' && Number.isFinite(args.count) ? Math.round(args.count) : 3;
  const got = await load(clip, { atSeconds: at, count });
  const frames = got.stills.map((still) => ({
    atSeconds: Math.round(still.atSeconds * 10) / 10,
    cite: askClipCite(clip, still.atSeconds),
  }));
  const privateNote = got.privateSkipped ? ` ${got.privateSkipped} private moment(s) were left out.` : '';
  const summary = got.stills.length
    ? `Showing ${got.stills.length} still(s) from ${clip.title}.${privateNote}`
    : got.onFile
      ? `No stills from ${clip.title} can be shown.${privateNote}`
      : `No stills are on file for ${clip.title}.`;
  return {
    result: { ok: got.stills.length > 0, tool: LOOK_TOOL.name, summary, data: { proofId: clip.proofId, title: clip.title, frames } },
    images: got.stills.map((still) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: still.jpeg.toString('base64') },
    })),
  };
}

function statusFor(tool: string): string {
  switch (tool) {
    case 'web_search':
      return 'Searching the web…';
    case 'search_transcripts':
      return 'Searching what was said…';
    case 'get_clip':
      return 'Opening a clip…';
    case 'look_at_clip':
      return 'Looking at the video…';
    case 'search_other_jobs':
      return 'Checking other jobs…';
    case 'send_job_sms':
      return 'Writing the text…';
    case 'update_job_fields':
      return 'Updating the job file…';
    case 'get_crm_record':
    case 'search_crm':
      return 'Checking the CRM…';
    case 'list_who_has_access':
    case 'propose_revoke_access':
      return 'Checking who has access…';
    default:
      return 'Working on it…';
  }
}
