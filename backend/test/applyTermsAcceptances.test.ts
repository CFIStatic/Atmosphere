import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../scripts/applyTermsAcceptances.mjs'), 'utf8');
const sql = readFileSync(
  join(here, '../supabase/migrations/20260907200000_terms_acceptances_grants.sql'),
  'utf8',
);
const store = readFileSync(join(here, '../src/legal/termsStore.ts'), 'utf8');

describe('terms_acceptances apply script', () => {
  it('applies the grants repair migration', () => {
    assert.match(script, /20260907200000_terms_acceptances_grants\.sql/);
    assert.match(sql, /grant all on table public\.terms_acceptances to service_role/);
    assert.match(sql, /grant select, insert, update on table public\.terms_acceptances to authenticated/);
    assert.match(sql, /terms_acceptances_self_update/);
  });

  it('writes acceptances with the service_role admin client, not the user JWT', () => {
    assert.match(store, /unscopedAdminOrNull/);
    assert.match(store, /function termsAdmin/);
    assert.doesNotMatch(store, /from '\.\.\/lib\/supabase/);
  });
});
