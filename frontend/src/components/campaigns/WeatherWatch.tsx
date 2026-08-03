import { useEffect, useState } from 'react';
import { api, type WeatherAlert } from '../../lib/api';

/**
 * What the weather is doing where you sell, and what your campaigns would do
 * about it.
 *
 * Two halves, and the second is the one that gets used. "There is a severe
 * thunderstorm warning for Williamson County" is the news; "and your North
 * Austin campaign would go out to 34 people because of it" is the reason to
 * have opened the page.
 *
 * The skipped list is shown as prominently as the firing one on purpose. A
 * campaign that stayed silent through a hail storm is exactly the thing
 * somebody needs explained, and "why didn't this send?" is the question that
 * actually gets asked.
 */
export function WeatherWatch() {
  const [alerts, setAlerts] = useState<WeatherAlert[] | null>(null);
  const [attribution, setAttribution] = useState('');
  const [coverage, setCoverage] = useState<{
    states: string[];
    zipsLocated: number;
    zipsTotal: number;
  } | null>(null);
  const [pending, setPending] = useState<{
    fire: Array<{ campaignId: string; campaignName: string; reason: string }>;
    skip: Array<{ campaignId: string; campaignName: string; reason: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.activeWeather(), api.pendingCampaigns()])
      .then(([weather, decisions]) => {
        if (!live) return;
        setAlerts(weather.alerts);
        setAttribution(weather.attribution);
        setCoverage({
          states: weather.statesWatched ?? [],
          zipsLocated: weather.zipsLocated ?? 0,
          zipsTotal: weather.zipsTotal ?? 0,
        });
        setPending(decisions);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not read the forecast.');
        setAlerts([]);
      });
    return () => {
      live = false;
    };
  }, []);

  // Alerts touching a territory this org actually covers come first — the rest
  // of the state is context, not news.
  const mine = (alerts ?? []).filter((a) => a.territories.length > 0);
  const elsewhere = (alerts ?? []).filter((a) => a.territories.length === 0);

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Weather in your territories</h2>
        {/* Which states are being watched, derived from the ZIPs in the
            territories rather than configured anywhere. */}
        <span className="text-xs text-ink-500">
          {coverage?.states.length
            ? coverage.states.join(' · ')
            : 'No states yet — add ZIP codes to a territory'}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Live alerts, and what your campaigns would do about them right now. Nothing is sent from
        this page.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {alerts === null ? (
        <p className="mt-4 text-sm text-ink-600">Checking…</p>
      ) : (
        <div className="mt-4 space-y-4">
          {mine.length === 0 ? (
            <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
              Nothing active in your territories.
              {elsewhere.length > 0 && (
                <>
                  {' '}
                  <span className="tabular-nums">{elsewhere.length}</span> alert
                  {elsewhere.length === 1 ? '' : 's'} elsewhere in{' '}
                  {coverage?.states.join(', ') || 'the states you work'}.
                </>
              )}
            </p>
          ) : (
            <ul className="space-y-2">
              {mine.map((alert) => (
                <li key={alert.id} className="rounded-lg border border-caution-200 bg-caution-50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-caution-600">{alert.event}</span>
                    <span className="text-xs text-ink-600">
                      {alert.hoursOfNotice !== null && alert.hoursOfNotice > 0
                        ? `~${Math.round(alert.hoursOfNotice)}h out`
                        : 'in effect'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-700">{alert.areaDesc}</p>
                  {/* Which ZIPs, not just which county. A warning polygon is
                      often a fraction of a county, and "four of your codes"
                      is a different instruction from "Williamson County". */}
                  <ul className="mt-1.5 space-y-0.5">
                    {alert.territories.map((t) => (
                      <li key={t.id} className="text-[11px] text-ink-500">
                        <span className="text-ink-700">{t.name}</span>
                        {t.zips && t.zips.length > 0 ? (
                          <>
                            {' — '}
                            {t.zips.slice(0, 6).join(', ')}
                            {t.zips.length > 6 ? ` +${t.zips.length - 6} more` : ''}
                          </>
                        ) : (
                          <span className="text-ink-400">
                            {' '}
                            — county-level match only
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {pending && (pending.fire.length > 0 || pending.skip.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Would send now</h3>
                {pending.fire.length === 0 ? (
                  <p className="mt-1.5 text-xs text-ink-500">Nothing.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {pending.fire.map((f) => (
                      <li key={f.campaignId} className="rounded-lg border border-success-200 bg-success-50 px-3 py-2">
                        <span className="block text-xs font-semibold text-success-600">
                          {f.campaignName}
                        </span>
                        <span className="block text-[11px] text-ink-600">{f.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-ink-900">Holding back</h3>
                {pending.skip.length === 0 ? (
                  <p className="mt-1.5 text-xs text-ink-500">Nothing.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {pending.skip.map((s) => (
                      <li key={s.campaignId} className="rounded-lg glass-card px-3 py-2">
                        <span className="block text-xs font-medium text-ink-800">
                          {s.campaignName}
                        </span>
                        <span className="block text-[11px] text-ink-500">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {attribution && (
        <p className="mt-4 text-[11px] text-ink-400">
          {attribution}
          {coverage && coverage.zipsTotal > 0 && (
            <>
              {' · '}
              {coverage.zipsLocated} of {coverage.zipsTotal} ZIP codes located
              {coverage.zipsLocated < coverage.zipsTotal
                ? ' — the rest resolve over the next few checks and match by county meanwhile'
                : ''}
            </>
          )}
        </p>
      )}
    </section>
  );
}
