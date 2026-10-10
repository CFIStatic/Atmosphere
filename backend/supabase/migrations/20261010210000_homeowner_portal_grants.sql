-- Homeowner portal: invited people see every job shared with them, across
-- contractor orgs, in the same app as the office. Access is a row in
-- job_progress_grants that is only live while the invite (verifier_shares row)
-- is live and still addressed to the signed-in person's email.
--
-- Built for homeowners now; shaped for subcontractors later:
--   access_kind     'homeowner' today; 'subcontractor' when subs accept the
--                   same email invite with a real password account.
--   grantee_org_id  null for homeowners. For a sub, their own org, so the job
--                   can show in that org's dashboard as "Shared by <contractor>".
--   revoked_at      stamped when the contractor revokes the invite.

alter table public.job_progress_grants
  add column if not exists access_kind text not null default 'homeowner',
  add column if not exists grantee_org_id uuid references public.orgs (id) on delete cascade,
  add column if not exists revoked_at timestamptz;

alter table public.job_progress_grants
  drop constraint if exists job_progress_grants_access_kind_check;
alter table public.job_progress_grants
  add constraint job_progress_grants_access_kind_check
  check (access_kind in ('homeowner', 'subcontractor'));

comment on column public.job_progress_grants.access_kind is
  'homeowner (email-link viewer) or subcontractor (future: password account, job shown in their org).';
comment on column public.job_progress_grants.grantee_org_id is
  'Subcontractor org that sees this job as Shared by <contractor>. Null for homeowners.';
comment on column public.job_progress_grants.revoked_at is
  'Set when the contractor revokes the invite. A revoked grant opens nothing.';

-- One question every policy and the BFF agree on: may the signed-in person
-- read this job as an invited viewer?
create or replace function private.has_job_progress_grant(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.job_progress_grants g
    join public.verifier_shares s on s.id = g.share_id
    join auth.users u on u.id = g.user_id
    where g.job_id = p_job_id
      and g.user_id = auth.uid()
      and g.revoked_at is null
      and s.revoked_at is null
      and s.job_id = g.job_id
      and lower(coalesce(s.recipient_email, '')) = lower(coalesce(u.email, ''))
      and lower(g.recipient_email) = lower(coalesce(u.email, ''))
  );
$$;

revoke all on function private.has_job_progress_grant(uuid) from public, anon, authenticated;
grant execute on function private.has_job_progress_grant(uuid) to authenticated;

-- Read-only. No insert/update/delete policies: invited viewers change nothing.
drop policy if exists crm_jobs_select_progress_grant on public.crm_jobs;
create policy crm_jobs_select_progress_grant on public.crm_jobs
  for select to authenticated
  using (deleted_at is null and private.has_job_progress_grant(id));

drop policy if exists job_proofs_select_progress_grant on public.job_proofs;
create policy job_proofs_select_progress_grant on public.job_proofs
  for select to authenticated
  using (deleted_at is null and private.has_job_progress_grant(job_id));

-- Revoking the invite ends the grant too (the BFF checks both).
create or replace function private.revoke_job_progress_grants_on_share()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.job_progress_grants
       set revoked_at = new.revoked_at
     where share_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.revoke_job_progress_grants_on_share() from public, anon, authenticated;

drop trigger if exists verifier_shares_revoke_grants on public.verifier_shares;
create trigger verifier_shares_revoke_grants
  after update of revoked_at on public.verifier_shares
  for each row execute function private.revoke_job_progress_grants_on_share();

-- Grants whose invite was already revoked before this migration.
update public.job_progress_grants g
   set revoked_at = s.revoked_at
  from public.verifier_shares s
 where s.id = g.share_id and s.revoked_at is not null and g.revoked_at is null;

create index if not exists job_progress_grants_grantee_org_idx
  on public.job_progress_grants (grantee_org_id) where grantee_org_id is not null;
