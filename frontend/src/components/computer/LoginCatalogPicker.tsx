import { CircleCheck, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  groupLoginCatalog,
  type ComputerLogin,
  type LoginCatalog,
  type LoginCatalogEntry,
} from '../../lib/computer';

/** Public favicon for a site host (Google’s favicon service). Falls back to the monogram on error. */
export function siteLogoUrl(host: string): string {
  const clean = host.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`;
}

function sizeClass(size: 'sm' | 'md' | 'lg'): string {
  if (size === 'lg') return 'h-10 w-10 text-sm';
  if (size === 'sm') return 'h-7 w-7 text-[10px]';
  return 'h-8 w-8 text-[11px]';
}

/** Company logo for a catalog site, with monogram fallback. */
export function SiteLogo({
  site,
  size = 'md',
}: {
  site: Pick<LoginCatalogEntry, 'logo' | 'name' | 'host'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <HostLogo
      host={site.host}
      name={site.name}
      monogram={site.logo}
      size={size}
    />
  );
}

/** Logo by hostname (saved login rows and catalog). Monogram when the image fails. */
export function HostLogo({
  host,
  name,
  monogram,
  size = 'md',
}: {
  host: string;
  name: string;
  monogram?: { text: string; color: string } | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const dims = sizeClass(size);
  const fromName = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const initials = monogram?.text || fromName || host.slice(0, 2).toUpperCase() || '?';
  const color = monogram?.color ?? '#475569';

  if (!failed && host.trim()) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper-0 ${dims}`}
        data-testid="site-logo"
      >
        <img
          src={siteLogoUrl(host)}
          alt=""
          className="h-full w-full object-contain p-1"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${dims}`}
      style={{ backgroundColor: color }}
      data-testid="site-logo-monogram"
    >
      {initials}
    </span>
  );
}

/** One small muted line for sites that usually ask for a code at sign-in. */
export const CODE_LINE = 'This site may send a code; Computer will ask you for it.';

/** The small green check on a site that already has a saved login. */
export function SavedCheck() {
  return (
    <CircleCheck
      role="img"
      aria-label="Saved"
      className="h-4 w-4 shrink-0 text-success-600"
      strokeWidth={2.5}
      data-testid="logins-saved-check"
    >
      <title>Saved</title>
    </CircleCheck>
  );
}

const tileClass =
  'flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-left transition hover:border-brand-600 focus-visible:border-brand-600 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line';

const gridClass = 'grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3';

function Tile({
  logo,
  name,
  saved,
  attention,
  disabled,
  onClick,
  testId,
}: {
  logo: ReactNode;
  name: string;
  saved: boolean;
  attention?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={tileClass}
      data-testid={testId}
      data-saved={saved ? 'true' : undefined}
    >
      {logo}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
          {saved ? <SavedCheck /> : null}
        </span>
        {attention ? (
          <span
            className="block truncate text-[11px] font-semibold text-danger-700"
            data-testid="logins-tile-attention"
          >
            Password needs attention
          </span>
        ) : null}
      </span>
    </button>
  );
}

const fold = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** A saved login: the catalog site it matched (if any), for its name and logo. */
export interface SavedEntry {
  login: ComputerLogin;
  site: LoginCatalogEntry | null;
}

/**
 * The site list: search, "Your logins" (every saved site, checked) first, then the catalog by
 * category (sites not saved yet). Custom website lives in the page header. No inner scroll; the page scrolls.
 */
export function LoginCatalogPicker({
  catalog,
  savedEntries,
  query,
  onQueryChange,
  onPick,
  onPickLogin,
  disabled = false,
}: {
  catalog: LoginCatalog | null;
  /** Every saved login, in list order, with its catalog site when it matched one. */
  savedEntries: SavedEntry[];
  query: string;
  onQueryChange: (next: string) => void;
  /** A site without a saved login: start adding it. */
  onPick: (site: LoginCatalogEntry) => void;
  /** A saved site: open its actions. */
  onPickLogin: (login: ComputerLogin) => void;
  /** New sign-ins can't start right now; saved sites stay open so they can still be managed. */
  disabled?: boolean;
}) {
  const savedSiteIds = useMemo(
    () => new Set(savedEntries.flatMap((e) => (e.site ? [e.site.id] : []))),
    [savedEntries],
  );
  const groups = useMemo(() => {
    if (!catalog) return [];
    const unsaved = { ...catalog, sites: catalog.sites.filter((s) => !savedSiteIds.has(s.id)) };
    return groupLoginCatalog(unsaved, query);
  }, [catalog, savedSiteIds, query]);
  const yours = useMemo(() => {
    const q = fold(query);
    if (!q) return savedEntries;
    return savedEntries.filter((e) =>
      [e.login.label, e.login.host, e.site?.name ?? '', ...(e.site?.aliases ?? [])].some((t) =>
        fold(t).includes(q),
      ),
    );
  }, [savedEntries, query]);
  const nothing = query.trim() !== '' && yours.length === 0 && groups.length === 0;

  return (
    <div data-testid="logins-catalog">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-500"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search sites"
          className="w-full rounded-xl border border-line bg-paper-0 py-3 pl-11 pr-3 text-base text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-brand-600"
          autoComplete="off"
          autoFocus
          aria-label="Search sites"
          data-testid="logins-catalog-search"
        />
      </div>

      <div className="mt-5 space-y-6">
        {yours.length > 0 ? (
          <section aria-label="Your logins" data-testid="logins-yours">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Your logins</h2>
            <div className={gridClass}>
              {yours.map(({ login, site }) => (
                <Tile
                  key={login.id}
                  logo={
                    site ? (
                      <SiteLogo site={site} />
                    ) : (
                      <HostLogo host={login.host} name={login.label} />
                    )
                  }
                  name={site?.name ?? login.label}
                  saved
                  attention={login.credential?.status === 'needs_attention'}
                  onClick={() => onPickLogin(login)}
                  testId={site ? `logins-catalog-${site.id}` : `logins-saved-${login.id}`}
                />
              ))}
            </div>
          </section>
        ) : null}

        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {g.label}
            </h3>
            <div className={gridClass}>
              {g.sites.map((site) => (
                <Tile
                  key={site.id}
                  logo={<SiteLogo site={site} />}
                  name={site.name}
                  saved={false}
                  disabled={disabled}
                  onClick={() => onPick(site)}
                  testId={`logins-catalog-${site.id}`}
                />
              ))}
            </div>
          </section>
        ))}

        {nothing ? (
          <p className="text-sm text-ink-600" data-testid="logins-catalog-empty">
            No site matches “{query.trim()}”. Use + Add above to add it.
          </p>
        ) : null}

      </div>
    </div>
  );
}
