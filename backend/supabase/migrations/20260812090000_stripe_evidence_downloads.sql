-- ---------------------------------------------------------------------------
-- Stripe settlement for evidence downloads
-- ---------------------------------------------------------------------------
-- Watching a clip on a Verifier share is free. Keeping a copy settles the
-- sharing org's download fee through Stripe Checkout, on the same webhook path
-- that mints usage credits. The ledger row stays pending until that webhook
-- marks it paid — a browser return from Checkout proves nothing on its own.
--
-- Also: pending rows may now receive Stripe identifiers without changing
-- status. The previous settle-once trigger refused any update that left the
-- row pending, which made it impossible to record the Checkout session id
-- before payment landed.

alter table public.evidence_downloads
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

create unique index if not exists evidence_downloads_stripe_session
  on public.evidence_downloads (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists evidence_downloads_stripe_payment_intent
  on public.evidence_downloads (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create or replace function private.evidence_downloads_settle_once()
returns trigger
language plpgsql
as $$
begin
  -- Settled rows are immutable records of money (or a waiver).
  if old.status <> 'pending_payment' then
    raise exception 'A settled download is a record. It cannot change.';
  end if;
  -- Pending may stay pending (attach a Stripe session id) or move forward once.
  if new.status = 'pending_payment' then
    return new;
  end if;
  if new.status not in ('paid', 'waived') then
    raise exception 'A download can only move from pending to paid or waived.';
  end if;
  return new;
end;
$$;

-- Payment history covers evidence downloads as well as subscriptions/credits.
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments
  add constraint payments_kind_check
  check (kind in ('subscription', 'credits', 'refund', 'evidence_download'));

comment on column public.evidence_downloads.stripe_checkout_session_id is
  'Hosted Checkout session opened for this download fee. Set while still pending.';
comment on column public.evidence_downloads.stripe_payment_intent_id is
  'PaymentIntent that settled the fee. Written by the Stripe webhook.';
