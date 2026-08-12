-- Field Capture context is Atmosphere-internal telemetry.
-- Customers (org members) must not read these tables via RLS; the BFF serves
-- them only to analytics_staff with internal scope through the service role.

drop policy if exists field_capture_sessions_select_member on public.field_capture_sessions;
drop policy if exists field_location_samples_select_member on public.field_location_samples;
drop policy if exists field_motion_samples_select_member on public.field_motion_samples;

comment on table public.field_capture_sessions is
  'Internal Field Capture context bundles. Written by the field-app BFF; '
  'readable only via service role for Atmosphere staff analytics — never a '
  'customer job-file surface.';

comment on column public.job_proofs.device_context is
  'Internal-only organized capture context. Not returned on customer evidence '
  'or job-file APIs; surfaced in Atmosphere staff Field context analytics.';
