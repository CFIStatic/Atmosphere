-- Job files must be writable/readable by org members after Approve & invite.
-- The shared-job tables were created with RLS policies but without GRANTs to
-- `authenticated` (unlike crm_jobs). In environments without default privileges,
-- approve could create crm_jobs then fail on brief/parties — or list overlays
-- could fail — so the new job file never showed on Job Progress.
--
-- Also adds intake_create_job_file(): one SECURITY DEFINER transaction that
-- creates the property + job + intake + brief + scope + parties so the
-- dashboard always has a complete job file to open after approve.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update on
  public.job_parties,
  public.job_scope_items
  to authenticated;

grant select, insert on
  public.job_briefs,
  public.job_acknowledgements,
  public.job_messages,
  public.job_intake
  to authenticated;

grant select on public.job_share_status to authenticated;

revoke all on
  public.job_parties,
  public.job_briefs,
  public.job_scope_items,
  public.job_acknowledgements,
  public.job_messages,
  public.job_intake
  from anon;

-- ---------------------------------------------------------------------------
-- Atomic create for Approve & invite
-- ---------------------------------------------------------------------------

create or replace function public.intake_create_job_file(
  p_org_id uuid,
  p_title text,
  p_work_type text,
  p_address text,
  p_city text default null,
  p_postal_code text default null,
  p_claim_number text default null,
  p_brief_note text default null,
  p_facts jsonb default '{}'::jsonb,
  p_scope jsonb default '[]'::jsonb,
  p_invitees jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_property_id uuid;
  v_job_id uuid;
  v_job_number bigint;
  v_job_title text;
  v_revision integer;
  v_invitee jsonb;
  v_party_id uuid;
  v_party_company text;
  v_party_email text;
  v_party_token text;
  v_parties jsonb := '[]'::jsonb;
  v_scope_count integer := 0;
  v_source text;
  v_external boolean;
  v_company text;
  v_trade text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_org_id is null or not private.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) < 1 then
    raise exception 'title_required';
  end if;
  if p_address is null or length(btrim(p_address)) < 1 then
    raise exception 'address_required';
  end if;
  if p_work_type is null or p_work_type not in ('mitigation', 'construction') then
    raise exception 'work_type_invalid';
  end if;
  if jsonb_typeof(coalesce(p_invitees, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_invitees, '[]'::jsonb)) < 1 then
    raise exception 'invitees_required';
  end if;

  insert into public.crm_properties (org_id, address_line1, city, postal_code)
  values (
    p_org_id,
    left(btrim(p_address), 200),
    nullif(left(btrim(coalesce(p_city, '')), 120), ''),
    nullif(left(btrim(coalesce(p_postal_code, '')), 20), '')
  )
  returning id into v_property_id;

  insert into public.crm_jobs (
    org_id, title, work_type, property_id, claim_number, status, created_by
  )
  values (
    p_org_id,
    left(btrim(p_title), 200),
    p_work_type::public.work_type,
    v_property_id,
    nullif(left(btrim(coalesce(p_claim_number, '')), 80), ''),
    'scheduled',
    v_uid
  )
  returning id, title, job_number into v_job_id, v_job_title, v_job_number;

  v_source := case
    when jsonb_array_length(coalesce(p_scope, '[]'::jsonb)) > 0 then 'scope_document'
    else 'manual'
  end;

  insert into public.job_intake (job_id, org_id, source, source_detail, entered_by)
  values (
    v_job_id,
    p_org_id,
    v_source,
    jsonb_build_object(
      'enteredFrom', 'intake_package',
      'captureInvites', jsonb_array_length(coalesce(p_invitees, '[]'::jsonb)),
      'scopeOptional', v_source = 'manual'
    ),
    v_uid
  );

  insert into public.job_briefs (org_id, job_id, revision, facts, note, created_by)
  values (
    p_org_id,
    v_job_id,
    0,
    coalesce(p_facts, '{}'::jsonb),
    nullif(left(btrim(coalesce(p_brief_note, '')), 2000), ''),
    v_uid
  )
  returning revision into v_revision;

  insert into public.job_scope_items (
    org_id, job_id, title, state, reason, revision, created_by
  )
  select
    p_org_id,
    v_job_id,
    left(btrim(s->>'title'), 200),
    case
      when s->>'state' = 'excluded' then 'excluded'::public.job_scope_state
      else 'included'::public.job_scope_state
    end,
    nullif(left(btrim(coalesce(s->>'reason', '')), 1000), ''),
    v_revision,
    v_uid
  from jsonb_array_elements(coalesce(p_scope, '[]'::jsonb)) as s
  where length(btrim(coalesce(s->>'title', ''))) >= 2;

  get diagnostics v_scope_count = row_count;

  for v_invitee in
    select value from jsonb_array_elements(coalesce(p_invitees, '[]'::jsonb)) as t(value)
  loop
    v_external := coalesce((v_invitee->>'external')::boolean, false)
      or coalesce(v_invitee->>'userId', '') = '';
    v_company := left(
      btrim(coalesce(nullif(v_invitee->>'company', ''), v_invitee->>'fullName', 'Field Capture')),
      160
    );
    v_trade := left(
      btrim(
        coalesce(
          nullif(v_invitee->>'trade', ''),
          case when v_external then 'subcontractor' else 'field_capture' end
        )
      ),
      60
    );

    insert into public.job_parties (
      org_id, job_id, company, trade, contact_name, email, role, invited_at, created_by
    )
    values (
      p_org_id,
      v_job_id,
      v_company,
      v_trade,
      left(btrim(coalesce(v_invitee->>'fullName', v_company)), 120),
      nullif(lower(btrim(coalesce(v_invitee->>'email', ''))), ''),
      'subcontractor',
      now(),
      v_uid
    )
    returning id, company, email, access_token
    into v_party_id, v_party_company, v_party_email, v_party_token;

    v_parties := v_parties || jsonb_build_array(
      jsonb_build_object(
        'id', v_party_id,
        'name', v_party_company,
        'email', v_party_email,
        'token', v_party_token,
        'external', v_external
      )
    );
  end loop;

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job_id,
      'title', v_job_title,
      'jobNumber', v_job_number
    ),
    'briefRevision', v_revision,
    'scopeSaved', v_scope_count,
    'parties', v_parties,
    'summary', jsonb_build_object(
      'jobId', v_job_id,
      'jobNumber', v_job_number,
      'title', v_job_title,
      'status', 'scheduled',
      'parties', jsonb_array_length(v_parties),
      'currentRevision', v_revision,
      'behind', 0,
      'awaiting', jsonb_array_length(v_parties),
      'exclusions', (
        select count(*)::int
        from public.job_scope_items
        where job_id = v_job_id and state = 'excluded'
      )
    )
  );
end;
$$;

comment on function public.intake_create_job_file is
  'Approve & invite: atomically create the job file (property, job, intake, '
  'brief, scope, parties) so Job Progress can list it immediately.';

revoke all on function public.intake_create_job_file(
  uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public;

grant execute on function public.intake_create_job_file(
  uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated;
