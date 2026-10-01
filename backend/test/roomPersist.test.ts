import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillClipRooms, refreshClipRooms } from '../src/shared/roomPersist.js';

type Row = Record<string, unknown>;

function adminDouble(seed: {
  proof: Row;
  locations?: Row[];
  segments?: Row[];
  refreshError?: string;
}) {
  const calls: Array<{ op: string; table?: string; rows?: unknown; fn?: string; args?: unknown }> = [];
  const from = (table: string) => {
    let selectCols = '';
    const api: Record<string, unknown> = {};
    const chain = () => api;
    api.select = (cols?: string) => {
      selectCols = cols ?? '';
      return chain();
    };
    api.eq = chain;
    api.is = chain;
    api.in = chain;
    api.not = chain;
    api.order = chain;
    api.limit = chain;
    api.update = (patch: unknown) => {
      calls.push({ op: 'update', table, rows: patch });
      return chain();
    };
    api.delete = () => {
      calls.push({ op: 'delete', table });
      return chain();
    };
    api.insert = (rows: unknown) => {
      calls.push({ op: 'insert', table, rows });
      return Promise.resolve({ data: null, error: null });
    };
    api.maybeSingle = () => {
      if (table === 'job_proofs') return Promise.resolve({ data: seed.proof, error: null });
      if (table === 'job_locations') {
        return Promise.resolve({ data: { id: 'loc-primary', match_traits: ['vanity'] }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    api.then = (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) => {
      let data: unknown = [];
      if (table === 'job_locations' && selectCols.includes('room_key')) data = seed.locations ?? [];
      if (table === 'clip_room_segments' && selectCols.includes('analysis_fingerprint')) data = seed.segments ?? [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return api;
  };
  return {
    calls,
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ op: 'rpc', fn, args });
      if (fn === 'proofs_awaiting_room_backfill') {
        return { data: [{ id: String(seed.proof.id) }], error: seed.refreshError ? { message: seed.refreshError } : null };
      }
      return { data: null, error: null };
    },
  };
}

const proof = {
  id: 'proof-1',
  org_id: 'org-1',
  job_id: 'job-1',
  title: 'Later bath',
  work_date: '2026-09-08',
  phase: 'during',
  duration_seconds: 12,
  actions: [{ atSeconds: 2, room: 'bathroom', action: 'remove', description: 'Removes the old vanity.' }],
  narration: null,
  ai_findings: {
    roomSegments: [{ startSec: 0, endSec: 12, room: 'bathroom', confidence: 0.8 }],
    actions: [{ atSeconds: 2, room: 'bathroom', action: 'remove', description: 'Removes the old vanity.' }],
  },
  transcript_text: null,
  transcript_segments: null,
};

test('a later generic bathroom reuses the job primary room and writes segments atomically', async () => {
  const admin = adminDouble({
    proof,
    locations: [{ room_key: 'bathroom::primary', match_traits: ['vanity'] }],
  });
  const result = await refreshClipRooms(admin as never, 'proof-1', 'analysis');
  assert.equal(result.written, true);
  const inserted = admin.calls.find((call) => call.op === 'insert' && call.table === 'clip_room_segments');
  const rows = inserted?.rows as Array<{ room_key: string; location_id: string | null; room_name: string }>;
  const bath = rows.find((row) => row.room_key.startsWith('bathroom'));
  assert.ok(bath);
  assert.equal(bath!.room_key, 'bathroom::primary');
  assert.equal(bath!.room_name, 'primary bathroom');
  assert.equal(bath!.location_id, 'loc-primary');
  const rpc = admin.calls.find((call) => call.fn === 'set_proof_room_segments');
  assert.ok(rpc);
  const bounds = (rpc!.args as { p_segments: Array<{ room: string }> }).p_segments;
  assert.ok(bounds.some((bound) => bound.room === 'primary bathroom'));
  assert.equal(admin.calls.some((call) => call.op === 'update' && call.table === 'job_proofs'), false);
});

test('a user-corrected clip is not rewritten', async () => {
  const admin = adminDouble({
    proof,
    locations: [{ room_key: 'bathroom::primary', match_traits: ['vanity'] }],
    segments: [{ analysis_fingerprint: 'old', user_corrected: true }],
  });
  const result = await refreshClipRooms(admin as never, 'proof-1', 'backfill');
  assert.equal(result.skipped, true);
  assert.equal(result.written, false);
  assert.equal(admin.calls.some((call) => call.fn === 'set_proof_room_segments'), false);
});

test('a full page of failing clips does not block the clips after them', async () => {
  const page = 50;
  const failing = Array.from({ length: page }, (_, index) => ({
    id: `fail-${String(index).padStart(2, '0')}`,
    created_at: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  }));
  const good = [
    { id: 'good-1', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 'good-2', created_at: '2026-01-02T00:01:00.000Z' },
  ];
  const queue = [...failing, ...good];
  const calls: Array<{ fn?: string; args?: Record<string, unknown> }> = [];
  const from = (table: string) => {
    let idFilter = '';
    const api: Record<string, unknown> = {};
    const chain = () => api;
    api.select = chain;
    api.eq = (column: string, value: unknown) => {
      if (column === 'id') idFilter = String(value);
      return chain();
    };
    api.is = chain;
    api.in = chain;
    api.not = chain;
    api.order = chain;
    api.limit = chain;
    api.update = chain;
    api.delete = chain;
    api.insert = () => Promise.resolve({ data: null, error: null });
    api.maybeSingle = () => {
      if (table === 'job_proofs' && idFilter.startsWith('fail-')) {
        return Promise.resolve({ data: null, error: { message: `failed ${idFilter}` } });
      }
      if (table === 'job_proofs') return Promise.resolve({ data: { ...proof, id: idFilter }, error: null });
      if (table === 'job_locations') {
        return Promise.resolve({ data: { id: 'loc-primary', match_traits: ['vanity'] }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    api.then = (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) => {
      const data = table === 'job_locations' ? [{ room_key: 'bathroom::primary', match_traits: ['vanity'] }] : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return api;
  };
  const admin = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn !== 'proofs_awaiting_room_backfill') return { data: null, error: null };
      const afterAt = args.p_after == null ? '' : String(args.p_after);
      const afterId = args.p_after_id == null ? '' : String(args.p_after_id);
      const start = queue.findIndex((row) => {
        if (!afterAt) return true;
        if (row.created_at > afterAt) return true;
        return row.created_at === afterAt && row.id > afterId;
      });
      const fromIndex = start < 0 ? queue.length : start;
      const limit = Number(args.p_limit);
      return { data: queue.slice(fromIndex, fromIndex + limit), error: null };
    },
  };
  const result = await backfillClipRooms(admin as never, { apply: true, limit: page + good.length });
  assert.equal(result.failed, page);
  assert.equal(result.written, good.length);
  assert.equal(result.skipped, 0);
  assert.deepEqual(
    result.failures.map((failure) => failure.id),
    failing.map((row) => row.id),
  );
  const pages = calls.filter((call) => call.fn === 'proofs_awaiting_room_backfill');
  assert.equal(pages[0]?.args?.p_after, null);
  assert.equal(pages[1]?.args?.p_after_id, failing[page - 1]!.id);
  const written = calls.filter((call) => call.fn === 'set_proof_room_segments').map((call) => call.args?.p_proof_id);
  assert.deepEqual(written, ['good-1', 'good-2']);
});

test('a dry run lists awaiting clips once and does not write', async () => {
  const admin = adminDouble({ proof });
  const result = await backfillClipRooms(admin as never, { apply: false, limit: 50 });
  assert.equal(result.scanned, 1);
  assert.equal(result.written, 0);
  assert.equal(admin.calls.filter((call) => call.fn === 'proofs_awaiting_room_backfill').length, 1);
  assert.equal(admin.calls.some((call) => call.op === 'insert'), false);
});
