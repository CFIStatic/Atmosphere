/**
 * Ask latency bench: runs the real Ask pipeline (answerFromJobFile → lookup →
 * grounding) for each kind of turn against a simulated provider network, and
 * reports time to first visible text and total time.
 *
 * Nothing leaves the box: every Anthropic, Gemini, Tavily, and embeddings call
 * is answered by a local fake whose latency depends on what the request asks
 * for (model, thinking effort, Tavily include_answer, Gemini thinking level).
 * The latency numbers come from production measurements where we have them
 * (Tavily, embeddings, ask_turn_events by model) and are listed in LATENCY.
 *
 * Usage: npx tsx scripts/askLatencyBench.ts [--json]
 * Run the same file on two checkouts to compare before and after.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the bench loads Ask modules dynamically so the same file runs on older checkouts whose signatures differ. */
import { performance } from 'node:perf_hooks';

process.env.ANTHROPIC_API_KEY = 'bench-not-a-real-key';
process.env.GEMINI_API_KEY = 'bench-not-a-real-key';
process.env.TAVILY_API_KEY = 'bench-not-a-real-key';
process.env.OPENAI_API_KEY = 'bench-not-a-real-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.ASK_DEEP_EFFORT;

/** Milliseconds. Sources: Tavily + embeddings measured from the box (p50); model numbers from ask_turn_events. */
export const LATENCY = {
  tavilyWithAnswer: 2500,
  tavilyNoAnswer: 1500,
  embeddings: 400,
  // Anthropic time to first visible text block.
  sonnet: 800,
  opusNoThinking: 1500,
  opusEffort: { low: 2000, medium: 3500, high: 7000, xhigh: 9000, max: 11000 } as Record<string, number>,
  // Gemini Flash: thinking low/minimal vs Gemini 3 default (dynamic, high) thinking.
  geminiLow: 700,
  geminiDefault: 4000,
  // Classifier with maxOutputTokens 8 and default thinking: thinking eats the budget, empty reply.
  geminiClassifierStarved: 2500,
  // Output speed, characters per ms (~4 chars/token).
  opusCharsPerMs: 0.2,
  sonnetCharsPerMs: 0.32,
  geminiCharsPerMs: 0.6,
  // HTTP turn work outside answerFromJobFile (job file load before, storage after).
  contextLoadBefore: 650,
  contextLoadAfter: 450,
  storeBefore: 260,
  storeAfter: 200,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = Record<string, any>;

function lastUserText(body: Body): string {
  const msgs = (body.messages ?? []) as Array<{ role: string; content: unknown }>;
  const text = msgs
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
  const contents = (body.contents ?? []) as Array<{ parts?: Array<{ text?: string }> }>;
  return text + contents.map((c) => (c.parts ?? []).map((p) => p.text ?? '').join('')).join('\n');
}

function hasToolResult(body: Body): boolean {
  return JSON.stringify(body.messages ?? body.contents ?? []).includes('tool_result') ||
    JSON.stringify(body.contents ?? []).includes('functionResponse');
}

function answerFor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/ball game|who'?s going to win|whos going to win/.test(p)) {
    return 'The Yankees are favored at home tonight against the Rays, with Cole starting, and the Guardians are slight favorites over the White Sox. Neither is a lock, but those are the leans going in.';
  }
  if (/draft|email/.test(p)) {
    return 'Subject: Quick update on your roof\n\nHi Dana,\n\nThe crew re-secured the tarp on the north slope after it came off, and the deck replacement the carrier approved is next on the schedule. We will confirm the start day once materials are on site.\n\nThanks,\nEl Presidente';
  }
  if (/estimate|upload|attached|this file|company/.test(p)) {
    return 'The estimate is from Lone Star Roofing and covers the deck replacement and a full tear-off of the north slope.';
  }
  if (/tarp|why|happened/.test(p)) {
    return 'The tarp came off the north slope after the storm, and the crew re-secured it the same day before the deck work started.';
  }
  return 'There are two clips on this job: the north slope after the storm and the deck inspection.';
}

function anthropicSse(model: string, blocks: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown }>): string[] {
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const out: string[] = [];
  out.push(
    ev('message_start', {
      type: 'message_start',
      message: { id: 'msg_bench', type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 1 } },
    }),
  );
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      out.push(ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }));
      for (let i = 0; i < block.text.length; i += 24) {
        out.push(ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text.slice(i, i + 24) } }));
      }
    } else {
      out.push(ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: block.name, input: {} } }));
      out.push(ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }));
    }
    out.push(ev('content_block_stop', { type: 'content_block_stop', index }));
  });
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  out.push(ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 120 } }));
  out.push(ev('message_stop', { type: 'message_stop' }));
  return out;
}

function pacedStream(chunks: string[], firstDelayMs: number, charsPerMs: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await sleep(firstDelayMs);
      for (const chunk of chunks) {
        const textLen = /text_delta|"text":"/.test(chunk) ? 24 : 0;
        if (textLen) await sleep(textLen / charsPerMs);
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function anthropicLatency(body: Body): { first: number; speed: number; model: string } {
  const model = String(body.model ?? '');
  if (/sonnet|haiku/.test(model)) return { first: LATENCY.sonnet, speed: LATENCY.sonnetCharsPerMs, model };
  const effort = body.thinking ? String(body.output_config?.effort ?? 'high') : '';
  return {
    first: effort ? (LATENCY.opusEffort[effort] ?? LATENCY.opusEffort.high) : LATENCY.opusNoThinking,
    speed: LATENCY.opusCharsPerMs,
    model,
  };
}

export const providerLog: string[] = [];

export const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const raw = init?.body ?? (input instanceof Request ? await input.text() : '{}');
  const body: Body = (() => {
    try {
      return JSON.parse(String(raw || '{}')) as Body;
    } catch {
      return {};
    }
  })();
  if (url.includes('api.tavily.com')) {
    const ms = body.include_answer ? LATENCY.tavilyWithAnswer : LATENCY.tavilyNoAnswer;
    providerLog.push(`tavily:${ms}`);
    await sleep(ms);
    return new Response(
      JSON.stringify({
        answer: body.include_answer ? 'The Yankees are favored over the Rays tonight.' : undefined,
        results: [
          { title: 'Rays at Yankees odds and preview', url: 'https://example.com/rays-yankees', content: 'Yankees -150 at home Wednesday, Gerrit Cole starts for New York.' },
          { title: 'Guardians vs White Sox prediction', url: 'https://example.com/cle-chw', content: 'Guardians are -170 favorites over the White Sox on Wednesday night.' },
          { title: 'MLB schedule Oct 7', url: 'https://example.com/schedule', content: 'Wednesday, October 7: Rays at Yankees 7:05 PM ET; White Sox at Guardians 6:40 PM ET.' },
        ].slice(0, Number(body.max_results ?? 5)),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (url.includes('/embeddings')) {
    providerLog.push('embed');
    await sleep(LATENCY.embeddings);
    const n = Array.isArray(body.input) ? body.input.length : 1;
    return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: Array.from({ length: 8 }, (_, i) => ((i + index) % 5) / 5) })) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    if (url.includes('cachedContents')) {
      return new Response(JSON.stringify({ name: 'cachedContents/bench' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const config = body.generationConfig ?? {};
    const thinking = config.thinkingConfig ?? {};
    const low = thinking.thinkingBudget === 0 || ['low', 'minimal'].includes(String(thinking.thinkingLevel ?? '').toLowerCase());
    const classifier = JSON.stringify(body.system_instruction ?? '').includes('Reply with exactly one word: FAST or DEEP');
    if (classifier) {
      const starved = Number(config.maxOutputTokens ?? 0) <= 8 && !low;
      const ms = starved ? LATENCY.geminiClassifierStarved : low ? LATENCY.geminiLow : LATENCY.geminiDefault;
      providerLog.push(`classifier:${ms}`);
      await sleep(ms);
      const q = lastUserText(body).toLowerCase();
      const word = starved ? '' : /how many|list|who is|status|when/.test(q) ? 'FAST' : 'DEEP';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: word ? [{ text: word }] : [] } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const first = low ? LATENCY.geminiLow : LATENCY.geminiDefault;
    const text = answerFor(lastUserText(body));
    providerLog.push(`gemini:${first}`);
    if (url.includes('streamGenerateContent')) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += 24) {
        chunks.push(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: text.slice(i, i + 24) }] } }], modelVersion: 'gemini-3.8-flash' })}\n\n`);
      }
      return pacedStream(chunks, first, LATENCY.geminiCharsPerMs);
    }
    await sleep(first + text.length / LATENCY.geminiCharsPerMs);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], modelVersion: 'gemini-3.8-flash' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('anthropic.com') || url.includes('/v1/messages')) {
    const { first, speed, model } = anthropicLatency(body);
    const prompt = lastUserText(body);
    const sys = JSON.stringify(body.system ?? '');
    const tools = ((body.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
    const general = /ball game|going to win/i.test(prompt);
    const complex = /why/i.test(prompt) && /tarp/i.test(prompt);
    let blocks: Parameters<typeof anthropicSse>[1];
    if (tools.length && !hasToolResult(body) && general && tools.includes('web_search')) {
      // Production: Opus wrote a preface, then searched again.
      blocks = [
        { type: 'text', text: "I don't have tonight's lineups in this job file, so let me check. " },
        { type: 'tool_use', name: 'web_search', input: { query: 'MLB games tonight odds' } },
      ];
    } else if (tools.length && !hasToolResult(body) && complex && tools.includes('search_transcripts')) {
      blocks = [{ type: 'tool_use', name: 'search_transcripts', input: { query: 'tarp' } }];
    } else if (/Return only the corrected answer|rewrite|unsupported/i.test(sys) && !tools.length) {
      blocks = [{ type: 'text', text: answerFor(prompt) }];
    } else {
      blocks = [{ type: 'text', text: answerFor(prompt) }];
    }
    providerLog.push(`anthropic:${model}:${first}${body.output_config?.effort ? `:${body.output_config.effort}` : ''}`);
    const sse = anthropicSse(model, blocks);
    if (body.stream) return pacedStream(sse, first, speed);
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    await sleep(first + text.length / speed);
    return new Response(
      JSON.stringify({
        id: 'msg_bench',
        type: 'message',
        role: 'assistant',
        model,
        content: blocks.map((b, i) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: `toolu_${i}`, name: b.name, input: b.input })),
        stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 2000, output_tokens: 120 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // Anything else (Supabase etc.) is not part of the measured path.
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// ---------------------------------------------------------------------------
// Scenarios

const ORG = '00000000-0000-4000-8000-000000000001';
const JOB = '00000000-0000-4000-8000-000000000002';

function chain(): any {
  const result = { data: null, error: null, count: 0 };
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

const file = {
  job: {
    title: 'Cedar Ridge — storm damage',
    jobNumber: 1038,
    claimNumber: 'CLM-88396',
    status: 'in_progress',
    description: 'Roof tarp and deck rebuild after hail.',
  },
  facts: { 'Site address': '2214 Cedar Ridge Dr, Round Rock TX', Homeowner: 'Dana Whitfield' },
  briefNote: 'Carrier approved the deck replacement.',
  scope: [{ state: 'approved', title: 'Deck replacement', detail: 'North slope', reason: null }],
  messages: [{ author: 'Marcus', body: 'Tarp came off the north slope after the storm; re-secured same day.' }],
  tasks: [{ title: 'Order decking', status: 'open', details: null, assignee: 'Marcus' }],
  crew: [{ name: 'Marcus', role: 'lead' }],
  clips: [],
};

const catalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: file.job.title,
  jobAddress: '2214 Cedar Ridge Dr, Round Rock TX',
  clientName: 'Dana Whitfield',
  timeZone: 'America/Chicago',
  clips: [
    {
      proofId: '00000000-0000-4000-8000-0000000000a1',
      jobId: JOB,
      orgId: ORG,
      title: 'North slope after storm',
      workDate: '2026-10-05',
      summary: 'Tarp came off the north slope; crew re-secured it.',
      segments: [
        { start: 3, end: 7, text: 'The tarp came off the north slope after the storm last night.' },
        { start: 8, end: 12, text: 'We re-secured it this morning before the deck work.' },
      ],
      speakers: ['Marcus'],
    },
    {
      proofId: '00000000-0000-4000-8000-0000000000a2',
      jobId: JOB,
      orgId: ORG,
      title: 'Deck inspection',
      workDate: '2026-10-06',
      summary: 'Deck boards soft near the valley.',
      segments: [{ start: 2, end: 6, text: 'These deck boards are soft near the valley, they need to come out.' }],
      speakers: ['Marcus'],
    },
  ],
  people: [{ userId: '00000000-0000-4000-8000-0000000000b1', name: 'Marcus', onThisJob: true }],
  history: [],
};

const estimate = {
  id: '00000000-0000-4000-8000-0000000000c1',
  filename: 'Lone Star Roofing estimate.pdf',
  kind: 'estimate',
  attached: true,
  relevance: 'related',
  summary: 'Estimate from Lone Star Roofing for deck replacement and north slope tear-off.',
  extractedText:
    'Lone Star Roofing\nEstimate #4471\nScope: deck replacement, full tear-off of the north slope, synthetic underlayment.\nTotal: $18,450.00',
};

type Scenario = {
  kind: string;
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  sessionDocuments?: unknown[];
  prefetch?: boolean;
};

const SCENARIOS: Scenario[] = [
  { kind: 'general web', question: 'whos going to win the ball game', prefetch: true },
  { kind: 'simple job', question: 'how many clips are on this job' },
  { kind: 'complex job', question: 'Why did the tarp come off and what did the crew do about it?' },
  { kind: 'document upload', question: 'what company is this estimate from?', sessionDocuments: [estimate] },
  {
    kind: 'follow-up',
    question: 'and what happened after that?',
    history: [
      { role: 'user', text: 'what happened on the north slope' },
      { role: 'assistant', text: 'The tarp came off the north slope after the storm.' },
    ],
  },
  { kind: 'draft (homeowner email)', question: 'Draft an email to the homeowner with a quick update' },
];

async function main() {
  const json = process.argv.includes('--json');
  const jobFileAsk: any = await import('../shared/jobFileAsk.js');
  const web: any = await import('../shared/askWebSearch.js');
  const preview: any = await import('../shared/askPreview.js').catch(() => null);
  const isAfter = Boolean(preview?.createAskPreviewGate);
  globalThis.fetch = fakeFetch;
  const rows: Array<Record<string, unknown>> = [];
  for (const scenario of SCENARIOS) {
    providerLog.length = 0;
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    let firstRaw: number | null = null;
    let firstVisible: number | null = null;
    let webSearch: unknown;
    if (isAfter && scenario.prefetch && typeof web.createAskWebSearchMemo === 'function') {
      webSearch = web.createAskWebSearchMemo({ fetchFn: fakeFetch, timeZone: 'America/Chicago' });
      if (web.isGeneralAsk(scenario.question)) {
        void (webSearch as any)(scenario.question, { limit: 5, includeDomains: web.includeDomainsForAsk(scenario.question) });
      }
    }
    await sleep(isAfter ? LATENCY.contextLoadAfter : LATENCY.contextLoadBefore);
    const gate = isAfter
      ? preview.createAskPreviewGate({
          emit: (text: string) => {
            if (text && firstVisible === null) firstVisible = since();
          },
          reset: () => undefined,
        })
      : null;
    const result = await jobFileAsk.answerFromJobFile({
      question: scenario.question,
      file,
      history: scenario.history ?? [],
      apiKey: 'bench-not-a-real-key',
      fetchFn: fakeFetch,
      now: new Date('2026-10-08T01:28:00.000Z'),
      lookup: catalog,
      sessionDocuments: scenario.sessionDocuments ?? [],
      webSearch,
      onToken: (text: string) => {
        if (text && firstRaw === null) firstRaw = since();
        gate?.push(text);
      },
      onPreviewReset: () => gate?.reset(),
      setPreviewCheck: (check: unknown) => gate?.setCheck(check),
      toolContext: { orgId: ORG, jobId: JOB, supabase: chain(), access: 'org', file, userId: null },
    });
    await sleep(isAfter ? LATENCY.storeAfter : LATENCY.storeBefore);
    const total = since();
    rows.push({
      kind: scenario.kind,
      // Before: the panel ignored token events and showed only "Thinking" until done.
      visibleTtftMs: isAfter ? (firstVisible ?? total) : total,
      rawTtftMs: firstRaw,
      totalMs: total,
      model: result.model ?? 'none',
      calls: providerLog.join(' '),
      answer: String(result.answer ?? '').replace(/\s+/g, ' ').slice(0, 90),
      groundedOn: result.groundedOn,
    });
  }
  if (json) {
    console.log(JSON.stringify({ build: isAfter ? 'after' : 'before', rows }, null, 2));
    return;
  }
  console.log(`build: ${isAfter ? 'after (this branch)' : 'before'}`);
  for (const row of rows) {
    console.log(
      `${String(row.kind).padEnd(26)} visible TTFT ${String(row.visibleTtftMs).padStart(6)} ms   total ${String(row.totalMs).padStart(6)} ms   raw TTFT ${String(row.rawTtftMs).padStart(6)}   model ${row.model}   [${row.calls}]` +
        (process.env.BENCH_VERBOSE ? `\n    ${row.answer}` : ''),
    );
  }
}

void main();
