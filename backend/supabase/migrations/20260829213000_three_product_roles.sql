-- Product org seats: Global Admin + Employee.
-- Invited workers stay on job-share / party tokens (not org_members).
--
-- New enum values must land in their own migration before any DML uses them
-- (Postgres cannot use a value added earlier in the same transaction).

alter type public.member_role add value if not exists 'global_admin';
alter type public.member_role add value if not exists 'employee';
