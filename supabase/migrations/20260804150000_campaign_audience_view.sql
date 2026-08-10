-- The only contacts a campaign may ever reach.
--
-- crm_contacts.marketing_opt_out has existed since the CRM was built. It is
-- written by the UI when a rep ticks the box after a phone call — and it was
-- read by nothing. Both audience queries hand-listed their columns
-- (`id, first_name, last_name, email, title, company_name`) and filtered
-- neither it nor is_archived, so the rep ticked the box and the campaign
-- mailed them anyway.
--
-- A hand-written select list can forget a column. It already did, twice. A
-- view cannot: every caller that reads from here inherits the filter, and a
-- future audience query written by somebody who has never heard of
-- marketing_opt_out is still correct.
--
-- This is the difference between a control enforced in schema and one enforced
-- by remembering.

create or replace view public.crm_campaign_audience as
  select
    c.id,
    c.org_id,
    c.first_name,
    c.last_name,
    c.email,
    c.title,
    c.company_name,
    c.phone,
    c.mobile,
    c.city,
    c.postal_code,
    c.country
  from public.crm_contacts c
  where c.marketing_opt_out = false
    and c.is_archived = false
    and c.email is not null
    and length(btrim(c.email)) > 0;

comment on view public.crm_campaign_audience is
  'The only contacts a campaign may reach. Filters marketing_opt_out and is_archived structurally, because both audience queries previously forgot to.';

-- Views run with the querying user's privileges by default in recent Postgres,
-- so the underlying table's RLS still applies and an org cannot read another's
-- contacts through it.
alter view public.crm_campaign_audience set (security_invoker = true);

grant select on public.crm_campaign_audience to authenticated, service_role;
