-- Google Calendar event made for each demo booking (null when the invite fell back to .ics).
alter table public.demo_bookings
  add column if not exists google_event_id text,
  add column if not exists meet_url text;
