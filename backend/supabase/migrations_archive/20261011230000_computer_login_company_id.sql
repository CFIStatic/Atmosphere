-- ============================================================================
-- Computer › Logins: optional Company ID on a saved sign-in.
--
-- Some sites (DASH by Next Gear / Restore 365) ask for a company ID along
-- with the username and password. It is sealed in the backend with the same
-- AES-256-GCM key as the other fields (COMPUTER_CREDENTIAL_KEY), bound to its
-- org, login and field. Null when none is saved. Safe to re-run.
-- ============================================================================

alter table public.computer_login_credentials
  add column if not exists company_id_sealed text;

alter table public.computer_login_credentials
  drop constraint if exists computer_login_credentials_company_id_sealed_check;
alter table public.computer_login_credentials
  add constraint computer_login_credentials_company_id_sealed_check
  check (company_id_sealed is null or (company_id_sealed like 'v1.%' and char_length(company_id_sealed) <= 2048));
