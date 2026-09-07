-- Field Capture extra seats on Work Verification ($100/mo each beyond 3 included).
-- Railway does not run migrations on boot; apply via
-- backend/scripts/applyFieldCaptureExtraSeats.mjs on deploy.

alter table public.org_billing
  add column if not exists extra_fc_seats integer not null default 0
    check (extra_fc_seats >= 0);

comment on column public.org_billing.extra_fc_seats is
  'Stripe quantity of field_capture_extra_seat. Allowed Field Capture accounts = 3 + extra_fc_seats.';
