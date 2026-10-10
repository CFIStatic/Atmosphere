#!/usr/bin/env bash
#
# Duplicate copies the whole job file (20261010200100_duplicate_job_file_contents),
# on a database that has every migration applied (`npm run migrate:manifest`),
# in a rolled-back transaction:
#
#   - videos, frames, transcripts, speakers, rooms, Chat threads, answers, pins,
#     documents, brief revisions, scope, parties and messages are copied
#   - every reference inside the copy (foreign keys, uuid arrays, ids inside
#     jsonb such as Chat citations) points at the copy, never the original
#   - stored objects are shared (same storage paths)
#   - not copied: party access tokens, homeowner share threads, deleted clips,
#     legal holds, the chain of custody (replaced by one 'duplicated' entry)
#   - the original is untouched apart from its 'duplicated' custody entries
#   - members cannot call the function; it refuses a target that is not empty
#
# Usage:  DUP_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/14_duplicate_job_file.sh [psql-connection-args...]
#
set -euo pipefail

DB="${DUP_TEST_DB:-atmosphere_migration_manifest}"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -d "$DB")

"${PSQL[@]}" >/dev/null <<'SQL'
\set QUIET on
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

insert into auth.users (id, email) values
  ('0e000000-0000-4000-8000-000000001401', 'office14@test.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('0e000000-0000-4000-8000-000000001401', 'office14@test.invalid')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-000000001400', 'TEST Org 14', 'TEST-A-14');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('a0000000-0000-4000-8000-000000001400', '0e000000-0000-4000-8000-000000001401', 'employee', 'mitigation')
on conflict do nothing;

-- Source job file -----------------------------------------------------------
insert into public.crm_jobs (id, org_id, work_type, title) values
  ('c0000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'mitigation', 'Cedar Ridge'),
  ('c0000000-0000-4000-8000-000000001401', 'a0000000-0000-4000-8000-000000001400', 'mitigation', 'Copy of Cedar Ridge');

insert into public.job_parties (id, org_id, job_id, company, role, access_token, invited_at, last_seen_at) values
  ('d1000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   'Dry Crew', 'subcontractor', 'source-token-14', now(), now());

insert into public.job_locations (id, org_id, job_id, parent_id, kind, name) values
  ('d2000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', null, 'floor', 'First floor'),
  ('d2000000-0000-4000-8000-000000001401', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd2000000-0000-4000-8000-000000001400', 'room', 'Kitchen');

insert into public.job_briefs (org_id, job_id, revision, facts, note) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 1, '{"loss":"pipe"}', 'first'),
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 2, '{"loss":"pipe burst"}', 'second');
insert into public.job_scope_items (org_id, job_id, party_id, title, revision) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd1000000-0000-4000-8000-000000001400', 'Remove drywall', 2);
insert into public.job_messages (org_id, job_id, party_id, author_label, body) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd1000000-0000-4000-8000-000000001400', 'Dry Crew', 'On site');

insert into public.job_proofs (id, org_id, job_id, party_id, work_date, phase, storage_path, clip_id,
                               ai_summary, ai_findings, transcript_text, legal_hold, hold_reason) values
  ('d3000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   'd1000000-0000-4000-8000-000000001400', '2026-10-01', 'before', 'org/job/before.mp4', 'clip-14-a',
   'Wet drywall in the kitchen', '{"proofId":"d3000000-0000-4000-8000-000000001400"}', 'hello', true, 'claim');
insert into public.job_proofs (id, org_id, job_id, party_id, work_date, phase, storage_path, deleted_at) values
  ('d3000000-0000-4000-8000-000000001401', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   'd1000000-0000-4000-8000-000000001400', '2026-10-01', 'after', 'org/job/deleted.mp4', now());
insert into public.job_proof_frames (org_id, proof_id, at_seconds, storage_path) values
  ('a0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400', 1, 'org/job/before-1.jpg'),
  ('a0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001401', 1, 'org/job/deleted-1.jpg');
insert into public.ask_transcript_chunks (org_id, job_id, proof_id, seq, text, speaker_label, transcript_sha256) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400', 0, 'hello', 'A', 'sha');
insert into public.speaker_identities (org_id, job_id, proof_id, speaker_label, display_name, status, method) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400', 'A', 'Sam', 'confirmed', 'user');
insert into public.clip_room_segments (org_id, job_id, proof_id, location_id, sequence_index, room_name, room_key, start_seconds, end_seconds) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400',
   'd2000000-0000-4000-8000-000000001401', 0, 'Kitchen', 'kitchen', 0, 5);

insert into public.job_chat_documents (id, org_id, job_id, attached_at, filename, media_type, byte_size, content_hash, storage_path) values
  ('d4000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', now(),
   'estimate.pdf', 'application/pdf', 10, 'h', 'docs/estimate.pdf');
insert into public.ask_document_chunks (org_id, document_id, job_id, seq, location, text) values
  ('a0000000-0000-4000-8000-000000001400', 'd4000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 0, 'p1', 'line items');

insert into public.verifier_shares (id, org_id, job_id, label) values
  ('d5000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'Homeowner');
insert into public.ask_threads (id, org_id, job_id, owner_user_id, share_id, title) values
  ('d6000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   '0e000000-0000-4000-8000-000000001401', null, 'Office chat'),
  ('d6000000-0000-4000-8000-000000001401', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   null, 'd5000000-0000-4000-8000-000000001400', 'Homeowner chat');
insert into public.job_proof_questions (id, org_id, job_id, thread_id, question, answer, grounded_on, document_ids) values
  ('d7000000-0000-4000-8000-000000001400', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   'd6000000-0000-4000-8000-000000001400', 'What is wet?', 'The kitchen drywall.',
   '[{"proofId":"d3000000-0000-4000-8000-000000001400","t":3}]', '{d4000000-0000-4000-8000-000000001400}'),
  ('d7000000-0000-4000-8000-000000001401', 'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
   'd6000000-0000-4000-8000-000000001401', 'Homeowner question', 'Answer', '[]', '{}');
update public.ask_threads set summary_through_question_id = 'd7000000-0000-4000-8000-000000001400'
  where id = 'd6000000-0000-4000-8000-000000001400';
insert into public.ask_pinned_answers (org_id, job_id, question_id) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd7000000-0000-4000-8000-000000001400');

insert into public.job_evidence_access (org_id, job_id, proof_id, action, actor_label) values
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400', 'uploaded', 'Dry Crew'),
  ('a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400', 'd3000000-0000-4000-8000-000000001400', 'viewed', 'Office');

-- Members cannot call it -----------------------------------------------------
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.duplicate_job_file_contents(uuid, uuid, uuid, uuid, text)', 'execute'), 'members cannot call it');
select pg_temp.expect(has_function_privilege('service_role',
  'public.duplicate_job_file_contents(uuid, uuid, uuid, uuid, text)', 'execute'), 'the server can call it');

-- Duplicate ------------------------------------------------------------------
create temp table result as
select public.duplicate_job_file_contents(
  'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
  'c0000000-0000-4000-8000-000000001401', '0e000000-0000-4000-8000-000000001401', 'Office') as counts;
\set T '''c0000000-0000-4000-8000-000000001401'''
\set S '''c0000000-0000-4000-8000-000000001400'''

select pg_temp.expect((select count(*) = 1 from job_parties where job_id = :T), 'party copied');
select pg_temp.expect((select access_token <> 'source-token-14' and invited_at is null and last_seen_at is null
  from job_parties where job_id = :T), 'party gets a fresh access token, not the original link');
select pg_temp.expect((select count(*) = 2 from job_briefs where job_id = :T), 'every brief revision copied');
select pg_temp.expect((select array_agg(revision order by revision) = '{1,2}' from job_briefs where job_id = :T), 'revisions kept');
select pg_temp.expect((select p.job_id = :T from job_scope_items i join job_parties p on p.id = i.party_id where i.job_id = :T),
  'scope line points at the copied party');
select pg_temp.expect((select count(*) = 1 from job_messages where job_id = :T), 'messages copied');
select pg_temp.expect((select c.job_id = :T from job_locations c join job_locations p on p.id = c.parent_id
  where c.job_id = :T and c.name = 'Kitchen'), 'room nesting follows the copy');

select pg_temp.expect((select count(*) = 1 from job_proofs where job_id = :T), 'live video copied, deleted one not');
select pg_temp.expect((select storage_path = 'org/job/before.mp4' and ai_summary = 'Wet drywall in the kitchen'
  and transcript_text = 'hello' and clip_id is null and not legal_hold and hold_reason is null
  and id <> 'd3000000-0000-4000-8000-000000001400' from job_proofs where job_id = :T),
  'video shares its stored file and keeps AI results; no clip id or legal hold');
select pg_temp.expect((select ai_findings ->> 'proofId' = id::text from job_proofs where job_id = :T),
  'ids inside jsonb point at the copy');
select pg_temp.expect((select count(*) = 1 from job_proof_frames f join job_proofs p on p.id = f.proof_id where p.job_id = :T),
  'frames of the live video copied only');
select pg_temp.expect((select count(*) = 1 from ask_transcript_chunks c join job_proofs p on p.id = c.proof_id
  where c.job_id = :T and p.job_id = :T), 'transcript copied onto the copied video');
select pg_temp.expect((select display_name = 'Sam' from speaker_identities s join job_proofs p on p.id = s.proof_id
  where s.job_id = :T and p.job_id = :T), 'speaker names copied');
select pg_temp.expect((select l.job_id = :T from clip_room_segments r join job_locations l on l.id = r.location_id
  where r.job_id = :T), 'room segments point at the copied room');

select pg_temp.expect((select count(*) = 1 from job_chat_documents where job_id = :T and storage_path = 'docs/estimate.pdf'),
  'document copied, sharing its stored file');
select pg_temp.expect((select count(*) = 1 from ask_document_chunks c join job_chat_documents d on d.id = c.document_id
  where d.job_id = :T), 'document text copied');

select pg_temp.expect((select count(*) = 1 from ask_threads where job_id = :T and title = 'Office chat'),
  'office chat copied, homeowner share chat not');
select pg_temp.expect((select count(*) = 1 from job_proof_questions where job_id = :T), 'only the office answer copied');
select pg_temp.expect((select t.job_id = :T and t.summary_through_question_id = q.id
  from job_proof_questions q join ask_threads t on t.id = q.thread_id where q.job_id = :T),
  'answer sits in the copied thread, and the thread summary points at the copied answer');
select pg_temp.expect((select (q.grounded_on -> 0 ->> 'proofId')::uuid = p.id and q.document_ids[1] = d.id
  from job_proof_questions q, job_proofs p, job_chat_documents d
  where q.job_id = :T and p.job_id = :T and d.job_id = :T), 'citations point at the copied video and document');
select pg_temp.expect((select q.job_id = :T from ask_pinned_answers a join job_proof_questions q on q.id = a.question_id
  where a.job_id = :T), 'pin copied onto the copied answer');

select pg_temp.expect((select count(*) = 0 from job_evidence_access where job_id = :T and action <> 'duplicated'),
  'custody history is not replayed in the copy');
select pg_temp.expect((select count(*) = 2 from job_evidence_access where job_id = :T and action = 'duplicated'),
  'copy records where it came from (job and clip)');
select pg_temp.expect((select count(*) = 4 from job_evidence_access where job_id = :S), 'original records the copy');
select pg_temp.expect((select count(*) = 2 from job_proofs where job_id = :S)
  and (select count(*) = 2 from job_proof_questions where job_id = :S)
  and (select access_token = 'source-token-14' from job_parties where job_id = :S), 'original untouched');
select pg_temp.expect((select (counts ->> 'job_proofs')::int = 1 from result), 'counts returned');

-- Refuses a target with its own file -------------------------------------------
do $$
begin
  perform public.duplicate_job_file_contents(
    'a0000000-0000-4000-8000-000000001400', 'c0000000-0000-4000-8000-000000001400',
    'c0000000-0000-4000-8000-000000001401', null, 'Office');
  raise exception 'FAIL: copied over a non-empty job';
exception when unique_violation then
  raise notice 'ok: refuses a target that is not empty';
end $$;

rollback;
SQL
echo "ok: duplicate job file"
