import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  ApiError,
  type EmailVerification,
  type Prospect,
  type ProspectMatch,
  type ProspectingStatus,
} from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';
import { formatUsd } from '../lib/money';
import { CheckIcon, SearchIcon, ShieldIcon, SpinnerIcon } from '../components/icons';

/** Titles a restoration company actually sells to. One click each. */
const TITLE_PRESETS = [
  { label: 'Property managers', titles: ['property manager', 'portfolio manager'] },
  { label: 'Adjusters', titles: ['adjuster', 'claims'] },
  { label: 'Facilities', titles: ['facilities', 'operations'] },
  { label: 'General contractors', titles: ['owner', 'vp construction'] },
];

/**
 * Prospector — finding the people who hand out the work.
 *
 * Searching is free and deliberately returns nobody's email or phone; a
 * reveal is a fixed credit charge on one person. The page's job is to make
 * that boundary obvious, and to refuse to spend money it does not have to:
 * anyone already in the CRM, already revealed, or on the do-not-contact list
 * is marked before the button is ever pressed.
 */
export function ProspectorPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<ProspectingStatus | null>(null);
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const [matches, setMatches] = useState<ProspectMatch[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  // Every id currently mid-flight. A Set, because two reveals can run at once
  // and a scalar would let the first to finish re-enable the second's button
  // while its charge was still in the air. Held in a ref as well as state so
  // the guard at the top of reveal() reads synchronously.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, Prospect>>({});
  const [proof, setProof] = useState<
    Record<string, { source?: string; verification?: EmailVerification | null }>
  >({});

  useEffect(() => {
    api.prospectingStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const search = useCallback(async () => {
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.prospectSearch({
        q: q.trim() || undefined,
        location: location.trim() || undefined,
        titles: titles.length ? titles : undefined,
        limit: 25,
      });
      setMatches(res.matches);
      setTotal(res.total);
      setStatus({
        provider: res.provider,
        sandbox: res.sandbox,
        revealPriceNanos: res.revealPriceNanos,
        verifier: res.verifier,
        sellUnverified: res.sellUnverified,
        sources: res.sources,
      });
    } catch (err) {
      setMatches([]);
      setError(err instanceof Error ? err.message : 'Could not run that search.');
    } finally {
      setSearching(false);
    }
  }, [q, location, titles]);

  function beginWork(id: string): boolean {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    return true;
  }

  function endWork(id: string) {
    inFlight.current.delete(id);
    setBusy(new Set(inFlight.current));
  }

  async function reveal(match: ProspectMatch) {
    // Synchronous guard: a double-click fires two handlers before any state
    // update lands, and the second must not reach the charge.
    if (!beginWork(match.providerPersonId)) return;
    setError(null);
    setNotice(null);
    try {
      const { prospect, charged, source, verification } = await api.prospectReveal(
        match.providerPersonId,
      );
      setRevealed((prev) => ({ ...prev, [match.providerPersonId]: prospect }));
      setProof((prev) => ({ ...prev, [match.providerPersonId]: { source, verification } }));
      setNotice(
        charged
          ? `Revealed ${prospect.fullName} — ${formatUsd(prospect.revealCostNanos)} charged.`
          : `${prospect.fullName} was already revealed — nothing charged.`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'insufficient_credits'
          ? 'Not enough credits for that reveal. Top up on the Billing page.'
          : err instanceof Error
            ? err.message
            : 'Could not reveal that contact.';
      setError(message);
    } finally {
      endWork(match.providerPersonId);
    }
  }

  async function addToPipeline(prospect: Prospect) {
    if (!beginWork(prospect.id)) return;
    setError(null);
    try {
      const { lead } = await api.prospectImport(prospect.id);
      navigate('/pipeline', { state: { highlight: lead.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them to the pipeline.');
      endWork(prospect.id);
    }
  }

  const price = status ? formatUsd(status.revealPriceNanos) : '—';
  const shown = matches?.length ?? 0;

  const revealedCount = useMemo(() => Object.keys(revealed).length, [revealed]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="Prospector"
        description="Find the people who hand out the work — property managers, adjusters, facilities directors — and put them straight on the pipeline. Searching is free; a contact's email and phone cost one reveal."
      />

      {status?.sandbox && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-caution-200 bg-caution-50 px-4 py-3">
          <ShieldIcon width={16} height={16} className="mt-0.5 shrink-0 text-caution-600" />
          <p className="text-sm text-ink-700">
            <span className="font-semibold text-caution-600">Sample data.</span> No contact-data
            provider is connected, so these people are invented and reveals are free. Connect a
            provider to search real records.
          </p>
        </div>
      )}

      {/* ---- Search ---- */}
      <section className="rounded-xl glass-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-ink-700">
              Company, name, or role
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="property management, Camden Court, adjuster…"
              className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
            />
          </label>
          <label className="min-w-[11rem] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-ink-700">Territory</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="Austin, TX"
              className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
            />
          </label>
          <button
            onClick={() => void search()}
            disabled={searching}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
          >
            {searching ? (
              <SpinnerIcon className="animate-spin" width={15} height={15} />
            ) : (
              <SearchIcon width={15} height={15} />
            )}
            Search
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Who
          </span>
          {TITLE_PRESETS.map((preset) => {
            const on = preset.titles.every((t) => titles.includes(t));
            return (
              <button
                key={preset.label}
                onClick={() =>
                  setTitles((prev) =>
                    on
                      ? prev.filter((t) => !preset.titles.includes(t))
                      : [...new Set([...prev, ...preset.titles])],
                  )
                }
                aria-pressed={on}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  on ? 'bg-brand-50 text-brand-700' : 'bg-paper-200/60 text-ink-600 hover:text-ink-900'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-ink-500">
            {price} per reveal
            {status ? ` · via ${status.provider}` : ''}
          </span>
        </div>
      </section>

      {error && <div className="mt-4"><ErrorNote message={error} /></div>}
      {notice && (
        <p className="mt-4 rounded-lg border border-success-200 bg-success-50 px-4 py-2.5 text-sm text-success-600">
          {notice}
        </p>
      )}

      {searching && <PanelSpinner label="Searching" />}

      {matches !== null && !searching && matches.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="Nobody matched"
            hint="Try a broader term, drop the territory, or clear the role filters."
          />
        </div>
      )}

      {matches !== null && matches.length > 0 && !searching && (
        <>
          <p className="mt-5 text-xs text-ink-500">
            Showing {shown}
            {total && total > shown ? ` of ${total}` : ''} · {revealedCount} revealed this session
          </p>

          <div className="mt-2 overflow-x-auto rounded-xl glass-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Person</Th>
                  <Th>Company</Th>
                  <Th>Contact</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => {
                  const got = revealed[match.providerPersonId] ?? null;
                  const working =
                    busy.has(match.providerPersonId) || (got ? busy.has(got.id) : false);
                  return (
                    <tr key={match.providerPersonId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-900">{match.fullName}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {match.title ?? '—'}
                          {match.location ? ` · ${match.location}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink-800">{match.companyName ?? '—'}</p>
                        {match.companyDomain && (
                          <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                            {match.companyDomain}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {got ? (
                          <div className="space-y-1">
                            {got.email && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-ink-900">{got.email}</span>
                                <VerdictBadge
                                  verification={proof[match.providerPersonId]?.verification ?? null}
                                />
                              </div>
                            )}
                            {(got.mobile || got.phone) && (
                              <p className="tabular-nums text-ink-700">{got.mobile ?? got.phone}</p>
                            )}
                            {proof[match.providerPersonId]?.source && (
                              <p className="text-[11px] text-ink-500">
                                via {proof[match.providerPersonId]?.source}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <Chip on={match.hasEmail}>email</Chip>
                            <Chip on={match.hasPhone}>phone</Chip>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {match.suppressed ? (
                          <span className="text-xs font-medium text-ink-500">Do not contact</span>
                        ) : match.knownContactId ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-600">
                            <CheckIcon width={13} height={13} /> Already yours
                          </span>
                        ) : got ? (
                          <button
                            onClick={() => void addToPipeline(got)}
                            disabled={working || Boolean(got.leadId)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-brand-500 hover:text-ink-900 disabled:opacity-50"
                          >
                            {got.leadId ? 'On the pipeline' : working ? 'Adding…' : 'Add to pipeline'}
                          </button>
                        ) : match.revealed ? (
                          <button
                            onClick={() => void reveal(match)}
                            disabled={working}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-brand-500 disabled:opacity-50"
                          >
                            {working ? 'Opening…' : 'Show details · free'}
                          </button>
                        ) : !match.hasEmail && !match.hasPhone ? (
                          <span className="text-xs text-ink-500">Nothing on file</span>
                        ) : (
                          <button
                            onClick={() => void reveal(match)}
                            disabled={working}
                            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
                          >
                            {working ? 'Revealing…' : `Reveal · ${price}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* This paragraph is a promise about billing, so it has to track the
              configuration rather than describe the best case. A deployment
              with no verifier confirms nothing, and saying otherwise here
              would be the most expensive sentence on the page. */}
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-500">
            {status?.verifier ? (
              <>
                Every address is checked against the receiving mail server by {status.verifier}{' '}
                before you are charged: a mailbox that does not exist is never sold.
              </>
            ) : status?.sellUnverified ? (
              <>
                <span className="text-caution-600">No verification is configured.</span> Addresses are
                returned as the vendor supplied them and have not been confirmed to exist.
              </>
            ) : (
              <>
                <span className="text-caution-600">No verification is configured</span>, so addresses
                nobody could confirm are withheld rather than billed. Connect a verifier in
                Settings to raise the match rate.
              </>
            )}{' '}
            People already in your CRM, already revealed, or on your do-not-contact list are never
            billed again, and a search that finds nothing costs nothing.
          </p>
        </>
      )}

      {matches === null && !searching && (
        <div className="mt-4">
          <EmptyState
            title="Search for the people who hand out work"
            hint="Pick a role, name a territory, and start there — property managers and adjusters are where most restoration work is decided."
          />
        </div>
      )}
    </AppShell>
  );
}

/**
 * What verification actually concluded, never rounded up. A catch-all domain
 * accepts every address, so "the server said yes" means nothing there — and
 * saying "verified" anyway is how a customer's sending reputation dies.
 */
function VerdictBadge({ verification }: { verification: EmailVerification | null }) {
  if (!verification) return null;
  const { verdict, catchAll, reason, verifier } = verification;

  const style =
    verdict === 'valid'
      ? 'bg-success-50 text-success-600'
      : verdict === 'invalid'
        ? 'bg-danger-50 text-danger-600'
        : 'bg-caution-50 text-caution-600';

  const label =
    verdict === 'valid'
      ? 'Verified'
      : catchAll
        ? 'Catch-all domain'
        : verdict === 'invalid'
          ? 'Undeliverable'
          : 'Unconfirmed';

  // Naming who confirmed it turns "Verified" from a claim into a citation —
  // and makes it obvious when the answer came from nobody at all.
  const title = verifier ? `${reason} (${verifier})` : reason;

  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${style}`}>
      {label}
      {verdict === 'valid' && verifier ? ` · ${verifier}` : ''}
    </span>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        on ? 'bg-success-50 text-success-600' : 'bg-paper-200/60 text-ink-500 line-through'
      }`}
    >
      {children}
    </span>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
