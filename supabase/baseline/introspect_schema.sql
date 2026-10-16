with sch as (select oid, nspname from pg_namespace where nspname in ('public','private','memory')),
ddl as (
-- 0 schemas
select 0 ph, 0::bigint ord, format('create schema if not exists %I;', nspname) s from sch where nspname<>'public'
union all
select 1, 0, format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname not in ('plpgsql')
union all
-- 2 enums
select 2, t.oid::bigint, format('do $t$ begin create type %I.%I as enum (%s); exception when duplicate_object then null; end $t$;', n.nspname, t.typname,
  (select string_agg(quote_literal(enumlabel), ',' order by enumsortorder) from pg_enum where enumtypid=t.oid))
  from pg_type t join sch n on n.oid=t.typnamespace where t.typtype='e'
union all
-- 2 domains
select 2, t.oid::bigint, format('do $t$ begin create domain %I.%I as %s%s; exception when duplicate_object then null; end $t$;', n.nspname, t.typname, format_type(t.typbasetype,t.typtypmod),
  coalesce((select ' '||string_agg(pg_get_constraintdef(c.oid),' ') from pg_constraint c where c.contypid=t.oid),''))
  from pg_type t join sch n on n.oid=t.typnamespace where t.typtype='d'
union all
-- 2b composite types (standalone)
select 2, t.oid::bigint, format('do $t$ begin create type %I.%I as (%s); exception when duplicate_object then null; end $t$;', n.nspname, t.typname,
  (select string_agg(format('%I %s', a.attname, format_type(a.atttypid,a.atttypmod)), ', ' order by a.attnum) from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped))
  from pg_type t join sch n on n.oid=t.typnamespace join pg_class c on c.oid=t.typrelid where t.typtype='c' and c.relkind='c'
union all
-- 3 sequences
select 3, c.oid::bigint, format('create sequence if not exists %I.%I;', n.nspname, c.relname)
  from pg_class c join sch n on n.oid=c.relnamespace where c.relkind='S'
  and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='i')
union all
-- 4 tables
select 4, c.oid::bigint, format('create table if not exists %I.%I (%s)%s;', n.nspname, c.relname,
  coalesce((select string_agg(format('%I %s%s%s', a.attname, format_type(a.atttypid,a.atttypmod),
     case when a.attidentity in ('a','d') then ' generated '||case a.attidentity when 'a' then 'always' else 'by default' end||' as identity' else '' end
     ||case when a.attgenerated='s' then ' generated always as ('||pg_get_expr(ad.adbin,ad.adrelid)||') stored' else '' end,
     case when a.attnotnull then ' not null' else '' end), ', ' order by a.attnum)
   from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
   where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),''),
  case when c.relkind='p' then ' partition by '||pg_get_partkeydef(c.oid) else '' end)
  from pg_class c join sch n on n.oid=c.relnamespace where c.relkind in ('r','p') and not c.relispartition
union all
-- 5 functions
select 5, p.oid::bigint, pg_get_functiondef(p.oid)||';'
  from pg_proc p join sch n on n.oid=p.pronamespace
  where p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all
-- 5b aggregates skipped
-- 6 defaults
select 6, a.attrelid::bigint, format('alter table %I.%I alter column %I set default %s;', n.nspname, c.relname, a.attname, pg_get_expr(ad.adbin,ad.adrelid))
  from pg_attrdef ad join pg_attribute a on a.attrelid=ad.adrelid and a.attnum=ad.adnum join pg_class c on c.oid=a.attrelid join sch n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and a.attgenerated='' and a.attidentity=''
union all
-- 7 views
select 7, c.oid::bigint, format('create or replace view %I.%I%s as %s', n.nspname, c.relname,
   case when c.reloptions is not null then ' with ('||array_to_string(c.reloptions,',')||')' else '' end, pg_get_viewdef(c.oid))
  from pg_class c join sch n on n.oid=c.relnamespace where c.relkind='v'
union all
select 7, c.oid::bigint, format('create materialized view if not exists %I.%I as %s', n.nspname, c.relname, pg_get_viewdef(c.oid))
  from pg_class c join sch n on n.oid=c.relnamespace where c.relkind='m'
union all
-- 8 constraints (non-FK first)
select case when con.contype='f' then 9 else 8 end, con.oid::bigint, format('alter table %I.%I add constraint %I %s;', n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con join pg_class c on c.oid=con.conrelid join sch n on n.oid=c.relnamespace
  where con.contype in ('p','u','c','f','x') and con.conislocal and not c.relispartition
union all
-- 10 indexes
select 10, i.indexrelid::bigint, regexp_replace(pg_get_indexdef(i.indexrelid),'^CREATE (UNIQUE )?INDEX ','CREATE \1INDEX IF NOT EXISTS ')||';'
  from pg_index i join pg_class c on c.oid=i.indrelid join sch n on n.oid=c.relnamespace
  where not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid and con.contype in ('p','u','x'))
union all
-- 11 triggers (our schemas + auth.users/storage.objects calling our funcs)
select 11, t.oid::bigint, pg_get_triggerdef(t.oid)||';'
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
  where not t.tgisinternal and (n.nspname in ('public','private','memory') or pn.nspname in ('public','private','memory'))
union all
-- 12 RLS
select 12, c.oid::bigint, format('alter table %I.%I enable row level security;', n.nspname, c.relname)||case when c.relforcerowsecurity then format(' alter table %I.%I force row level security;', n.nspname, c.relname) else '' end
  from pg_class c join sch n on n.oid=c.relnamespace where c.relrowsecurity
union all
select 13, 0, format('create policy %I on %I.%I as %s for %s to %s%s%s;', pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
   array_to_string(pol.roles, ','), coalesce(' using ('||pol.qual||')',''), coalesce(' with check ('||pol.with_check||')',''))
  from pg_policies pol where pol.schemaname in ('public','private','memory','storage')
union all
-- 14 grants on relations
select 14, c.oid::bigint, format('revoke all on %I.%I from public, anon, authenticated, service_role;', n.nspname, c.relname)
   ||coalesce((select string_agg(format(' grant %s on %I.%I to %s;', x.privilege_type, n.nspname, c.relname, case when x.grantee=0 then 'public' else quote_ident(r.rolname) end),'')
      from aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee where (x.grantee=0 or r.rolname in ('anon','authenticated','service_role'))),'')
  from pg_class c join sch n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S') and c.relacl is not null
union all
-- 15 grants on functions
select 15, p.oid::bigint, format('revoke all on function %I.%I(%s) from public, anon, authenticated, service_role;', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
   ||coalesce((select string_agg(format(' grant execute on function %I.%I(%s) to %s;', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), case when x.grantee=0 then 'public' else quote_ident(r.rolname) end),'')
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x left join pg_roles r on r.oid=x.grantee where (x.grantee=0 or r.rolname in ('anon','authenticated','service_role'))),'')
  from pg_proc p join sch n on n.oid=p.pronamespace where not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all
select 16, n.oid::bigint, format('grant usage on schema %I to %s;', n.nspname, string_agg(distinct quote_ident(r.rolname), ','))
  from pg_namespace n, aclexplode(n.nspacl) x join pg_roles r on r.oid=x.grantee where n.nspname in ('public','private','memory') and r.rolname in ('anon','authenticated','service_role') and x.privilege_type='USAGE' group by n.nspname, n.oid
union all
-- 17 storage buckets (config only)
select 17, 0, format('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values (%L,%L,%s,%s,%s) on conflict (id) do nothing;', id, name, public, coalesce(file_size_limit::text,'null'), coalesce(quote_literal(allowed_mime_types::text)||'::text[]','null'))
  from storage.buckets
union all
-- 18 realtime publication
select 18, 0, format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename) from pg_publication_tables where pubname='supabase_realtime' and schemaname in ('public','private','memory')
)
select ph, ord, s from ddl order by ph, ord;
