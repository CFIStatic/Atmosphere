import { useProductHealth } from '../hooks/useProductHealth';
import { count, decimal, pctChange, weekLabel } from '../lib/format';
import { Delta, ErrorLine, Footnotes, Fn, LineChart, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';
import type { NorthStarWeek } from '../lib/types';

function weeklySheet(name: string, rows: NorthStarWeek[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'Week of (Mon, UTC)', type: 'date' },
      { header: 'Week in progress' },
      { header: 'Paying orgs', type: 'integer' },
      { header: 'Paying seats', type: 'integer' },
      { header: 'Films', type: 'integer' },
      { header: 'Hours, paying', type: 'number' },
      { header: 'Hours, all orgs', type: 'number' },
      { header: 'Hours per seat', type: 'number' },
      { header: 'Change vs prior week', type: 'percent' },
    ],
    rows: rows.map((w, i) => [
      w.weekStart,
      w.partial,
      w.payingOrgs,
      w.payingSeats,
      w.films,
      w.hoursPaying,
      w.hoursAll,
      w.hoursPerSeat,
      w.partial ? null : pctChange(w.hoursPerSeat, rows[i + 1]?.hoursPerSeat),
    ]),
  };
}

/** Detail page for the north star: the weekly chart, every week's inputs, and the definition. */
export function NorthStarPage() {
  const health = useProductHealth(12);
  const h = health.data;

  if (health.loading && !h) return <Loading label="Loading north star" />;

  const weekly = h?.northStar.weekly ?? [];
  const complete = weekly.filter((w) => !w.partial);

  return (
    <div>
      <PageHeader
        eyebrow="Atmosphere Analytics · Summary"
        title="North star: hours filmed per paying seat"
        subtitle="Hours of work filmed per paying seat, weekly. It rises only when paying customers capture real jobs."
        asOfValue={h?.generatedAt ?? null}
      />

      {health.error && <ErrorLine message={health.error} onRetry={() => void health.reload()} />}

      {h && (
        <>
          <Section
            title="Hours filmed per paying seat, weekly"
            note="Complete weeks, Monday–Sunday UTC"
            actions={
              <DownloadButton
                table="north-star-chart"
                label="chart data"
                sheets={() => [weeklySheet('North star chart', [...complete].reverse())]}
              />
            }
          >
            <LineChart
              ariaLabel="Hours filmed per paying seat by week"
              format={(v) => decimal(v, 1)}
              xLabel={weekLabel}
              series={[
                { label: 'hrs / seat', primary: true, points: complete.map((w) => ({ x: w.weekStart, y: w.hoursPerSeat })) },
              ]}
            />
          </Section>

          <Section
            title="Weekly detail"
            note="Most recent first; the week in progress is marked “to date”"
            actions={
              <DownloadButton
                table="north-star-weekly-detail"
                label="weekly detail"
                sheets={() => [weeklySheet('Weekly detail', [...weekly].reverse())]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Week of<Fn n={1} /></th>
                    <th className="num">Paying orgs</th>
                    <th className="num">Paying seats</th>
                    <th className="num">Films</th>
                    <th className="num">Hours, paying</th>
                    <th className="num">Hours, all orgs</th>
                    <th className="num">Hrs / seat</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weekly].reverse().map((w, i, rows) => {
                    const prior = rows[i + 1];
                    return (
                      <tr key={w.weekStart}>
                        <td className="whitespace-nowrap">
                          {weekLabel(w.weekStart)}
                          {w.partial && <span className="ml-1.5 text-[11px] text-ink-500">to date</span>}
                        </td>
                        <td className="num">{count(w.payingOrgs)}</td>
                        <td className="num">{count(w.payingSeats)}</td>
                        <td className="num">{count(w.films)}</td>
                        <td className="num">{decimal(w.hoursPaying, 1)}</td>
                        <td className="num text-ink-600">{decimal(w.hoursAll, 1)}</td>
                        <td className="num font-semibold text-ink-900">{decimal(w.hoursPerSeat)}</td>
                        <td className="num">
                          {w.partial ? (
                            <span className="text-ink-400">n/a</span>
                          ) : (
                            <Delta value={pctChange(w.hoursPerSeat, prior?.hoursPerSeat)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Footnotes
        asOfValue={h?.generatedAt ?? null}
        notes={[
          <>
            Hours filmed per paying seat: total duration of capture videos received in the week from organizations whose
            latest billing event is active or past due with MRR above zero, divided by those organizations’ billed seats.
            Sources: job_proofs.duration_seconds and received_at, org_billing_events. Trial and free usage is excluded
            (hours, all orgs includes it). Weeks are Monday–Sunday UTC; the week in progress is not charted.
          </>,
        ]}
      />
    </div>
  );
}
