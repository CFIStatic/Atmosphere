import { useEffect, useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import { api, type Territory } from '../lib/api';
import { GlobeIcon, SearchIcon, SpinnerIcon } from '../components/icons';
import { CrewMap } from '../components/campaigns/CrewMap';
import { TerritoryMap } from '../components/campaigns/TerritoryMap';

/**
 * Territories — who owns which patch of the map.
 *
 * Restoration is sold geographically, because that is how storms, adjusters
 * and drive times work. Which means "who owns Round Rock" is a question the
 * product has to be able to answer, and until now it could not: the pipeline
 * knows about leads, and a territory exists before any lead in it and outlives
 * every one of them.
 *
 * Areas are described the way sales teams actually talk — ZIPs, cities,
 * counties — rather than as geometry. Forcing "Austin metro" into a polygon
 * would make the feature unusable by the people who need it. The map is drawn
 * *from* those lists instead: each ZIP is located once and shaded, so nobody
 * traces a boundary and the picture still comes out.
 *
 * An unowned territory is shown as a gap rather than hidden, because that is
 * the thing worth noticing on this page.
 */
export function TerritoriesPage() {
  const [items, setItems] = useState<Territory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which territory the map is framed on. Held here rather than inside the
  // map so a card in the list below can drive it too.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [areas, setAreas] = useState('');

  async function load() {
    try {
      const res = await api.territories();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load territories.');
      setItems([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // One box for all three kinds of area: people type "78701, Round Rock,
      // Williamson County" and should not have to decide which field each part
      // belongs in. Anything numeric is a postal code; anything ending in
      // "county" is a county; the rest are cities.
      const parts = areas
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const postalCodes = parts.filter((p) => /^\d{5}(-\d{4})?$/.test(p));
      const counties = parts.filter((p) => /county$/i.test(p));
      const cities = parts.filter((p) => !postalCodes.includes(p) && !counties.includes(p));

      await api.createTerritory({
        name,
        description: description || null,
        postalCodes,
        cities,
        counties,
      });
      setName('');
      setDescription('');
      setAreas('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that territory.');
    } finally {
      setBusy(false);
    }
  }

  const unowned = (items ?? []).filter((t) => !t.ownerId).length;

  // Matches on everything a territory is described by, not just its name:
  // people look for "78664" or "Williamson" at least as often as "North
  // Austin", and a search that only read the name would come back empty for
  // the thing they are holding in their hand.
  const query = search.trim().toLowerCase();
  const listed = (items ?? []).filter((t) => {
    if (!query) return true;
    return [t.name, t.description ?? '', ...t.postalCodes, ...t.cities, ...t.counties]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const selected = focusId ? (items ?? []).find((t) => t.id === focusId) ?? null : null;

  const areasOf = (t: Territory) => [...t.postalCodes, ...t.cities, ...t.counties];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="Territories"
        description="Who covers where. Restoration is sold geographically — a territory is a standing claim on a patch of the map with one person accountable for it."
        action={
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700"
          >
            {creating ? 'Cancel' : 'New territory'}
          </button>
        }
      />

      {creating && (
        <form onSubmit={create} className="mt-6 space-y-4 rounded-xl glass-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Name</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="North Austin"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Notes</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Multifamily and HOA focus"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Area</span>
            <input
              className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              value={areas}
              onChange={(e) => setAreas(e.target.value)}
              placeholder="78664, 78665, 78681, Round Rock, Williamson County"
            />
            <span className="mt-1.5 block text-xs text-ink-500">
              ZIP codes first — they are what weather alerts are matched against, street by street
              rather than county by county. Cities and counties can go in the same box and get
              sorted out for you.
            </span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            Create territory
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {/* List beside map, not list under map. Selecting a territory used to
          change a picture that had scrolled off the top of the screen, which
          is the whole reason this page was awkward. The map stays put while
          the list is worked through. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* Map first in the source order so it is what appears on a phone,
            where nothing can be sticky and the list runs long. */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:order-2">
          <TerritoryMap focusId={focusId} onFocus={setFocusId} />
          <CrewMap focusTerritoryId={focusId} focusName={selected?.name ?? null} />
        </div>

        <div className="lg:order-1">
          {unowned > 0 && (
            <p className="mb-3 rounded-lg border border-caution-200 bg-caution-50 px-4 py-2.5 text-sm text-caution-600">
              {unowned} {unowned === 1 ? 'territory has' : 'territories have'} nobody assigned.
            </p>
          )}

          <div className="rounded-xl glass-card">
            <div className="border-b border-line p-3">
              <label className="relative block">
                <span className="sr-only">Search territories</span>
                <SearchIcon
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                  width={14}
                  height={14}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, ZIP, city, county"
                  className="w-full rounded-lg glass-field py-2 pl-9 pr-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
                />
              </label>

              {/* The way back out. Without it the only way to unselect is to
                  find the highlighted row again and click it a second time. */}
              <button
                onClick={() => setFocusId(null)}
                aria-pressed={focusId === null}
                className={`mt-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  focusId === null
                    ? 'bg-brand-600/10 font-medium text-brand-600'
                    : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                All territories
                <span className="text-xs tabular-nums text-ink-400">{(items ?? []).length}</span>
              </button>
            </div>

            {items === null ? (
              <p className="p-4 text-sm text-ink-600">Loading…</p>
            ) : items.length === 0 ? (
              <div className="p-2">
                <EmptyState
                  title="No territories yet"
                  hint="Start with the metros you already work. A territory is how you tell who is responsible for the accounts in an area — and who has nobody covering them."
                />
              </div>
            ) : listed.length === 0 ? (
              <p className="p-4 text-sm text-ink-600">
                Nothing matches “{search.trim()}”.
              </p>
            ) : (
              // Capped and scrollable: a franchise group has dozens, and a
              // list that pushed the page to six screens would undo the point
              // of putting it beside the map.
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {listed.map((territory) => {
                  const on = focusId === territory.id;
                  const areas = areasOf(territory);
                  return (
                    <li key={territory.id}>
                      <button
                        onClick={() => setFocusId(on ? null : territory.id)}
                        aria-pressed={on}
                        className={`block w-full px-4 py-3 text-left transition ${
                          on ? 'bg-brand-600/10' : 'hover:bg-paper-200/40'
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={`text-sm font-semibold ${
                              on ? 'text-brand-600' : 'text-ink-900'
                            }`}
                          >
                            {territory.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {territory.postalCodes.length === 0 && (
                              <span
                                title="Weather alerts match this territory by county name only, which is far coarser. Add ZIP codes for street-level matching."
                                className="rounded-full bg-caution-50 px-2 py-0.5 text-[10px] font-semibold text-caution-600"
                              >
                                no ZIPs
                              </span>
                            )}
                            {!territory.ownerId && (
                              <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10px] font-semibold text-caution-600">
                                unassigned
                              </span>
                            )}
                          </span>
                        </span>

                        <span className="mt-0.5 block truncate text-xs text-ink-500">
                          {territory.description ||
                            (areas.length ? areas.slice(0, 3).join(' · ') : 'No area defined yet')}
                        </span>

                        <span className="mt-1 block text-[11px] text-ink-400">
                          {territory.postalCodes.length > 0 ? (
                            <>
                              {territory.postalCodes.length} ZIP
                              {territory.postalCodes.length === 1 ? '' : 's'}
                            </>
                          ) : (
                            <span className="flex items-center gap-1">
                              <GlobeIcon width={11} height={11} /> names only
                            </span>
                          )}
                        </span>
                      </button>

                      {/* The full area list only for the selection. Showing it
                          for every row is what made the old grid a wall of
                          five-digit numbers. */}
                      {on && areas.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-4 pb-3">
                          {areas.map((area) => (
                            <span
                              key={area}
                              className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[11px] text-ink-600"
                            >
                              {area}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

    </AppShell>
  );
}
