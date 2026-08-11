-- Progress shares use the same token table as evidence shares but open a
-- read-only job progress view instead of the full Verifier library.

alter table public.verifier_shares
  add column if not exists share_kind text not null default 'evidence'
    check (share_kind in ('evidence', 'progress'));

comment on column public.verifier_shares.share_kind is
  'evidence → Verifier library link; progress → read-only job progress dashboard.';
