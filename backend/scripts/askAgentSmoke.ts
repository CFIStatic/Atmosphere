/**
 * Live check of the new single-agent job Chat on a made-up job (no customer
 * data). Runs a handful of real questions against the real models and prints
 * each answer, the tools it used, time to first word, total time, and token
 * use, including prompt-cache reads on follow-up questions.
 *
 *   ANTHROPIC_API_KEY=… npx tsx scripts/askAgentSmoke.ts
 *
 * Costs a few cents. Texts are never sent: the action tool is a stub.
 */
import { runAskAgent } from '../src/shared/askAgent.js';
import { askModelActionTools } from '../src/shared/askTools.js';
import { searchAskWebDetailed } from '../src/shared/askWebSearch.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';

const catalog: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Henderson basement water loss',
  jobAddress: '2418 N Prospect Ave, Milwaukee, WI 53211',
  clientName: 'Pat Henderson (homeowner, 414-555-0142)',
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

const QUESTIONS = [
  'what happened on this job so far?',
  'what did they say about dehumidifiers?',
  'is 41% on drywall dry? what should it read before we close it up?',
  'what is the weather in Milwaukee tomorrow?',
  'text Pat that we will be there at 3 tomorrow to check the readings',
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is not set');
  const history: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  let failures = 0;
  for (const question of QUESTIONS) {
    const started = Date.now();
    let firstAt: number | null = null;
    const statuses: string[] = [];
    const actions: string[] = [];
    const result = await runAskAgent({
      question,
      catalog,
      jobFileRecord: record,
      history,
      onToken: (t) => {
        if (t && firstAt === null) firstAt = Date.now();
      },
      onStatus: (s) => statuses.push(s),
      webSearch: (query, includeDomains) =>
        searchAskWebDetailed(query, { limit: 5, includeDomains, timeZone: 'America/Chicago' }),
      actions: {
        tools: askModelActionTools('org'),
        run: async (name, input) => {
          actions.push(`${name} ${JSON.stringify(input)}`);
          return {
            ok: true,
            tool: name,
            summary: 'Card shown to the person. Nothing has been sent; they press Send on the card.',
          };
        },
      },
      computer: async (args) => `[Computer would start: ${args.instructions}]`,
    });
    const u = result.usage;
    const ms = Date.now() - started;
    console.log(`\n=== ${question}`);
    console.log(
      `model=${result.model} total=${ms}ms firstWord=${firstAt ? firstAt - started : 'n/a'}ms tools=[${result.trace.map((t) => t.tool).join(', ')}]`,
    );
    if (u) {
      console.log(
        `tokens in=${u.inputTokens} out=${u.outputTokens} cacheWrite=${u.cacheWrite5mTokens + u.cacheWrite1hTokens} cacheRead=${u.cacheReadTokens}`,
      );
    }
    if (actions.length) console.log(`actions: ${actions.join(' | ')}`);
    console.log(`---\n${result.answer}`);
    if (!result.answer.trim()) failures += 1;
    history.push({ role: 'user', text: question }, { role: 'assistant', text: result.answer });
  }
  if (failures) {
    console.error(`${failures} question(s) got no answer`);
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
