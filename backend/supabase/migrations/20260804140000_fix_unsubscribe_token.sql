-- Make the unsubscribe token survive a round trip through email.
--
-- It defaulted to standard base64, whose alphabet includes '+' and '/'. The
-- token is carried in a query string, where '+' is decoded as a space by
-- essentially every form parser and '/' is mangled by link scanners and
-- auto-linkifiers in mail clients. A meaningful share of opt-out links were
-- therefore broken on arrival — and because record_unsubscribe answers success
-- on a token miss, and the page says "You're unsubscribed" either way, the
-- breakage was invisible to the recipient AND to the operator.
--
-- Hex: no ambiguous characters, survives every encoder, and 18 bytes is still
-- 144 bits of entropy — far past guessable.

alter table public.crm_sends
  alter column unsubscribe_token set default encode(gen_random_bytes(18), 'hex');

-- Existing tokens containing a URL-unsafe character are rotated. A token that
-- cannot be clicked is not an opt-out mechanism, and leaving them in place
-- means the people most likely to want out are the ones who cannot get out.
update public.crm_sends
   set unsubscribe_token = encode(gen_random_bytes(18), 'hex')
 where unsubscribe_token ~ '[+/=]';
