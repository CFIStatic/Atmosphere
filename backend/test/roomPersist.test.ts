import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshClipRooms } from '../src/shared/roomPersist.js';

const proof = {
  id: 'g',
  org_id: 'org',
  job_id: 'job',
  title: 'Later bath',
  work_date: '2026-09-04',
  phase: 'after',
  duration_seconds: 10,
  actions: [
    { atSeconds: 1, room: 'bathroom', action: 'inspect', description: 'Looks at the vanity.' },
  ],
  narration: null,
  ai_findings: {
    people: { count: 1 },
    privacyRedactions: { ranges: [{ startSec: 1, endSec: 2 }] },
  },
  transcript_text: null,
  transcript_segments: null,
};

const sibling = {
  id: 'p',
  title: 'Primary',
  work_date: '2026-09-01',
  phase: 'before',
  duration_seconds: 10,
  actions: [
    {
      atSeconds: 1,
      room: 'primary bathroom',
      action: 'inspect',
      description: 'Vanity on the north wall.',
    },
  ],
  narration: null,
  ai_findings: {},
  transcript_text: null,
  transcript_segments: null,
};

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: {
    select: () => typeof builder;
    eq: () => typeof builder;
    neq: () => typeof builder;
    is: () => typeof builder;
    insert: () => typeof builder;
    update: () => typeof builder;
    delete: () => typeof builder;
    maybeSingle: () => Promise<typeof result>;
    single: () => Promise<typeof result>;
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    neq() {
      return builder;
    },
    is() {
      return builder;
    },
    insert() {
      return builder;
    },
    update() {
      return builder;
    },
    delete() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    single() {
      return Promise.resolve(result);
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

test('room refresh folds a later bathroom into the job room and does not rewrite findings', async () => {
  const locationKeys: string[] = [];
  const segmentKeys: string[] = [];
  const findingWrites: unknown[] = [];
  const rpcCalls: unknown[] = [];
  let jobProofCalls = 0;
  let inside = 0;
  let maxInside = 0;

  const admin = {
    from(table: string) {
      if (table === 'job_proofs') {
        const call = jobProofCalls;
        jobProofCalls += 1;
        const isRow = call % 2 === 0;
        const builder = query({ data: isRow ? proof : [sibling], error: null });
        if (isRow) {
          const read = builder.maybeSingle.bind(builder);
          builder.maybeSingle = async () => {
            inside += 1;
            maxInside = Math.max(maxInside, inside);
            await new Promise((resolve) => setTimeout(resolve, 15));
            return read();
          };
          const update = builder.update.bind(builder);
          builder.update = (payload?: unknown) => {
            findingWrites.push(payload);
            return update();
          };
        }
        return builder;
      }
      if (table === 'job_locations') {
        const builder = query({ data: { id: 'loc-primary' }, error: null });
        builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
        const insert = builder.insert.bind(builder);
        builder.insert = (payload?: { room_key?: string }) => {
          if (payload?.room_key) locationKeys.push(payload.room_key);
          return insert();
        };
        return builder;
      }
      if (table === 'clip_room_segments') {
        const builder = query({ data: [], error: null });
        const insert = builder.insert.bind(builder);
        builder.insert = (rows?: Array<{ room_key?: string }>) => {
          for (const row of rows ?? []) {
            if (row.room_key) segmentKeys.push(row.room_key);
          }
          return insert();
        };
        return builder;
      }
      return query({ data: null, error: null });
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      assert.equal(fn, 'set_proof_room_segments');
      rpcCalls.push(args);
      inside -= 1;
      return { error: null };
    },
  };

  const [first, second] = await Promise.all([
    refreshClipRooms(admin, 'g', 'analysis'),
    refreshClipRooms(admin, 'g', 'analysis'),
  ]);
  assert.equal(first.written, true);
  assert.equal(second.written, true);
  assert.equal(maxInside, 1);
  assert.deepEqual(locationKeys, ['bathroom::primary', 'bathroom::primary']);
  assert.ok(segmentKeys.every((key) => key === 'bathroom::primary'));
  assert.equal(segmentKeys.length, 2);
  assert.equal(findingWrites.length, 0);
  assert.equal(rpcCalls.length, 2);
  assert.equal((rpcCalls[0] as { p_proof_id?: string }).p_proof_id, 'g');
});
