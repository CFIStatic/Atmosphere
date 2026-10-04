-- ---------------------------------------------------------------------------
-- Live safety: real vs joking / staged / media playback, confirmation state,
-- dismiss reasons, per-org live opt-out. Alerts are email-only to account admins.
-- ---------------------------------------------------------------------------
-- A transcript word list or a fast frame screen only flags a CANDIDATE. A
-- model confirmation decides whether what was seen/heard is real, a joke,
-- staged, or a video/TV/podcast playing. Atmosphere still never dials 911.

alter type public.safety_incident_source add value if not exists 'live_stream';

alter table public.orgs
  add column if not exists safety_live_enabled boolean not null default true;

comment on column public.orgs.safety_live_enabled is
  'Critical live safety while Field Capture records (audio + frame screen, model '
  'confirmation, immediate email to the account admins). Default ON; an org may opt out.';

alter table public.safety_incidents
  add column if not exists reality text
    check (reality is null or reality in ('real', 'joking', 'staged', 'media_playback', 'unclear')),
  add column if not exists confirmation text
    check (confirmation is null or confirmation in ('confirmed', 'unconfirmed')),
  add column if not exists dismiss_category text
    check (dismiss_category is null or dismiss_category in (
      'false_alarm_media', 'joking', 'staged', 'not_an_emergency', 'handled', 'duplicate', 'other'
    ));

comment on column public.safety_incidents.reality is
  'Model confirmation verdict: real, joking, staged, media_playback (TV / video / '
  'podcast / screen), or unclear.';
comment on column public.safety_incidents.confirmation is
  'confirmed = model said real above threshold; unconfirmed = high-severity unclear '
  '(alert says "Unconfirmed: check live view").';
comment on column public.safety_incidents.dismiss_category is
  'Why the office dismissed the alert. Required by the Platform dismiss action.';
