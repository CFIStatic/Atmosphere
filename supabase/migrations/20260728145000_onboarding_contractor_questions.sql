-- ============================================================================
-- Onboarding questionnaire — contractor type + how the team plans to use
-- Atmosphere.
--
-- Asked after account creation, during the existing /onboarding wizard:
--   * contractor_type lives on the organization (what kind of company is this)
--   * usage_intents lives on the membership (how this person plans to use it)
--
-- orgs has no UPDATE policy for members (renames stay closed), so writing
-- contractor_type goes through a SECURITY DEFINER helper — the same pattern as
-- create_org / join_org. usage_intents is written with the caller's own
-- org_members row, which already has an UPDATE path for role / work_type.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.orgs
  add column if not exists contractor_type text;

do $$ begin
  alter table public.orgs
    add constraint orgs_contractor_type_check
    check (
      contractor_type is null
      or contractor_type in (
        'restoration',
        'roofing',
        'general_contractor',
        'other'
      )
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.orgs.contractor_type is
  'What kind of contractor the organization is (restoration, roofing, GC, other). Set during onboarding when the org is created.';

alter table public.org_members
  add column if not exists usage_intents text[] not null default '{}';

do $$ begin
  alter table public.org_members
    add constraint org_members_usage_intents_check
    check (
      usage_intents <@ array[
        'mitigation_estimating',
        'construction_estimating',
        'project_management',
        'crm',
        'web_access',
        'field_work',
        'billing',
        'exploring'
      ]::text[]
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.org_members.usage_intents is
  'How this member plans to use Atmosphere. Multi-select, captured during onboarding.';

-- ---------------------------------------------------------------------------
-- set_org_contractor_type
--
-- Lets an org member (typically the creator, right after create_org) record
-- what kind of contractor the organization is. Existing non-null values can
-- only be overwritten by the org's creator so a later joiner cannot rebrand
-- the company.
-- ---------------------------------------------------------------------------

create or replace function public.set_org_contractor_type(p_contractor_type text)
returns public.orgs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org public.orgs;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_contractor_type is null
     or p_contractor_type not in ('restoration', 'roofing', 'general_contractor', 'other') then
    raise exception 'invalid contractor type' using errcode = '22023';
  end if;

  select om.org_id into v_org_id
  from public.org_members om
  where om.user_id = v_uid
  order by om.created_at
  limit 1;

  if v_org_id is null then
    raise exception 'not linked to an organization' using errcode = 'P0002';
  end if;

  update public.orgs o
     set contractor_type = p_contractor_type
   where o.id = v_org_id
     and (
       o.created_by = v_uid
       or o.contractor_type is null
     )
  returning * into v_org;

  if not found then
    raise exception 'cannot change contractor type for this organization' using errcode = '42501';
  end if;

  return v_org;
end;
$$;

revoke all on function public.set_org_contractor_type(text) from public;
revoke execute on function public.set_org_contractor_type(text) from anon;
grant execute on function public.set_org_contractor_type(text) to authenticated;
