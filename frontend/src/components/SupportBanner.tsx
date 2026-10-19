import { useEffect, useState } from 'react';
import { LifeBuoy, LogOut } from 'lucide-react';

import { supportBannerText, type SupportSession } from '../lib/supportBanner';

/**
 * Shown only while an Atmosphere staff member is viewing Platform as a
 * customer via Analytics "Open account". The server decides; this only reflects it.
 */
export function SupportBanner() {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/support/session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SupportSession | null) => {
        if (alive && s?.active) setSession(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    document.body.style.paddingBottom = '48px';
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [session]);

  if (!session) return null;

  const exit = async () => {
    setExiting(true);
    try {
      await fetch('/api/support/exit', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.assign('/');
    }
  };
  const until = session.expiresAt
    ? new Date(session.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[1000] flex items-center gap-3 border-t-2 border-amber-500 bg-amber-100 px-4 py-2.5 text-sm text-amber-950 shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
    >
      <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">{supportBannerText(session)}</span>
      <span className="hidden text-amber-900/80 md:inline">
        {session.staffEmail ? `Opened by ${session.staffEmail}. ` : ''}
        {until ? `Ends at ${until}. ` : ''}Billing changes are off.
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1 font-medium hover:bg-amber-50 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {exiting ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  );
}
