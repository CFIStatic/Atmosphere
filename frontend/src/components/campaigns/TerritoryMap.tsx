import { useEffect, useMemo, useState } from 'react';
import { api, type TerritoryMapEntry } from '../../lib/api';
import { projectUsa } from '../../lib/albersUsa';
import { USA_STATES, USA_VIEWBOX } from '../../lib/usaGeography';

/**
 * The country, with your patch of it shaded.
 *
 * Two layers, saying two different things, and the difference is the whole
 * reason this is careful:
 *
 *   The faint wash over a state means "you have ZIP codes in here". It is not
 *   a claim to cover the state. Eleven codes around Austin are not Texas, and
 *   a map that filled Texas solid for them would be lying at a glance to the
 *   person deciding where to send a crew.
 *
 *   The orange haze is the real answer: a soft radius around each located ZIP
 *   centroid, which at national zoom is about the size the ZIP actually is.
 *   Overlapping codes merge into one shape, so a metro territory reads as a
 *   blob and a rural one reads as scattered dots — which is the truth about
 *   both.
 *
 * Zoom exists because a national map of a suburban territory is a smudge. It
 * frames whatever is selected, and the frame is computed from the points
 * rather than the states, or picking one ZIP in Alaska would zoom out to the
 * whole country.
 */

interface Props {
  /** Null shades every territory; an id shades just that one. */
  focusId?: string | null;
  onFocus?: (id: string | null) => void;
}

/** Roughly a ZIP's worth of radius at this projection — about six miles. */
const ZIP_RADIUS = 4.2;

export function TerritoryMap({ focusId = null, onFocus }: Props) {
  const [entries, setEntries] = useState<TerritoryMapEntry[] | null>(null);
  const [coverage, setCoverage] = useState({ located: 0, total: 0 });
  // Opens on the country. Somebody looking at a national map wants to see the
  // country and where they sit in it; zooming straight to a metro answers a
  // question they have not asked yet.
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .territoryMap()
      .then((res) => {
        if (!live) return;
        setEntries(res.territories);
        setCoverage({ located: res.located, total: res.total });
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not draw the map.');
        setEntries([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(
    () => (entries ?? []).filter((t) => !focusId || t.id === focusId),
    [entries, focusId],
  );

  // Project once per change, not once per render of every circle.
  const plotted = useMemo(
    () =>
      shown.flatMap((t) =>
        t.points
          .map((p) => {
            const at = projectUsa(p.lon, p.lat);
            return at ? { ...p, territoryId: t.id, territory: t.name, x: at[0], y: at[1] } : null;
          })
          .filter((p): p is NonNullable<typeof p> => p !== null),
      ),
    [shown],
  );

  const litStates = useMemo(() => {
    const set = new Set<string>();
    for (const t of shown) for (const s of t.states) set.add(s);
    return set;
  }, [shown]);

  // Frame the points with a margin, clamped so a single ZIP does not zoom to
  // street level and a national footprint does not zoom past the country.
  const view = useMemo(() => {
    const full = `0 0 ${USA_VIEWBOX.width} ${USA_VIEWBOX.height}`;
    if (!zoomed || plotted.length === 0) return full;

    const xs = plotted.map((p) => p.x);
    const ys = plotted.map((p) => p.y);
    const pad = 28;
    let minX = Math.min(...xs) - pad;
    let minY = Math.min(...ys) - pad;
    let w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    let h = Math.max(...ys) - Math.min(...ys) + pad * 2;

    // Keep the aspect ratio of the frame, or the country distorts.
    const ratio = USA_VIEWBOX.width / USA_VIEWBOX.height;
    if (w / h < ratio) {
      const want = h * ratio;
      minX -= (want - w) / 2;
      w = want;
    } else {
      const want = w / ratio;
      minY -= (want - h) / 2;
      h = want;
    }

    // Below about a tenth of the country the outlines are coarser than the
    // zoom, and the state shapes start to look hand-drawn.
    const minWidth = USA_VIEWBOX.width / 9;
    if (w < minWidth) {
      minX -= (minWidth - w) / 2;
      minY -= (minWidth / ratio - h) / 2;
      h = minWidth / ratio;
      w = minWidth;
    }
    if (w >= USA_VIEWBOX.width) return full;

    return `${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [plotted, zoomed]);

  const zoomScale = useMemo(() => {
    const parts = view.split(' ').map(Number);
    return USA_VIEWBOX.width / (parts[2] || USA_VIEWBOX.width);
  }, [view]);

  const focused = focusId ? (entries ?? []).find((t) => t.id === focusId) ?? null : null;
  const missing = coverage.total - coverage.located;

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">
          {focused ? focused.name : 'Where you cover'}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {focused && onFocus && (
            <button onClick={() => onFocus(null)} className="text-brand-600 hover:text-brand-700">
              Show all territories
            </button>
          )}
          {/* A real button, not a faint link: at national zoom a metro
              territory is a few pixels, and this is the control that answers
              the question the page was opened with. */}
          <button
            onClick={() => setZoomed((z) => !z)}
            className="rounded-full glass-card px-3 py-1.5 font-medium text-ink-600 transition hover:text-ink-900"
            aria-pressed={zoomed}
          >
            {zoomed ? 'Zoom out to the country' : 'Fit to my territories'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Shaded where your ZIP codes actually are — not the whole state. The paler wash is every
        state you have any codes in.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-paper-50">
        <svg
          viewBox={view}
          // Capped, or a full-width national map is 900px tall and pushes
          // everything else on the page below the fold.
          className="mx-auto block max-h-[26rem] w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={
            focused
              ? `Map of the United States with ${focused.name} shaded`
              : 'Map of the United States with your territories shaded'
          }
        >
          <defs>
            {/* Blur then re-sharpen the alpha: overlapping ZIP circles merge
                into one shape with a defined edge instead of stacking into a
                lumpy gradient. */}
            <filter id="terr-haze" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation={3 / Math.sqrt(zoomScale)} result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -5"
              />
            </filter>
          </defs>

          {/* The country, one flat surface. Every state the same, because a
              state is not the unit of anything here. */}
          <g>
            {USA_STATES.map((state) => (
              <path
                key={state.code}
                d={state.d}
                className="fill-paper-100 stroke-line"
                strokeWidth={0.7 / zoomScale}
              >
                <title>{state.name}</title>
              </path>
            ))}
          </g>

          {/* States you have codes in. Deliberately barely there: it is a hint
              about where to look, and anything stronger starts to read as "we
              cover Texas", which is not what eleven ZIP codes around Austin
              mean. The opacity is a theme variable because the same alpha over
              near-black reads twice as loud as it does over paper. */}
          <g style={{ opacity: 'var(--map-tint, 0.1)' }}>
            {USA_STATES.filter((s) => litStates.has(s.code)).map((state) => (
              <path key={state.code} d={state.d} className="fill-brand-500" />
            ))}
          </g>

          {/* The coverage itself. */}
          <g filter="url(#terr-haze)" opacity={0.55}>
            {plotted.map((p) => (
              <circle
                key={`${p.territoryId}-${p.zip}`}
                cx={p.x}
                cy={p.y}
                r={ZIP_RADIUS}
                className="fill-brand-400"
              />
            ))}
          </g>

          {/* A hard centre per ZIP, so a lone code is still visible once the
              haze has been spread thin by the blur. */}
          <g>
            {plotted.map((p) => (
              <circle
                key={`dot-${p.territoryId}-${p.zip}`}
                cx={p.x}
                cy={p.y}
                r={Math.max(0.7, 1.6 / zoomScale)}
                className="fill-brand-600"
              >
                <title>
                  {p.zip}
                  {p.place ? ` — ${p.place}` : ''} · {p.territory}
                </title>
              </circle>
            ))}
          </g>
        </svg>
      </div>

      {/* A legend that is also the control: clicking a territory frames it. */}
      {entries && entries.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {entries.map((t) => {
            const on = focusId === t.id;
            return (
              <li key={t.id}>
                <button
                  onClick={() => onFocus?.(on ? null : t.id)}
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    on ? 'bg-brand-600 text-ink-900' : 'glass-card text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {t.name}
                  <span className={on ? 'ml-1.5 opacity-80' : 'ml-1.5 text-ink-400'}>
                    {t.states.length ? t.states.join(' · ') : 'no ZIPs'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-ink-400">
        Boundaries from the US Census Bureau
        {coverage.total > 0 && (
          <>
            {' · '}
            {coverage.located} of {coverage.total} ZIP codes placed
            {missing > 0 ? ` — ${missing} still resolving, and not drawn yet` : ''}
          </>
        )}
        {/* Territories in states this projection has nowhere to put. Silently
            dropping them is how somebody concludes the map is broken. */}
        {litStates.has('PR') || litStates.has('VI') ? (
          <> · Puerto Rico and the US Virgin Islands are not on this projection</>
        ) : null}
      </p>
    </section>
  );
}
