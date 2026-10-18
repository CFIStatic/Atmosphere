-- Per-booking Google Calendar event + Meet link, and the host's one notification.
alter table public.demo_bookings
  add column if not exists google_event_id text,
  add column if not exists meet_url text,
  add column if not exists host_notified_at timestamptz;
