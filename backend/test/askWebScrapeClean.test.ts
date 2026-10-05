import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_WEB_FORMAT_RULES,
  ASK_WEB_NO_SUMMARY_ANSWER,
  cleanWebScrapeText,
  composeAskWebAnswer,
  formatAskWebContext,
  webSourcesFromHits,
} from '../src/shared/askWebSearch.js';
import { normalizeAskProse, stripScrapeJunk } from '../src/shared/askProse.js';
import { summarizeWebResultsForAsk } from '../src/shared/jobFileAsk.js';

// What Chat showed on the phone on Oct 4: a raw scraped schedule page.
const SCRAPED =
  '#### Sunday, October 4 [...] NY Jets at Bills, TBD Jaguars at Colts, TBD ### WEEK Colts 30, Chiefs 33, FINAL, Sunday, September 20th Final Indianapolis Colts Team LogoCOLTS0-2 Kansas City Chiefs Team LogoCHIEFS2-0 Final Watch Replay ### Week 3 Rams at Broncos, Sunday, September 27th [...]';
const HITS = [{ title: 'NFL Schedule', url: 'https://www.nfl.com/schedules/', snippet: SCRAPED }];

test('a raw result snippet is never the Chat answer', () => {
  const answer = composeAskWebAnswer({ question: 'what nfl games are on today', webAnswer: '', hits: HITS });
  assert.equal(answer, ASK_WEB_NO_SUMMARY_ANSWER);
  assert.doesNotMatch(answer, /Team Logo|Watch Replay|#|\[\.\.\.\]|Colts/);
});

test("the provider's written answer is still used, cleaned", () => {
  const answer = composeAskWebAnswer({
    question: 'what nfl games are on today',
    webAnswer: '### Today: Jets at Bills [...] and Jaguars at Colts.',
    hits: HITS,
  });
  assert.equal(answer, 'Today: Jets at Bills and Jaguars at Colts.');
});

test('web text the model and the sources list see has no scrape furniture', () => {
  const cleaned = cleanWebScrapeText(SCRAPED).replace(/\s+/g, ' ');
  assert.doesNotMatch(cleaned, /#|\[\.\.\.\]|Team Logo|Watch Replay/);
  assert.match(cleaned, /Indianapolis Colts 0-2 Kansas City Chiefs 2-0/);
  const context = formatAskWebContext(HITS);
  assert.doesNotMatch(context, /#|\[\.\.\.\]|Team Logo|Watch Replay/);
  const [source] = webSourcesFromHits(HITS);
  assert.doesNotMatch(source?.snippet ?? '', /#|\[\.\.\.\]|Team Logo|Watch Replay/);
  assert.match(ASK_WEB_FORMAT_RULES, /Never paste or stitch together result text/);
  assert.match(ASK_WEB_FORMAT_RULES, /No markdown headings/);
});

test('answer prose: mid-line headings, elisions and site labels are dropped', () => {
  const clean = normalizeAskProse(SCRAPED);
  // Only a real line-start heading is left, which the Chat renders as a title.
  assert.match(clean, /^#### Sunday, October 4 NY Jets at Bills/);
  assert.doesNotMatch(clean.replace(/^#{1,6} /gm, ''), /#|\[\.\.\.\]|Team Logo|Watch Replay/);
  assert.match(clean, /\n\nWEEK Colts 30/);
  assert.match(clean, /\n\nWeek 3 Rams at Broncos/);
  // Real headings, "#1" and code survive.
  assert.equal(stripScrapeJunk('## Today\n- Jets at Bills'), '## Today\n- Jets at Bills');
  assert.equal(stripScrapeJunk('#1 pick in C#'), '#1 pick in C#');
  assert.equal(stripScrapeJunk('```\na ### b [...]\n```'), '```\na ### b [...]\n```');
  assert.equal(stripScrapeJunk('###Late games'), '### Late games');
});

test('a declined public question gets an answer written from the results', async () => {
  const calls: Array<{ system: string; user: string }> = [];
  const written = await summarizeWebResultsForAsk({
    question: 'what nfl games are on today',
    hits: HITS,
    webAnswer: '',
    complete: (async (input: { system: string; user: string }) => {
      calls.push(input);
      return {
        text: "Today's late games are **Jets at Bills** and Jaguars at Colts; kickoff times are still TBD. Let me know if you need more!",
        model: 'test-model',
        usage: null,
      };
    }) as never,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.system, /Write the answer yourself/);
  assert.match(calls[0]!.user, /Question: what nfl games are on today/);
  assert.doesNotMatch(calls[0]!.user, /Team Logo|Watch Replay|\[\.\.\.\]/);
  assert.equal(written?.answer, "Today's late games are **Jets at Bills** and Jaguars at Colts; kickoff times are still TBD.");
  assert.equal(written?.model, 'test-model');
});

test('no model: the summary step stands aside', async () => {
  const written = await summarizeWebResultsForAsk({
    question: 'what nfl games are on today',
    hits: HITS,
    webAnswer: '',
    complete: (async () => null) as never,
  });
  assert.equal(written, null);
});
