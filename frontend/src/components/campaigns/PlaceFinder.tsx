import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type FoundPlace,
  type PlaceCategory,
  type Territory,
} from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Finding the buildings in a territory.
 *
 * A restoration salesperson thinks in buildings before they think in people:
 * "every school in Round Rock", "the clinics off 183". The facilities director
 * is how you reach an account, not the account itself — so this searches for
 * places, and the contact comes later.
 *
 * The data is OpenStreetMap. Free to query and free to keep, which is why the
 * results can be saved to a territory instead of re-fetched every time
 * somebody opens the page — and why the attribution line is not optional.
 */
export function PlaceFinder({
  territories,
  onImported,
}: {
  territories: Territory[];
  onImported: (count: number) => void;
}) {
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [attribution, setAttribution] = useState('');
  const [picked, setPicked] = useState<string[]>(['school']);
  const [area, setArea] = useState('');
  const [territoryId, setTerritoryId] = useState('');

  const [results, setResults] = useState<FoundPlace[] | null>(null);
  const [where, setWhere] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .placeCategories()
      .then((res) => {
        setCategories(res.categories);
        setAttribution(res.attribution);
      })
      .catch(() => setCategories([]));
  }, []);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    setResults(null);
    try {
      const res = await api.searchPlaces(area, picked);
      setResults(res.places);
      setWhere(res.box?.displayName ?? null);
      setNote(res.note);
      // Everything found is selected: the common case is keeping the lot, and
      // unticking three is less work than ticking forty.
      setSelected(new Set(res.places.map((p) => p.externalId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search that area.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!results) return;
    setSaving(true);
    setError(null);
    try {
      const chosen = results.filter((p) => selected.has(p.externalId));
      const res = await api.importPlaces(chosen, territoryId || null);
      onImported(res.imported);
      setNote(`Saved ${res.imported} ${res.imported === 1 ? 'place' : 'places'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save those.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <h2 className="text-base font-semibold text-ink-900">Find buildings in an area</h2>
      <p className="mt-1 text-sm text-ink-600">
        Every school, hospital or clinic in a place you work — then keep the ones worth calling.
      </p>

      <form onSubmit={search} className="mt-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                title={c.blurb}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  on
                    ? 'bg-brand-600 text-ink-900'
                    : 'glass-card text-ink-600 hover:text-ink-900'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Where</span>
            <input
              className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Round Rock, TX  ·  or  78664"
              required
              minLength={2}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Save to</span>
            <select
              className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              value={territoryId}
              onChange={(e) => setTerritoryId(e.target.value)}
            >
              <option value="">No territory</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !picked.length}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            Search
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}
      {note && <p className="mt-3 text-sm text-ink-600">{note}</p>}

      {results && results.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-ink-700">
              <span className="tabular-nums">{results.length}</span> found
              {where ? ` in ${where.split(',').slice(0, 2).join(', ')}` : ''} ·{' '}
              <span className="tabular-nums">{selected.size}</span> selected
            </p>
            <button
              onClick={() => void keep()}
              disabled={saving || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving && <SpinnerIcon className="animate-spin" width={14} height={14} />}
              Keep selected
            </button>
          </div>

          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
            {results.map((place) => {
              const on = selected.has(place.externalId);
              return (
                <li key={place.externalId}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-paper-100/40">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(place.externalId)) next.delete(place.externalId);
                          else next.add(place.externalId);
                          return next;
                        })
                      }
                      className="mt-0.5 accent-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink-800">{place.name}</span>
                      <span className="block text-xs text-ink-500">
                        {[place.street, place.city, place.postalCode].filter(Boolean).join(', ') ||
                          'No address mapped'}
                        {place.phone ? ` · ${place.phone}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {attribution && <p className="mt-4 text-[11px] text-ink-400">{attribution}</p>}
    </section>
  );
}
