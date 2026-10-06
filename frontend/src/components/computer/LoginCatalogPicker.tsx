import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { groupLoginCatalog, type LoginCatalog, type LoginCatalogEntry } from '../../lib/computer';

/** Monogram in the brand colour (no third-party logo files are loaded). */
export function SiteLogo({
  site,
  size = 'md',
}: {
  site: Pick<LoginCatalogEntry, 'logo' | 'name'>;
  size?: 'md' | 'lg';
}) {
  const dims = size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-[11px]';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${dims}`}
      style={{ backgroundColor: site.logo.color }}
    >
      {site.logo.text}
    </span>
  );
}

export const TWO_STEP_LINE = 'You’ll be asked for a code when signing in.';
export const SSO_LINE =
  'Company accounts may sign in through Google, Microsoft or another single sign-on page.';

/** Small badges under a site name: code at sign-in, single sign-on. */
export function SiteBadges({ site }: { site: LoginCatalogEntry }) {
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {site.twoStep === 'likely' ? (
        <span
          className="rounded bg-caution-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-800"
          title={TWO_STEP_LINE}
        >
          Code at sign-in
        </span>
      ) : null}
      {site.sso ? (
        <span
          className="rounded bg-paper-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700"
          title={SSO_LINE}
        >
          Single sign-on
        </span>
      ) : null}
    </span>
  );
}

export function LoginCatalogPicker({
  catalog,
  onPick,
  onCustom,
  savedHosts,
}: {
  catalog: LoginCatalog;
  onPick: (site: LoginCatalogEntry) => void;
  onCustom: () => void;
  /** Hosts already saved on this org (shown as "Saved"). */
  savedHosts: string[];
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupLoginCatalog(catalog, query), [catalog, query]);
  const matches = groups.reduce((n, g) => n + g.sites.length, 0);
  const saved = new Set(savedHosts.map((h) => h.toLowerCase()));
  return (
    <div data-testid="logins-catalog">
      {/* The search bar sits at the very top and filters every site by name, category or address as you type. */}
      <div className="sticky top-0 z-10 bg-paper-0 pb-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-600"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sites by name or category: Outlook, QuickBooks, Restoration…"
            className="w-full rounded-xl border-2 border-line bg-paper-0 py-3 pl-11 pr-3 text-base text-ink-900 shadow-sm outline-none transition focus:border-brand-600"
            autoComplete="off"
            autoFocus
            aria-label="Search sites"
            data-testid="logins-catalog-search"
          />
        </div>
        <p
          className="mt-1.5 text-xs text-ink-600"
          aria-live="polite"
          data-testid="logins-catalog-count"
        >
          {query.trim()
            ? `${matches} ${matches === 1 ? 'site matches' : 'sites match'} “${query.trim()}”`
            : `${catalog.sites.length} sites, ready to sign in with a saved login`}
        </p>
      </div>
      <div className="mt-1 max-h-[28rem] space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">
              {g.label}
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => onPick(site)}
                  className="flex items-start gap-2.5 rounded-lg border border-line bg-paper-0 p-2.5 text-left transition hover:border-brand-600"
                  data-testid={`logins-catalog-${site.id}`}
                >
                  <SiteLogo site={site} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">
                      {site.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-600">
                      {site.host}
                      {saved.has(site.host.toLowerCase()) ? ' · Saved' : ''}
                    </span>
                    <SiteBadges site={site} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 ? (
          <p className="text-sm text-ink-600" data-testid="logins-catalog-empty">
            No site matches “{query}”. Use Custom website for any other site.
          </p>
        ) : null}
        <section aria-label="Other">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">
            Any other site
          </h3>
          <button
            type="button"
            onClick={onCustom}
            className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line bg-paper-0 p-2.5 text-left transition hover:border-brand-600 sm:w-auto"
            data-testid="logins-catalog-custom"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-paper-50 text-base font-bold text-ink-700"
            >
              +
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink-900">Custom website</span>
              <span className="block text-[11px] text-ink-600">
                Carrier portals, permit sites, anything with a sign-in page
              </span>
            </span>
          </button>
        </section>
      </div>
    </div>
  );
}
