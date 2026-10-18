-- Per-user Chat communication-style profile.
--
-- Inferred quietly from Ask messages (brevity, format, formality, trade
-- vocabulary, decision style, common tasks, time-of-day, frustration). Used
-- only to adapt tone, length and format in Chat. Never shown as a label in
-- customer-facing UI. Never stores health, religion, politics, sexuality,
-- ethnicity, finances or personality-disorder inferences.
--
-- Owned by the person: they can read and delete their row. The BFF uses the
-- service role for incremental updates and prompt injection. Org members do
-- not read each other's style rows.

create table if not exists public.ask_communication_styles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Trait scores and confidence. Shape is owned by the BFF
  -- (backend/src/shared/askCommunicationStyle.ts).
  traits jsonb not null default '{}'::jsonb,
  -- Compact, prompt-safe summary injected into Chat system prompts.
  prompt_summary text not null default ''
    check (char_length(prompt_summary) <= 800),
  sample_count integer not null default 0 check (sample_count >= 0),
  last_signal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ask_communication_styles is
  'Quiet per-user Chat communication-style profile. Tone/length/format only. '
  'Never shown as a customer-facing label. Cascades away with the profile.';

comment on column public.ask_communication_styles.traits is
  'JSON trait scores with confidence and timestamps. No sensitive attributes.';

comment on column public.ask_communication_styles.prompt_summary is
  'Short style note for the Chat system prompt. Facts, quotes and evidence rules still win.';

create index if not exists ask_communication_styles_updated_idx
  on public.ask_communication_styles (updated_at desc);

alter table public.ask_communication_styles enable row level security;

drop policy if exists ask_communication_styles_select on public.ask_communication_styles;
create policy ask_communication_styles_select on public.ask_communication_styles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ask_communication_styles_delete on public.ask_communication_styles;
create policy ask_communication_styles_delete on public.ask_communication_styles
  for delete to authenticated
  using (user_id = auth.uid());

-- Inserts/updates run through the service role (after-turn hook). Authenticated
-- clients may only wipe their own row.
revoke all on public.ask_communication_styles from anon;
grant select, delete on public.ask_communication_styles to authenticated;
