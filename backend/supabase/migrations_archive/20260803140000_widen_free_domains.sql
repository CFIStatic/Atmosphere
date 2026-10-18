-- Widen the consumer-domain block on the shared pool.
--
-- is_poolable_address() shipped with eleven domains, which failed silently in
-- the worst direction: ymail.com and rocketmail.com are Yahoo's own alternate
-- domains, so somebody's private mailbox satisfied the "business address only"
-- constraint and could be pooled and sold to strangers.
--
-- The asymmetry here is the whole argument for erring long. A missing entry
-- costs a person their private address; an extra entry costs us one business
-- contact we decline to sell. Kept in step with FREE_DOMAINS in
-- verification.ts, and duplicated deliberately — a constraint the database
-- enforces outlives whatever the application layer remembers to check.

create or replace function public.is_poolable_address(addr text)
returns boolean
language sql
immutable
as $$
  select addr is not null
     and addr = lower(addr)
     and addr ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     and split_part(addr, '@', 2) not in (
       'gmail.com','googlemail.com',
       'yahoo.com','yahoo.co.uk','yahoo.ca','yahoo.com.au','yahoo.fr','yahoo.de',
       'ymail.com','rocketmail.com',
       'hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com',
       'icloud.com','me.com','mac.com',
       'proton.me','protonmail.com','pm.me','tutanota.com','tuta.io','hushmail.com',
       'aol.com','aim.com','gmx.com','gmx.net','gmx.de','mail.com',
       'zoho.com','yandex.com','yandex.ru','fastmail.com','fastmail.fm',
       'inbox.com','mail.ru','qq.com','163.com','126.com','naver.com',
       'daum.net','seznam.cz','web.de','t-online.de','orange.fr','wanadoo.fr',
       'free.fr','libero.it','virgilio.it','terra.com.br','uol.com.br',
       'bol.com.br','rediffmail.com','sina.com','comcast.net','verizon.net',
       'att.net','sbcglobal.net','bellsouth.net','cox.net','charter.net',
       'earthlink.net','juno.com','btinternet.com','sky.com','talktalk.net',
       'shaw.ca','rogers.com','telus.net','bigpond.com','optusnet.com.au',
       -- Throwaway inboxes: whoever used one did not want to be contacted.
       'mailinator.com','guerrillamail.com','guerrillamail.net','10minutemail.com',
       'temp-mail.org','tempmail.com','throwawaymail.com','yopmail.com',
       'trashmail.com','sharklasers.com','getnada.com','maildrop.cc',
       'dispostable.com','fakeinbox.com','mintemail.com','spamgourmet.com',
       'mailnesia.com','tempinbox.com','moakt.com','emailondeck.com'
     )
     and split_part(addr, '@', 1) not in (
       'info','sales','support','admin','office','contact','hello','help',
       'billing','accounts','noreply','no-reply','postmaster','webmaster',
       'abuse','marketing','jobs','careers','team'
     )
$$;

-- Anything already pooled that the widened rule would now refuse must go. A
-- constraint that only applies to future rows leaves the existing leak in
-- place, which is the half-fix that lets everyone believe it was handled.
delete from public.network_contacts
 where not public.is_poolable_address(email);
