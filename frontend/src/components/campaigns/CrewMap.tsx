import { useEffect, useState } from 'react';
import { api, type CrewPosition } from '../../lib/api';
import { useLiveLocation } from '../../lib/useLiveLocation';

/**
 * Where the crew are, and whether you are sharing.
 *
 * Both halves are on one panel on purpose. A screen that showed you everyone
 * else's position without making your own sharing state equally prominent
 * would be the wrong shape for this feature — the people being located are the
 * people using it, and the toggle should not be somewhere else.
 *
 * There is no map here, and that is deliberate rather than pending. The
 * operational questions are "who is closest" and "who is in that territory",
 * and a sorted list answers both immediately on a phone in a truck. A map is
 * a nicer demo and a worse tool.
 */
export function CrewMap() {
  const location = useLiveLocation();
  const [crew, setCrew] = useState<CrewPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      api
        .crewPositions()
        .then((res) => {
          if (live) setCrew(res.items);
        })
        .catch((err) => {
          if (live) {
            setError(err instanceof Error ? err.message : 'Could not load crew positions.');
            setCrew([]);
          }
        });
    };

    load();
    // Half a minute is live enough for dispatch and gentle on a phone battery.
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [location.sharing]);

  const minutesAgo = (iso: string) =>
    Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Crew right now</h2>
        {location.active && (
          <span className="flex items-center gap-1.5 text-xs text-success-600">
            <span className="h-1.5 w-1.5 rounded-full bg-success-600" aria-hidden="true" />
            Sharing your location
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Who is where, so the closest person gets the call. Everyone chooses for themselves whether
        to appear here.
      </p>

      {/* Your own decision, stated in the first person because it is yours. */}
      <div className="mt-4 rounded-lg border border-line p-4">
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-800">Share my location</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
              Your position is visible to your own team while this is on, and to nobody outside it.
              Positions are deleted after a day. Turning this off erases the ones already
              collected — not just future ones.
            </span>
          </span>
          <button
            role="switch"
            aria-checked={location.sharing}
            aria-label="Share my location"
            disabled={location.loading}
            onClick={() => void location.setSharing(!location.sharing)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
              location.sharing ? 'bg-brand-600' : 'bg-line-strong'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                location.sharing ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>

        {location.error && (
          <p role="alert" className="mt-2 text-xs text-caution-600">
            {location.error}
          </p>
        )}
        {location.sharing && !location.active && !location.error && (
          <p className="mt-2 text-xs text-ink-500">Waiting for a location fix…</p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {crew === null ? (
        <p className="mt-4 text-sm text-ink-600">Checking…</p>
      ) : crew.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
          Nobody is sharing right now. Anyone on the team can turn it on above — it cannot be
          switched on for them.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {crew.map((person) => {
            const stale = minutesAgo(person.capturedAt) > 15;
            // A fix this coarse is a neighbourhood, not a location, and
            // presenting it as one would send somebody to the wrong place.
            const vague = (person.accuracyM ?? 0) > 500;

            return (
              <li
                key={person.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg glass-card px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-800">{person.name}</p>
                  <p className="text-xs text-ink-500">
                    {person.territory ? (
                      <span className="text-brand-600">{person.territory.name}</span>
                    ) : (
                      'Outside your territories'
                    )}
                    {person.nearestPlace && (
                      <>
                        {' · '}
                        {person.nearestPlace.miles} mi from {person.nearestPlace.name}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {vague && (
                    <span
                      title={`Accurate to about ${Math.round((person.accuracyM ?? 0) / 100) / 10} km`}
                      className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600"
                    >
                      approximate
                    </span>
                  )}
                  <span className={`text-xs ${stale ? 'text-ink-400' : 'text-ink-500'}`}>
                    {minutesAgo(person.capturedAt) === 0
                      ? 'just now'
                      : `${minutesAgo(person.capturedAt)}m ago`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
