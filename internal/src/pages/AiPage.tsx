import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canSeeAccounts } from '../lib/access';
import { useProductHealth } from '../hooks/useProductHealth';
import { count, msAsSeconds, pctChange, percent, shortDate } from '../lib/format';
import {
  Delta,
  ErrorLine,
  Fn,
  Footnotes,
  KpiStrip,
  Loading,
  NotTracked,
  PageHeader,
  Section,
} from '../components/report';
import { DownloadButton } from '../components/DownloadButton';

export function AiPage() {
  const { access } = useAuth();
  const { data: h, error, loading, reload } = useProductHealth(12);
  if (loading && !h) return <Loading label="Loading AI & Ask" />;
  const k = h?.ask;
  const pts = (a: number | null | undefined, b: number | null | undefined) =>
    a === null || a === undefined || b === null || b === undefined ? null : a - b;
  const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="Ask quality"
        subtitle="How often customers ask the job record a question, how fast the answer arrives, and how often it fails."
        asOfValue={h?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {k && (
        <>
          <KpiStrip
            download={{ table: 'ask-headline-figures' }}
            items={[
              {
                label: 'Questions asked',
                unit: 'count, last 4 wks',
                value: count(k.questions.current),
                raw: k.questions.current,
                rawType: 'integer',
                delta: <Delta value={pctChange(k.questions.current, k.questions.prior)} />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Organizations asking',
                unit: 'count, last 4 wks',
                value: count(k.questions.orgsCurrent),
                raw: k.questions.orgsCurrent,
                rawType: 'integer',
              },
              {
                label: 'Answer latency',
                unit: 'median, full answer',
                value: msAsSeconds(k.current.medianMs),
                raw: k.current.medianMs,
                rawUnit: 'milliseconds',
                delta: <Delta value={pctChange(k.current.medianMs, k.prior.medianMs)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'First token',
                unit: 'median time to first word',
                value: msAsSeconds(k.current.medianTtftMs),
                raw: k.current.medianTtftMs,
                rawUnit: 'milliseconds',
                delta: <Delta value={pctChange(k.current.medianTtftMs, k.prior.medianTtftMs)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Error rate',
                unit: '% of turns, last 4 wks',
                value: percent(k.current.errorRatePct),
                raw: k.current.errorRatePct,
                rawType: 'percent',
                delta: <Delta value={pts(k.current.errorRatePct, k.prior.errorRatePct)} format="pts" goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Answer feedback',
                unit: '% rated helpful',
                value: '—',
                note: 'Not tracked yet',
              },
            ]}
          />

          <Section
            title="Turn outcomes"
            note={k.trackingSince ? `Tracked since ${shortDate(k.trackingSince)}` : 'Tracking starts with this release'}
            actions={
              <DownloadButton
                table="ask-turn-outcomes"
                label="turn outcomes"
                sheets={() => [
                  {
                    name: 'Turn outcomes',
                    columns: [
                      { header: 'Outcome' },
                      { header: 'Last 4 wks', type: 'integer' },
                      { header: 'Share, last 4 wks', type: 'percent' },
                      { header: 'Prior 4 wks', type: 'integer' },
                      { header: 'Share, prior 4 wks', type: 'percent' },
                    ],
                    rows: [
                      ...(
                        [
                          ['Answered', 'answered'],
                          ['Error', 'errors'],
                          ['Refused (limit, access or validation)', 'refused'],
                          ['Stopped by the user', 'stopped'],
                        ] as const
                      ).map(([label, key]) => [
                        label,
                        k.current[key],
                        rate(k.current[key], k.current.turns),
                        k.prior[key],
                        rate(k.prior[key], k.prior.turns),
                      ]),
                      ['All turns', k.current.turns, null, k.prior.turns, null],
                    ],
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[560px] max-w-3xl">
                <thead>
                  <tr>
                    <th>Outcome<Fn n={2} /></th>
                    <th className="num">Last 4 wks</th>
                    <th className="num">Share</th>
                    <th className="num">Prior 4 wks</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Answered', 'answered'],
                      ['Error', 'errors'],
                      ['Refused (limit, access or validation)', 'refused'],
                      ['Stopped by the user', 'stopped'],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="num">{count(k.current[key])}</td>
                      <td className="num text-ink-600">{percent(rate(k.current[key], k.current.turns))}</td>
                      <td className="num text-ink-600">{count(k.prior[key])}</td>
                      <td className="num text-ink-600">{percent(rate(k.prior[key], k.prior.turns))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold text-ink-900">All turns</td>
                    <td className="num font-semibold text-ink-900">{count(k.current.turns)}</td>
                    <td className="num" />
                    <td className="num text-ink-600">{count(k.prior.turns)}</td>
                    <td className="num" />
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Latency"
            note="Seconds, answered turns"
            actions={
              <DownloadButton
                table="ask-latency"
                label="latency"
                sheets={() => {
                  const secs = (ms: number | null) => (ms === null ? null : ms / 1000);
                  return [
                    {
                      name: 'Latency',
                      columns: [
                        { header: 'Measure' },
                        { header: 'Last 4 wks, seconds', type: 'number' },
                        { header: 'Prior 4 wks, seconds', type: 'number' },
                        { header: 'Change', type: 'percent' },
                      ],
                      rows: [
                        ['Full answer, median', secs(k.current.medianMs), secs(k.prior.medianMs), pctChange(k.current.medianMs, k.prior.medianMs)],
                        ['Full answer, 90th percentile', secs(k.current.p90Ms), secs(k.prior.p90Ms), pctChange(k.current.p90Ms, k.prior.p90Ms)],
                        ['First token, median', secs(k.current.medianTtftMs), secs(k.prior.medianTtftMs), pctChange(k.current.medianTtftMs, k.prior.medianTtftMs)],
                      ],
                    },
                  ];
                }}
              />
            }
          >
            <div className="overflow-x-auto max-w-2xl">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  <th className="num">Last 4 wks</th>
                  <th className="num">Prior 4 wks</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Full answer, median</td>
                  <td className="num">{msAsSeconds(k.current.medianMs)}</td>
                  <td className="num text-ink-600">{msAsSeconds(k.prior.medianMs)}</td>
                  <td className="num"><Delta value={pctChange(k.current.medianMs, k.prior.medianMs)} goodWhen="down" /></td>
                </tr>
                <tr>
                  <td>Full answer, 90th percentile</td>
                  <td className="num">{msAsSeconds(k.current.p90Ms)}</td>
                  <td className="num text-ink-600">{msAsSeconds(k.prior.p90Ms)}</td>
                  <td className="num"><Delta value={pctChange(k.current.p90Ms, k.prior.p90Ms)} goodWhen="down" /></td>
                </tr>
                <tr>
                  <td>First token, median</td>
                  <td className="num">{msAsSeconds(k.current.medianTtftMs)}</td>
                  <td className="num text-ink-600">{msAsSeconds(k.prior.medianTtftMs)}</td>
                  <td className="num"><Delta value={pctChange(k.current.medianTtftMs, k.prior.medianTtftMs)} goodWhen="down" /></td>
                </tr>
                <tr>
                  <td>Answer feedback</td>
                  <td className="num" colSpan={3}>
                    <NotTracked>The product has no rating control yet</NotTracked>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </Section>

          {canSeeAccounts(access?.scope) && (
            <Section title="Cost and limits">
              <ul className="grid gap-x-10 sm:grid-cols-3">
                {[
                  ['/token-usage', 'Token usage', 'Tokens and provider cost by model and feature.'],
                  ['/ai-budgets', 'AI budgets', 'Per-organization allowance and credits.'],
                  ['/metering', 'Metering', 'Billable usage by period.'],
                ].map(([to, title, body]) => (
                  <li key={to} className="border-b border-line py-2.5">
                    <Link to={to} className="group block">
                      <span className="text-[13.5px] font-medium text-ink-900 group-hover:text-brand-600">{title}</span>
                      <span className="block text-[12px] text-ink-500">{body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <Footnotes
        asOfValue={h?.generatedAt ?? null}
        notes={[
          'Questions: job_proof_questions created in the window; organizations asking = distinct org_id.',
          'Turns: ask_turn_events, one row per job-level or progress-share Ask turn. Error = server or model failure; refused = a 4xx answer (AI limit, access, validation); stopped = the person cancelled. Error rate = errors ÷ turns. Clip-level and evidence-portal Ask are not yet included.',
          'Latency: total_ms from request to final token; first token = ttft_ms. Turns before this release are not in the history.',
        ]}
      />
    </div>
  );
}
