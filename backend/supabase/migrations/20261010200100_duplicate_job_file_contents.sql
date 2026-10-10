-- Duplicate copies the whole job file.
--
-- Before: Duplicate made a new job with the address, the latest brief and the
-- current scope. Videos, transcripts, speakers, AI summaries, Chat, pins and
-- files stayed on the original, so the copy was an empty shell.
--
-- duplicate_job_file_contents() copies every row that makes up the job file
-- from the source job into an already-created target job, in one transaction.
-- New ids are minted for each copied row and every reference between copied
-- rows (foreign keys, uuid columns, uuid arrays and ids inside jsonb such as
-- Chat citations) is rewritten to point at the copy, so the copy works on its
-- own without re-processing.
--
-- Stored video, frame and document objects are shared, not re-uploaded: both
-- jobs' rows point at the same storage paths. The purge sweep only removes an
-- object once no other row still points at it.
--
-- Deliberately not copied:
--   * share links and grants (verifier_shares, job_progress_grants, party
--     field-app claims); parties get fresh access tokens, so the copy needs a
--     fresh invite;
--   * the chain of custody (job_evidence_access): the copy gets one
--     'duplicated' entry per clip naming the original, and the original gets
--     one naming the copy;
--   * live capture sessions, Chat approval cards still waiting, caches and
--     usage/billing rows, daily report send records, Computer tasks and orders,
--     legal holds, and the verification pipeline's internal working rows.

create or replace function private.job_dup_remap_jsonb(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, private, pg_temp
as $$
declare
  v_text text;
  r record;
begin
  if p is null then
    return null;
  end if;
  v_text := p::text;
  for r in
    select distinct m.old_id::text as old_text, m.new_id::text as new_text
    from regexp_matches(
           v_text,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
           'g'
         ) as x(v)
    join pg_temp.job_dup_map m on m.old_id = x.v[1]::uuid
  loop
    v_text := replace(v_text, r.old_text, r.new_text);
  end loop;
  return v_text::jsonb;
end;
$$;

revoke all on function private.job_dup_remap_jsonb(jsonb) from public, anon, authenticated;

create or replace function public.duplicate_job_file_contents(
  p_org_id uuid,
  p_source_job_id uuid,
  p_target_job_id uuid,
  p_actor_id uuid default null,
  p_actor_label text default 'Office'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  -- Copy order: parents before children. "where" picks the source rows ($1 is
  -- the source job). "set" overrides columns: a SQL expression over the source
  -- row `s`, or JSON null to leave the column to its default.
  v_specs jsonb := $specs$[
    {"t": "job_parties", "where": "s.job_id = $1",
     "set": {"access_token": null, "invited_at": "null", "last_seen_at": "null"}},
    {"t": "job_locations", "where": "s.job_id = $1"},
    {"t": "job_briefs", "where": "s.job_id = $1"},
    {"t": "scope_documents", "where": "s.job_id = $1"},
    {"t": "job_scope_items", "where": "s.job_id = $1"},
    {"t": "job_acknowledgements", "where": "s.job_id = $1"},
    {"t": "job_messages", "where": "s.job_id = $1"},
    {"t": "job_tasks", "where": "s.job_id = $1"},
    {"t": "work_logs", "where": "s.job_id = $1"},
    {"t": "job_assignments", "where": "s.job_id = $1"},
    {"t": "job_proofs", "where": "s.job_id = $1 and s.deleted_at is null",
     "set": {"clip_id": "null", "legal_hold": "false", "hold_reason": "null",
             "scheduled_purge_at": "null",
             "narration_lease_owner": "null", "narration_lease_until": "null",
             "transcript_lease_owner": "null", "transcript_lease_until": "null",
             "analysis_lease_owner": "null", "analysis_lease_until": "null",
             "summary_lease_until": "null"}},
    {"t": "job_proof_segments", "where": "s.proof_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "job_proof_frames", "where": "s.proof_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "ask_transcript_chunks", "where": "s.job_id = $1"},
    {"t": "ask_analysis_chunks", "where": "s.job_id = $1"},
    {"t": "speaker_identities", "where": "s.job_id = $1"},
    {"t": "speaker_role_guesses", "where": "s.job_id = $1"},
    {"t": "clip_room_segments", "where": "s.job_id = $1"},
    {"t": "safety_incidents", "where": "s.job_id = $1"},
    {"t": "work_episodes", "where": "s.job_id = $1"},
    {"t": "recording_acknowledgments", "where": "s.job_id = $1"},
    {"t": "job_chat_documents",
     "where": "(s.job_id = $1 or (s.job_id is null and s.context_job_id = $1))"},
    {"t": "ask_document_chunks", "where": "s.document_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "job_document_rooms", "where": "s.job_id = $1"},
    {"t": "ask_threads", "where": "s.job_id = $1 and s.share_id is null"},
    {"t": "job_proof_questions", "where": "s.job_id = $1"},
    {"t": "ask_pinned_answers", "where": "s.job_id = $1"},
    {"t": "ask_answer_feedback", "where": "s.job_id = $1"},
    {"t": "ask_job_notes", "where": "s.job_id = $1 and s.share_id is null"}
  ]$specs$::jsonb;
  v_spec jsonb;
  v_table text;
  v_rel regclass;
  v_tables text[] := '{}';
  v_where text;
  v_cols text[];
  v_exprs text[];
  v_count integer;
  v_counts jsonb := '{}'::jsonb;
  v_source_title text;
  v_target_title text;
  v_target_number bigint;
  c record;
begin
  if p_org_id is null or p_source_job_id is null or p_target_job_id is null
     or p_source_job_id = p_target_job_id then
    raise exception 'duplicate_bad_arguments' using errcode = '22023';
  end if;

  select title into v_source_title
  from public.crm_jobs
  where id = p_source_job_id and org_id = p_org_id;
  if not found then
    raise exception 'duplicate_source_not_found' using errcode = 'P0002';
  end if;

  select title, job_number into v_target_title, v_target_number
  from public.crm_jobs
  where id = p_target_job_id and org_id = p_org_id;
  if not found then
    raise exception 'duplicate_target_not_found' using errcode = 'P0002';
  end if;

  -- Copy into a fresh job only, never on top of one that has its own file.
  if exists (select 1 from public.job_briefs where job_id = p_target_job_id)
     or exists (select 1 from public.job_proofs where job_id = p_target_job_id)
     or exists (select 1 from public.job_proof_questions where job_id = p_target_job_id) then
    raise exception 'duplicate_target_not_empty' using errcode = '23505';
  end if;

  if to_regclass('pg_temp.job_dup_map') is not null then
    drop table pg_temp.job_dup_map;
  end if;
  create temp table job_dup_map (
    old_id uuid primary key,
    new_id uuid not null unique,
    tbl    text not null
  ) on commit drop;
  insert into pg_temp.job_dup_map values (p_source_job_id, p_target_job_id, 'crm_jobs');

  -- Tables this database has (ask_analysis_chunks needs pgvector).
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    if to_regclass('public.' || (v_spec ->> 't')) is not null then
      v_tables := v_tables || (v_spec ->> 't');
    end if;
  end loop;

  -- Pass 1: mint the new ids for every row, so pass 2 can rewrite references
  -- in any direction (a thread's summary points at a later question). A row
  -- whose required parent is not being copied (a question in a homeowner's
  -- share thread, a frame of a deleted clip) is left out.
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    v_table := v_spec ->> 't';
    continue when not v_table = any (v_tables);
    v_rel := ('public.' || v_table)::regclass;
    v_where := v_spec ->> 'where';
    for c in
      select a.attname
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f'
        and k.conrelid = v_rel
        and k.confrelid <> v_rel
        and array_length(k.conkey, 1) = 1
        and k.confrelid::regclass::text = any (v_tables)
    loop
      v_where := v_where || format(
        ' and (s.%1$I is null or s.%1$I in (select old_id from pg_temp.job_dup_map))',
        c.attname
      );
    end loop;
    execute format(
      'insert into pg_temp.job_dup_map (old_id, new_id, tbl)
         select s.id, gen_random_uuid(), %L from %s s where %s',
      v_table, v_rel, v_where
    ) using p_source_job_id;
  end loop;

  -- Pass 2: copy each table's rows under their new ids.
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    v_table := v_spec ->> 't';
    continue when not v_table = any (v_tables);
    v_rel := ('public.' || v_table)::regclass;
    v_cols := '{}';
    v_exprs := '{}';
    for c in
      select
        a.attname,
        format_type(a.atttypid, a.atttypmod) as typ,
        (
          select k.confrelid::regclass::text
          from pg_constraint k
          where k.contype = 'f'
            and k.conrelid = v_rel
            and array_length(k.conkey, 1) = 1
            and k.conkey[1] = a.attnum
          limit 1
        ) as fk_table
      from pg_attribute a
      where a.attrelid = v_rel
        and a.attnum > 0
        and not a.attisdropped
        and a.attgenerated = ''
        and a.attidentity = ''
      order by a.attnum
    loop
      if (v_spec -> 'set') ? c.attname then
        continue when jsonb_typeof(v_spec -> 'set' -> c.attname) = 'null';
        v_cols := v_cols || quote_ident(c.attname);
        v_exprs := v_exprs || (v_spec -> 'set' ->> c.attname);
        continue;
      end if;
      v_cols := v_cols || quote_ident(c.attname);
      if c.attname = 'id' then
        v_exprs := v_exprs || 'm0.new_id'::text;
      elsif c.fk_table = 'crm_jobs' then
        v_exprs := v_exprs || format(
          'case when s.%1$I = $1 then $2 else s.%1$I end', c.attname
        );
      elsif c.fk_table = any (v_tables) then
        -- References inside the job file follow the copy; one that is not
        -- copied (a deleted clip) is cleared rather than left pointing back.
        v_exprs := v_exprs || format(
          '(select m.new_id from pg_temp.job_dup_map m where m.old_id = s.%I)', c.attname
        );
      elsif c.typ = 'uuid' then
        v_exprs := v_exprs || format(
          'coalesce((select m.new_id from pg_temp.job_dup_map m where m.old_id = s.%1$I), s.%1$I)',
          c.attname
        );
      elsif c.typ = 'uuid[]' then
        v_exprs := v_exprs || format(
          'case when s.%1$I is null then null else array(
             select coalesce(m.new_id, u.x)
             from unnest(s.%1$I) with ordinality as u(x, n)
             left join pg_temp.job_dup_map m on m.old_id = u.x
             order by u.n) end',
          c.attname
        );
      elsif c.typ = 'jsonb' then
        v_exprs := v_exprs || format('private.job_dup_remap_jsonb(s.%I)', c.attname);
      elsif c.typ = 'json' then
        v_exprs := v_exprs || format('private.job_dup_remap_jsonb(s.%I::jsonb)::json', c.attname);
      else
        v_exprs := v_exprs || format('s.%I', c.attname);
      end if;
    end loop;

    execute format(
      'insert into %s (%s) select %s from %s s
         join pg_temp.job_dup_map m0 on m0.old_id = s.id and m0.tbl = %L',
      v_rel,
      array_to_string(v_cols, ', '),
      array_to_string(v_exprs, ', '),
      v_rel,
      v_table
    ) using p_source_job_id, p_target_job_id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;

  -- Custody: say where the copy's clips came from, and on the original that
  -- they were copied out. Nothing from the original's log is replayed here.
  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  select p_org_id, p_target_job_id, m.new_id, 'duplicated', p_actor_id,
         coalesce(nullif(p_actor_label, ''), 'Office'),
         left(format('from “%s”', v_source_title), 500)
  from pg_temp.job_dup_map m
  where m.tbl = 'job_proofs';

  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  select p_org_id, p_source_job_id, m.old_id, 'duplicated', p_actor_id,
         coalesce(nullif(p_actor_label, ''), 'Office'),
         left(format('to “%s”', v_target_title), 500)
  from pg_temp.job_dup_map m
  where m.tbl = 'job_proofs';

  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  values
    (p_org_id, p_target_job_id, null, 'duplicated', p_actor_id,
     coalesce(nullif(p_actor_label, ''), 'Office'),
     left(format('Job file duplicated from “%s”. Earlier filing, viewing and sharing of these clips is recorded on the original.', v_source_title), 500)),
    (p_org_id, p_source_job_id, null, 'duplicated', p_actor_id,
     coalesce(nullif(p_actor_label, ''), 'Office'),
     left(format('Job file duplicated to “%s”%s.', v_target_title,
                 coalesce(' (#' || v_target_number || ')', '')), 500));

  drop table if exists pg_temp.job_dup_map;
  return v_counts;
end;
$$;

revoke all on function public.duplicate_job_file_contents(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.duplicate_job_file_contents(uuid, uuid, uuid, uuid, text)
  to service_role;

comment on function public.duplicate_job_file_contents(uuid, uuid, uuid, uuid, text) is
  'Copies a job file''s videos, transcripts, speakers, AI results, Chat, pins, files, parties, brief and scope into a new empty job. Shares stored objects; does not copy share links, custody history or live sessions.';
