import { setIncludeInternal } from '../lib/scope';
import { useIncludeInternal } from '../hooks/useIncludeInternal';

/**
 * "Include internal & test accounts". Off by default, so every report shows
 * customers only. Staff (internal scope) only; the server ignores it for
 * investors.
 */
export function ScopeToggle({ compact = false }: { compact?: boolean }) {
  const on = useIncludeInternal();
  return (
    <label
      className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-ink-600"
      title="Jettx staff orgs, TEST and demo orgs, and comp accounts are left out of every figure unless this is on."
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={on}
        checked={on}
        onChange={(event) => setIncludeInternal(event.target.checked)}
        className="h-3.5 w-3.5 accent-brand-600"
        data-testid="include-internal-toggle"
      />
      <span className={compact ? 'hidden lg:inline' : undefined}>Include internal &amp; test accounts</span>
      {compact && <span className="lg:hidden">Internal</span>}
    </label>
  );
}

/** One line under each page saying what the figures include. */
export function ScopeNote({ allowed }: { allowed: boolean }) {
  const on = useIncludeInternal() && allowed;
  return (
    <p className="mt-8 border-t border-line pt-3 text-[11.5px] text-ink-500" data-testid="scope-note">
      {on
        ? 'Including internal, test and comp accounts.'
        : 'Customers only: internal (Jettx), test/demo and comp accounts are excluded.'}{' '}
      All dates, weeks and months are UTC.
    </p>
  );
}
