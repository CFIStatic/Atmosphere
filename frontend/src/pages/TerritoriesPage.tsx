import { useEffect, useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import { api, type Territory } from '../lib/api';
import { GlobeIcon, SpinnerIcon } from '../components/icons';
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

      {/* The map, then who is in it, then the definitions. Somebody opening
          this page is asking "where do we cover" and "who is there right
          now" — the ZIP lists below are reference material for both. */}
      <div className="mt-6 space-y-4">
        <TerritoryMap focusId={focusId} onFocus={setFocusId} />
        <CrewMap />
      </div>

      {items === null ? (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No territories yet"
            hint="Start with the metros you already work. A territory is how you tell who is responsible for the accounts in an area — and who has nobody covering them."
          />
        </div>
      ) : (
        <>
          {unowned > 0 && (
            <p className="mt-6 rounded-lg border border-caution-200 bg-caution-50 px-4 py-3 text-sm text-caution-600">
              {unowned} {unowned === 1 ? 'territory has' : 'territories have'} nobody assigned.
            </p>
          )}
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {items.map((territory) => (
              <li
                key={territory.id}
                className={`rounded-xl glass-card p-4 transition ${
                  focusId === territory.id ? 'ring-2 ring-brand-300' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* The name is the control: clicking it frames this
                        territory on the map above, which is the natural
                        gesture and saves a second row of buttons. */}
                    <button
                      onClick={() =>
                        setFocusId((current) => (current === territory.id ? null : territory.id))
                      }
                      aria-pressed={focusId === territory.id}
                      className="text-left text-sm font-semibold text-ink-900 hover:text-brand-600"
                    >
                      {territory.name}
                    </button>
                    {territory.description && (
                      <p className="mt-0.5 text-xs text-ink-600">{territory.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {territory.postalCodes.length === 0 && (
                      <span
                        title="Weather alerts match this territory by county name only, which is far coarser. Add ZIP codes for street-level matching."
                        className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600"
                      >
                        no ZIPs
                      </span>
                    )}
                    {!territory.ownerId && (
                      <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600">
                        unassigned
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[...territory.postalCodes, ...territory.cities, ...territory.counties]
                    .slice(0, 8)
                    .map((area) => (
                      <span
                        key={area}
                        className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[11px] text-ink-600"
                      >
                        {area}
                      </span>
                    ))}
                  {territory.postalCodes.length +
                    territory.cities.length +
                    territory.counties.length >
                    8 && (
                    <span className="px-1 text-[11px] text-ink-500">
                      +
                      {territory.postalCodes.length +
                        territory.cities.length +
                        territory.counties.length -
                        8}{' '}
                      more
                    </span>
                  )}
                  {territory.postalCodes.length +
                    territory.cities.length +
                    territory.counties.length ===
                    0 && (
                    <span className="flex items-center gap-1 text-[11px] text-ink-500">
                      <GlobeIcon width={12} height={12} /> No area defined yet
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
