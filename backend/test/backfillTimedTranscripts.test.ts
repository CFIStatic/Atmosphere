import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TIMED_TRANSCRIPT_BACKFILL_BOOT_DELAY_MS,
  backfillTimedTranscripts,
  scheduleTimedTranscriptBackfill,
  timedTranscriptBackfillOnBootEnabled,
} from '../src/lib/backfillTimedTranscripts.js';

function asAdmin(admin: unknown): SupabaseClient {
  return admin as SupabaseClient;
}

test('timed transcript backfill is on unless the env var is exactly 0', () => {
  assert.equal(timedTranscriptBackfillOnBootEnabled({}), true);
  assert.equal(timedTranscriptBackfillOnBootEnabled({ PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT: '0' }), false);
  assert.equal(timedTranscriptBackfillOnBootEnabled({ PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT: '1' }), true);
  assert.equal(TIMED_TRANSCRIPT_BACKFILL_BOOT_DELAY_MS, 60_000);
});

test('backfill re-transcribes only rows missing word timings, one at a time', async () => {
  const seen: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const filters: Array<Record<string, unknown>> = [];
  const admin = {
    from() {
      const query: Record<string, unknown> = {};
      const chain = {
        select() {
          return chain;
        },
        is(column: string, value: unknown) {
          filters.push({ op: 'is', column, value });
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.push({ op: 'eq', column, value });
          return chain;
        },
        not(column: string, op: string, value: unknown) {
          filters.push({ op: 'not', column, cmp: op, value });
          return chain;
        },
        order() {
          return chain;
        },
        range() {
          return Promise.resolve({
            data: [{ id: 'needs-words' }, { id: 'also-needs' }],
            error: null,
          });
        },
        update(row: Record<string, unknown>) {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
      Object.assign(query, chain);
      return chain;
    },
  };

  const result = await backfillTimedTranscripts(asAdmin(admin), {
    gapMs: 0,
    async transcribe(_client, id) {
      seen.push(id);
      if (id === 'also-needs') throw new Error('whisper down');
    },
  });

  assert.deepEqual(seen, ['needs-words', 'also-needs']);
  assert.equal(result.checked, 2);
  assert.equal(result.done, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0]?.id, 'also-needs');
  assert.match(result.failures[0]?.reason ?? '', /whisper down/);
  assert.equal(updates.some((row) => row.transcript_status === 'done'), true);
  assert.equal(filters.some((row) => row.op === 'is' && row.column === 'transcript_words' && row.value === null), true);
});

test('scheduleTimedTranscriptBackfill waits about a minute and does not throw', async () => {
  let delay = -1;
  const lines: string[] = [];
  const armed = scheduleTimedTranscriptBackfill({
    env: {},
    setTimer(fire, delayMs) {
      delay = delayMs;
      return fire();
    },
    getAdmin: () => null,
    log(line) {
      lines.push(line);
    },
  });
  assert.equal(armed, true);
  assert.equal(delay, 60_000);
  assert.match(lines.join('\n'), /no admin client/);
  assert.equal(scheduleTimedTranscriptBackfill({ env: { PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT: '0' } }), false);
});
