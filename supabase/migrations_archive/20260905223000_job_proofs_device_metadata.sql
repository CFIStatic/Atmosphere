-- ---------------------------------------------------------------------------
-- Device identity on the proof row
-- ---------------------------------------------------------------------------
-- Custody export needs who filmed and on what phone. Capture already knows
-- make / model / OS / app version when the device sends it; the proof row
-- did not keep it. Empty object is honest — unknown stays unknown.

alter table public.job_proofs
  add column if not exists device_metadata jsonb not null default '{}'::jsonb;

comment on column public.job_proofs.device_metadata is
  'Phone / app identity the device reported at upload (make, model, os, '
  'appVersion, deviceId). Empty when the upload did not send it.';
