/**
 * Chat eval: real questions people have asked Chat (emails swapped for
 * example addresses), run against the real models on a made-up job (no
 * customer data). Each case checks what a good answer must and must not do:
 * the right tool, the right facts, no made-up quotes or prices, texts only as
 * cards. Runs on every Chat change so Chat can't quietly get worse.
 *
 *   ANTHROPIC_API_KEY=… npx tsx scripts/askAgentEval.ts
 *
 * Exits non-zero when fewer than EVAL_MIN_PASS (default 0.9) of the cases pass.
 * Costs well under a dollar. Texts and Computer are stubs: nothing is sent.
 */
import { appendFileSync } from 'node:fs';
import { runAskAgent, type AskAgentResult } from '../src/shared/askAgent.js';
import { askModelActionTools } from '../src/shared/askTools.js';
import { isAskWebSearchConfigured, searchAskWebDetailed } from '../src/shared/askWebSearch.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';

const catalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Henderson basement water loss',
  jobAddress: '2418 N Prospect Ave, Milwaukee, WI 53211',
  clientName: 'Pat Henderson (homeowner, 414-555-0142, pat.henderson@example.invalid)',
  jobDescription: 'Supply line burst under the basement laundry sink. Claim CLM-88412 with Badger Mutual, adjuster Dana Whitfield.',
  timeZone: 'America/Chicago',
  people: [
    { name: 'Pat Henderson', onThisJob: true },
    { name: 'Luis Ortega', onThisJob: true },
  ],
  history: [
    { at: '2026-10-08T14:05:00Z', summary: 'Job created from the after-hours call.' },
    { at: '2026-10-10T19:30:00Z', summary: 'Moisture readings logged: north wall 38%, laundry wall 41% (drywall).' },
  ],
  clips: [
    {
      proofId: '11111111-2222-4333-8444-555555555551',
      jobId: JOB,
      orgId: ORG,
      title: 'Basement first walkthrough',
      workDate: '2026-10-08',
      transcript:
        'Speaker 1: The supply line under the laundry sink split, water ran about six hours before they caught it.\n' +
        'Speaker 2: Carpet and pad are soaked along the north wall, maybe two hundred square feet.\n' +
        'Speaker 1: We need two dehumidifiers and four air movers down here tonight.\n' +
        'Speaker 2: Homeowner wants to keep the bookshelves, they are solid oak.',
      segments: [
        { start: 2, end: 9, text: 'The supply line under the laundry sink split, water ran about six hours before they caught it.', speaker: 'Speaker 1' },
        { start: 10, end: 16, text: 'Carpet and pad are soaked along the north wall, maybe two hundred square feet.', speaker: 'Speaker 2' },
        { start: 17, end: 22, text: 'We need two dehumidifiers and four air movers down here tonight.', speaker: 'Speaker 1' },
        { start: 23, end: 28, text: 'Homeowner wants to keep the bookshelves, they are solid oak.', speaker: 'Speaker 2' },
      ],
      summary: 'Initial walkthrough of a clean-water loss from a split laundry supply line; wet carpet and pad on the north wall.',
    },
    {
      proofId: '11111111-2222-4333-8444-555555555552',
      jobId: JOB,
      orgId: ORG,
      title: 'Day 3 drying check',
      workDate: '2026-10-10',
      transcript:
        'Speaker 1: Drywall on the laundry wall is still reading forty one percent.\n' +
        'Speaker 1: Pad is out, carpet is floated, we pulled the base trim on the north wall.',
      segments: [
        { start: 3, end: 8, text: 'Drywall on the laundry wall is still reading forty one percent.', speaker: 'Speaker 1' },
        { start: 9, end: 15, text: 'Pad is out, carpet is floated, we pulled the base trim on the north wall.', speaker: 'Speaker 1' },
      ],
      summary: 'Day 3 check: pad removed, carpet floated, base trim pulled; laundry wall drywall still wet.',
    },
  ],
} as AskLookupCatalog;

const record = [
  'Brief: Lockbox on the side door. Dog in the backyard.',
  'Scope: extract, remove pad, float carpet, flood cut 2 ft on laundry wall if not dry by day 4.',
  'Notes: Adjuster Dana Whitfield, dana.whitfield@badgermutual.example, 414-555-0199.',
].join('\n');

const COMPUTER_RESULTS =
  'COMPUTER RESULTS ON THIS JOB (browser tasks Computer already ran for this person, newest first):\n' +
  '1. Request: Log in to Restore 365 and count active jobs\n   Status: succeeded\n   Result: Job counts checked. Open Jobs (total): 341; Work in Progress: 31; Pending Sales: 187; Invoice Pending: 54.';

/** Rough list price per million tokens (input, output); cache reads 0.1x, 5-minute writes 1.25x, 1-hour writes 2x. */
function costOf(result: AskAgentResult): number {
  const price = (model: string | null) =>
    /opus/i.test(model ?? '') ? [4, 20] : /haiku/i.test(model ?? '') ? [1, 5] : [2, 10];
  let usd = 0;
  for (const call of result.usage?.calls ?? []) {
    const [inp, out] = price(call.model);
    usd +=
      (call.inputTokens * inp +
        call.cacheReadTokens * inp * 0.1 +
        call.cacheWrite5mTokens * inp * 1.25 +
        call.cacheWrite1hTokens * inp * 2 +
        call.outputTokens * out) /
      1_000_000;
  }
  return usd;
}

type Check = { name: string; ok: (r: AskAgentResult, actions: string[]) => boolean };
type Case = { question: string; turnContext?: string; needsWeb?: boolean; checks: Check[] };

const used = (tool: string): Check => ({ name: `uses ${tool}`, ok: (r) => r.trace.some((t) => t.tool === tool) || (tool === 'start_computer_task' && r.computerStarted) });
const says = (re: RegExp, name = `says ${re}`): Check => ({ name, ok: (r) => re.test(r.answer) });
const never = (re: RegExp, name = `never ${re}`): Check => ({ name, ok: (r) => !re.test(r.answer) });
const noGender = never(/\b(?:she|he|her|his|him)\b/i, 'assumes no gender');
const noFakeSend = never(/\b(?:text|message|email) (?:was|has been) sent\b|\bI(?:'ve| have) sent\b/i, 'never claims it sent');
const answered: Check = { name: 'answers', ok: (r) => r.answer.trim().length > 0 };

const CASES: Case[] = [
  { question: 'can you login to restore 365 and tell me what active jobs do we have right now', checks: [used('start_computer_task')] },
  { question: 'can you tell me how many jobs we have going in restore 365', checks: [used('start_computer_task')] },
  {
    question: 'can you send test@example.invalid an update on the latest of what is happening on this job',
    checks: [used('start_computer_task'), noFakeSend],
  },
  { question: 'can you tell me the score of the brewers game lastnight', needsWeb: true, checks: [used('web_search'), answered] },
  { question: 'whos going to win the ball game', needsWeb: true, checks: [used('web_search'), answered] },
  { question: 'What happened on this job?', checks: [says(/supply line|laundry/i), noGender] },
  { question: 'list the materials for this job', checks: [says(/dehumidifier/i), says(/air mover/i)] },
  { question: 'compare day 1 to day 2', checks: [says(/41|forty.one/i), says(/pad/i)] },
  { question: 'what is the claim number?', checks: [says(/CLM-88412/)] },
  { question: 'who is the client?', checks: [says(/Pat Henderson/)] },
  { question: 'How many videos are on this job?', checks: [says(/\b(?:2|two)\b/i)] },
  { question: 'give me one exact quote from the walkthrough', checks: [says(/“[^”]{10,}”/, 'keeps an exact quote')] },
  { question: 'Is there a QuickBooks quote on file for this job?', checks: [says(/\b(?:no|not|isn't|doesn't|don't)\b/i, 'says it is not on file'), never(/\$\s?\d/, 'invents no price')] },
  { question: 'What dollar amount or deadline was promised for the roof work?', checks: [never(/\$\s?\d/, 'invents no price'), answered] },
  { question: 'Who is the homeowner and what did they say they were upset about?', checks: [says(/Pat/), noGender] },
  { question: 'is 41% on drywall dry? what should it read before we close it up?', checks: [says(/general|typically|usually|IICRC|dry standard|reference/i, 'gives general guidance'), answered] },
  { question: 'draft a short homeowner update', checks: [says(/⟦artifact⟧/, 'writes a draft'), noGender, { name: 'thinks harder', ok: (r) => r.escalated }] },
  { question: 'text Pat that we will be there at 3 tomorrow to check the readings', checks: [used('send_job_sms'), noFakeSend] },
  {
    question: 'Computer finished: restore365.net: job counts checked',
    turnContext: COMPUTER_RESULTS,
    checks: [says(/341/), never(/start_computer_task/)],
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is not set');
  const minPass = Number(process.env.EVAL_MIN_PASS ?? '0.9');
  const web = isAskWebSearchConfigured();
  const rows: string[] = [];
  let passed = 0;
  let total = 0;
  let cost = 0;
  for (const c of CASES) {
    if (c.needsWeb && !web) {
      rows.push(`| ${c.question} | skipped (no web search key) | | |`);
      continue;
    }
    const started = Date.now();
    let first: number | null = null;
    const actions: string[] = [];
    const result = await runAskAgent({
      question: c.question,
      catalog,
      jobFileRecord: record,
      turnContext: c.turnContext ?? null,
      onToken: (t) => {
        if (t && first === null) first = Date.now();
      },
      webSearch: (query, includeDomains) => searchAskWebDetailed(query, { limit: 5, includeDomains, timeZone: 'America/Chicago' }),
      actions: {
        tools: askModelActionTools('org'),
        run: async (name, input) => {
          actions.push(name);
          return { ok: true, tool: name, summary: `Card ready for ${JSON.stringify(input).slice(0, 120)}. Nothing has been sent; they press Send on the card.` };
        },
      },
      computer: async (args) => `Starting Computer: ${args.instructions}`,
    });
    const failed = c.checks.filter((check) => !check.ok(result, actions)).map((check) => check.name);
    total += 1;
    if (!failed.length) passed += 1;
    const usd = costOf(result);
    cost += usd;
    const ms = Date.now() - started;
    console.log(`\n=== ${failed.length ? 'FAIL' : 'pass'}: ${c.question}`);
    console.log(
      `model=${result.model} escalated=${result.escalated} total=${ms}ms firstWord=${first ? first - started : 'n/a'}ms tools=[${result.trace.map((t) => t.tool).join(', ')}${result.computerStarted ? ' start_computer_task' : ''}] $${usd.toFixed(4)}`,
    );
    if (failed.length) console.log(`failed: ${failed.join('; ')}`);
    console.log(`---\n${result.answer.slice(0, 1500)}`);
    rows.push(
      `| ${c.question.replace(/\|/g, '/')} | ${failed.length ? `FAIL: ${failed.join('; ')}` : 'pass'} | ${result.escalated ? 'deep' : 'fast'} | ${(ms / 1000).toFixed(1)}s |`,
    );
  }
  const rate = total ? passed / total : 0;
  const summary = [
    `### Chat eval: ${passed}/${total} passed (${Math.round(rate * 100)}%), about $${cost.toFixed(2)}`,
    '',
    '| Question | Result | Model | Time |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (rate < minPass) {
    console.error(`Pass rate ${Math.round(rate * 100)}% is under ${Math.round(minPass * 100)}%.`);
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
