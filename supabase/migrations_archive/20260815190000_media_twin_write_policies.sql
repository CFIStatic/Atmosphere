-- Org members need write policies on media/twin catalog tables when using a
-- user JWT. The API still prefers the service role; these close the gap for
-- authenticated PostgREST / future client paths.

do $$ begin
  create policy media_objects_insert_member on public.media_objects
    for insert to authenticated
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy media_objects_update_member on public.media_objects
    for update to authenticated
    using (org_id in (select org_id from public.org_members where user_id = auth.uid()))
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy org_media_quotas_write_member on public.org_media_quotas
    for all to authenticated
    using (org_id in (select org_id from public.org_members where user_id = auth.uid()))
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy media_upload_sessions_write_member on public.media_upload_sessions
    for all to authenticated
    using (org_id in (select org_id from public.org_members where user_id = auth.uid()))
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy property_twins_write_member on public.property_twins
    for all to authenticated
    using (org_id in (select org_id from public.org_members where user_id = auth.uid()))
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy geometry_capture_sessions_write_member on public.geometry_capture_sessions
    for all to authenticated
    using (org_id in (select org_id from public.org_members where user_id = auth.uid()))
    with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));
exception when duplicate_object then null; end $$;
