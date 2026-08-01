import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  SALES_STATUS_LABELS,
  api,
  type PeopleSearchCandidate,
  type PeopleSearchRecord,
  type SalesBusiness,
  type SalesCampaign,
  type SalesCampaignStatus,
  type SalesContact,
  type SalesEvent,
  type SalesMeeting,
  type SalesOutreach,
  type SalesStatus,
} from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PanelSpinner } from '../components/AppShell';
import {
  BuildingIcon,
  CheckIcon,
  MessageIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  SpinnerIcon,
  UsersIcon,
} from '../components/icons';

type WorkspaceMode = 'find' | 'campaigns';
type Tab = 'businesses' | 'contacts' | 'outreach' | 'meetings' | 'events';

const ACTIVE: SalesCampaignStatus[] = [
  'researching',
  'crawling',
  'outreach',
  'following_up',
  'scheduling',
];

const SEARCH_EXAMPLES = [
  'owner of a water mitigation company in Dallas',
  'CEO of a restoration contractor in Phoenix',
  'VP of operations at a fire restoration company in Houston',
  'general manager at a mold remediation firm in Tampa',
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

function statusTone(status: SalesCampaignStatus): string {
  if (status === 'failed') return 'border-rose-300 bg-rose-50 text-rose-700';
  if (status === 'paused') return 'border-amber-300 bg-amber-50 text-amber-800';
  if (status === 'completed') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (ACTIVE.includes(status)) return 'border-brand-200 bg-brand-50 text-brand-700';
  return 'border-line bg-paper-100 text-ink-600';
}

function confidenceLabel(value: number): string {
  if (value >= 0.75) return 'High confidence';
  if (value >= 0.5) return 'Medium confidence';
  return 'Low confidence';
}

function confidenceTone(value: number): string {
  if (value >= 0.75) return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (value >= 0.5) return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-line bg-paper-100 text-ink-600';
}

/**
 * Atmosphere internal outreach workspace.
 *
 * Two modes share the left rail:
 *  - Find people — natural-language web research for restoration/construction buyers
 *  - Campaigns — territory outbound pipeline that pitches Atmosphere and books demos
 *
 * Built so Atmosphere salespeople automate outreach and spend the day closing.
 */
export function SalesAgentPage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [mode, setMode] = useState<WorkspaceMode>(routeId ? 'campaigns' : 'find');
  const [status, setStatus] = useState<SalesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // People search
  const [searchQuery, setSearchQuery] = useState(
    'owner of a water mitigation company in Dallas',
  );
  const [searchResult, setSearchResult] = useState<PeopleSearchRecord | null>(null);
  const [searchHistory, setSearchHistory] = useState<PeopleSearchRecord[]>([]);
  const [searching, setSearching] = useState(false);

  // Campaigns
  const [campaigns, setCampaigns] = useState<SalesCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(routeId ?? null);
  const [campaign, setCampaign] = useState<SalesCampaign | null>(null);
  const [running, setRunning] = useState(false);
  const [businesses, setBusinesses] = useState<SalesBusiness[]>([]);
  const [contacts, setContacts] = useState<SalesContact[]>([]);
  const [outreach, setOutreach] = useState<SalesOutreach[]>([]);
  const [meetings, setMeetings] = useState<SalesMeeting[]>([]);
  const [events, setEvents] = useState<SalesEvent[]>([]);
  const [tab, setTab] = useState<Tab>('businesses');
  const [territory, setTerritory] = useState('');
  const [salesFocus, setSalesFocus] = useState(
    'Restoration & construction companies — mitigation, water/fire/mold, rebuild GCs',
  );
  const [valueProp, setValueProp] = useState(
    'Atmosphere helps restoration and construction teams estimate faster, operate carrier and supplier portals with AI, run field tech workflows, and keep a full audit trail — so your people spend time closing and delivering work, not fighting software.',
  );
  const [senderName, setSenderName] = useState('Atmosphere Sales');
  const [senderEmail, setSenderEmail] = useState('');

  const loadCampaigns = useCallback(async () => {
    const [{ campaigns: list }, { status: caps }] = await Promise.all([
      api.listSalesCampaigns(),
      api.salesStatus(),
    ]);
    setCampaigns(list);
    setStatus(caps);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }, [selectedId]);

  const loadSearchHistory = useCallback(async () => {
    try {
      const { searches } = await api.listSalesPeopleSearches();
      setSearchHistory(searches);
    } catch {
      // Table may not be migrated yet — live search still works.
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [{ campaign: c, running: isRunning }, biz, con, out, meet, ev] = await Promise.all([
      api.getSalesCampaign(id),
      api.listSalesBusinesses(id),
      api.listSalesContacts(id),
      api.listSalesOutreach(id),
      api.listSalesMeetings(id),
      api.listSalesEvents(id),
    ]);
    setCampaign(c);
    setRunning(isRunning);
    setBusinesses(biz.businesses);
    setContacts(con.contacts);
    setOutreach(out.outreach);
    setMeetings(meet.meetings);
    setEvents(ev.events);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCampaigns(), loadSearchHistory()]).catch((err) => {
      if (!cancelled) setError(errorMessage(err));
    });
    return () => {
      cancelled = true;
    };
  }, [loadCampaigns, loadSearchHistory]);

  useEffect(() => {
    if (routeId) {
      setSelectedId(routeId);
      setMode('campaigns');
    }
  }, [routeId]);

  useEffect(() => {
    if (!selectedId || mode !== 'campaigns') {
      if (!selectedId) setCampaign(null);
      return undefined;
    }
    let cancelled = false;
    setError(null);
    loadDetail(selectedId).catch((err) => {
      if (!cancelled) setError(errorMessage(err));
    });

    const shouldPoll = running || (campaign && ACTIVE.includes(campaign.status));
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => {
      loadDetail(selectedId).catch(() => undefined);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedId, running, campaign?.status, loadDetail, mode]);

  async function handlePeopleSearch(event: FormEvent) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    setMode('find');
    try {
      const { search } = await api.searchSalesPeople(searchQuery.trim());
      setSearchResult(search);
      setSearchHistory((prev) => [search, ...prev.filter((s) => s.id && s.id !== search.id)].slice(0, 30));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { campaign: created } = await api.createSalesCampaign({
        territory: territory.trim(),
        salesFocus: salesFocus.trim(),
        valueProp: valueProp.trim() || null,
        senderName: senderName.trim() || null,
        senderEmail: senderEmail.trim() || null,
      });
      await api.startSalesCampaign(created.id);
      setTerritory('');
      setSalesFocus('');
      setValueProp('');
      setCampaigns((prev) => [created, ...(prev ?? [])]);
      setSelectedId(created.id);
      setMode('campaigns');
      navigate(`/sales/${created.id}`, { replace: true });
      await loadDetail(created.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { campaign: updated } = await api.pauseSalesCampaign(selectedId);
      setCampaign(updated);
      setRunning(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.resumeSalesCampaign(selectedId);
      setRunning(true);
      await loadDetail(selectedId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function simulateInterestedReply(message: SalesOutreach) {
    setBusy(true);
    try {
      await api.replySalesOutreach(
        message.id,
        `Hi — thanks for reaching out. I'd be interested in an Atmosphere product demo next week if you have availability.`,
      );
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(
    () => [
      { label: 'Businesses', value: campaign?.businessesFound ?? businesses.length, Icon: BuildingIcon },
      { label: 'Contacts', value: campaign?.contactsFound ?? contacts.length, Icon: UsersIcon },
      { label: 'Emails', value: campaign?.emailsSent ?? 0, Icon: MessageIcon },
      { label: 'Demos', value: campaign?.meetingsBooked ?? meetings.length, Icon: CheckIcon },
    ],
    [campaign, businesses.length, contacts.length, meetings.length],
  );

  return (
    <AppShell wide>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-6 lg:w-80">
          <div className="rounded-xl border border-line bg-paper-0 p-5 shadow-card animate-fade-in-up">
            <div className="mb-3 flex items-center gap-2 text-brand-700">
              <SparkIcon width={18} height={18} />
              <h2 className="text-sm font-semibold tracking-tight">Outreach</h2>
              <span className="rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                Internal
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-paper-100 p-1">
              <button
                type="button"
                onClick={() => setMode('find')}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                  mode === 'find' ? 'bg-paper-0 text-brand-700 shadow-sm' : 'text-ink-500'
                }`}
              >
                Find people
              </button>
              <button
                type="button"
                onClick={() => setMode('campaigns')}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                  mode === 'campaigns' ? 'bg-paper-0 text-brand-700 shadow-sm' : 'text-ink-500'
                }`}
              >
                Campaigns
              </button>
            </div>

            {mode === 'find' ? (
              <>
                <p className="mb-3 text-sm text-ink-600">
                  Find owners and ops leads at restoration and construction companies. I search the
                  live web, crawl company pages, and return sourced buyer intel for Atmosphere demos.
                </p>
                <form onSubmit={handlePeopleSearch} className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Search</span>
                    <textarea
                      required
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      rows={4}
                      placeholder="owner of a water mitigation company in Dallas"
                      className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none ring-brand-500 focus:ring-2"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={searching || !searchQuery.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {searching ? (
                      <SpinnerIcon className="animate-spin" width={16} height={16} />
                    ) : (
                      <SearchIcon width={16} height={16} />
                    )}
                    {searching ? 'Crawling the web…' : 'Search the web'}
                  </button>
                </form>
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-ink-500">Try</p>
                  {SEARCH_EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setSearchQuery(example)}
                      className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-ink-600 transition hover:bg-paper-100 hover:text-ink-900"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-600">
                  Pick a territory. I find restoration and construction buyers, pitch Atmosphere,
                  follow up, and book product demos so you can spend the day closing.
                </p>
                <form onSubmit={handleCreate} className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Territory</span>
                    <input
                      required
                      value={territory}
                      onChange={(e) => setTerritory(e.target.value)}
                      placeholder="Austin, TX · Dallas metro · Houston"
                      className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none ring-brand-500 focus:ring-2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Buyer ICP</span>
                    <input
                      required
                      value={salesFocus}
                      onChange={(e) => setSalesFocus(e.target.value)}
                      placeholder="Water mitigation · Fire restoration · Rebuild GCs"
                      className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none ring-brand-500 focus:ring-2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Atmosphere pitch</span>
                    <textarea
                      value={valueProp}
                      onChange={(e) => setValueProp(e.target.value)}
                      rows={3}
                      placeholder="What we tell them about Atmosphere"
                      className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none ring-brand-500 focus:ring-2"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-ink-500">Your name</span>
                      <input
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-ink-500">Reply-to email</span>
                      <input
                        type="email"
                        value={senderEmail}
                        onChange={(e) => setSenderEmail(e.target.value)}
                        className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !territory.trim() || !salesFocus.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {busy ? (
                      <SpinnerIcon className="animate-spin" width={16} height={16} />
                    ) : (
                      <PlusIcon width={16} height={16} />
                    )}
                    Start outreach
                  </button>
                </form>
              </>
            )}

            {status && (
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs text-ink-500">
                <div>
                  <dt>Web crawl</dt>
                  <dd className="font-medium text-ink-800">Live</dd>
                </div>
                <div>
                  <dt>Research LLM</dt>
                  <dd className="font-medium text-ink-800">{status.llm ? 'On' : 'Heuristic'}</dd>
                </div>
              </dl>
            )}
          </div>

          {mode === 'find' ? (
            <div className="rounded-xl border border-line bg-paper-0 p-3 shadow-card">
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-500">
                Recent searches
              </p>
              {searchHistory.length === 0 ? (
                <p className="px-2 py-4 text-sm text-ink-500">No searches yet.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {searchHistory.map((s, idx) => (
                    <li key={s.id || `${s.query}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchResult(s);
                          setSearchQuery(s.query);
                          setMode('find');
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left transition ${
                          searchResult?.id && searchResult.id === s.id
                            ? 'bg-brand-50 text-brand-800'
                            : 'text-ink-800 hover:bg-paper-100'
                        }`}
                      >
                        <span className="block truncate text-sm font-medium">{s.query}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-500">
                          {s.status}
                          {s.bestMatch ? ` · ${s.bestMatch.fullName}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-paper-0 p-3 shadow-card">
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-500">
                Campaigns
              </p>
              {campaigns === null ? (
                <PanelSpinner label="Loading campaigns" />
              ) : campaigns.length === 0 ? (
                <p className="px-2 py-4 text-sm text-ink-500">No campaigns yet.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(c.id);
                          navigate(`/sales/${c.id}`);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left transition ${
                          selectedId === c.id
                            ? 'bg-brand-50 text-brand-800'
                            : 'text-ink-800 hover:bg-paper-100'
                        }`}
                      >
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-500">
                          {SALES_STATUS_LABELS[c.status]} · {c.meetingsBooked} demos
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 space-y-4 animate-fade-in-up">
          {error && <ErrorNote message={error} />}

          {mode === 'find' ? (
            <PeopleSearchResults searching={searching} result={searchResult} />
          ) : !campaign ? (
            <EmptyState
              title="Pick a campaign or start a new one"
              hint="Or switch to Find people to look up a restoration/construction decision-maker for an Atmosphere demo."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-brand-600">Atmosphere Outreach</p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{campaign.name}</h1>
                  <p className="mt-1 text-sm text-ink-600">
                    {campaign.territory} · {campaign.salesFocus}
                  </p>
                  {campaign.stageDetail && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-ink-500">
                      {(running || ACTIVE.includes(campaign.status)) && (
                        <SpinnerIcon className="animate-spin text-brand-600" width={14} height={14} />
                      )}
                      {campaign.stageDetail}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone(campaign.status)}`}
                  >
                    {SALES_STATUS_LABELS[campaign.status]}
                  </span>
                  {campaign.status === 'paused' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleResume}
                      className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-paper-100"
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || campaign.status === 'draft'}
                      onClick={handlePause}
                      className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-paper-100 disabled:opacity-50"
                    >
                      Pause
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map(({ label, value, Icon }) => (
                  <div key={label} className="rounded-xl border border-line bg-paper-0 px-4 py-3 shadow-card">
                    <div className="flex items-center gap-2 text-ink-500">
                      <Icon width={15} height={15} />
                      <span className="text-xs font-medium">{label}</span>
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1 border-b border-line pb-2">
                {(
                  [
                    ['businesses', `Businesses (${businesses.length})`],
                    ['contacts', `Contacts (${contacts.length})`],
                    ['outreach', `Outreach (${outreach.length})`],
                    ['meetings', `Demos (${meetings.length})`],
                    ['events', 'Activity'],
                  ] as Array<[Tab, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      tab === key ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-paper-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'businesses' && <BusinessList businesses={businesses} />}
              {tab === 'contacts' && <ContactList contacts={contacts} />}
              {tab === 'outreach' && (
                <OutreachList
                  outreach={outreach}
                  busy={busy}
                  onSimulateReply={simulateInterestedReply}
                />
              )}
              {tab === 'meetings' && <MeetingList meetings={meetings} />}
              {tab === 'events' && <EventList events={events} />}
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function PeopleSearchResults({
  searching,
  result,
}: {
  searching: boolean;
  result: PeopleSearchRecord | null;
}) {
  if (searching) {
    return (
      <div className="rounded-xl border border-line bg-paper-0 px-6 py-16 text-center shadow-card">
        <SpinnerIcon className="mx-auto animate-spin text-brand-600" width={28} height={28} />
        <p className="mt-4 text-sm font-medium text-ink-800">Searching and crawling public sources…</p>
        <p className="mt-1 text-sm text-ink-500">
          Web search → company leadership pages → profile pages → ranked matches
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <EmptyState
        title="Find a decision-maker on the live web"
        hint='Try “director of facilities at ABC Supply in Milwaukee” — results include names, titles, evidence, and source links.'
      />
    );
  }

  const parsed = result.parsed;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-paper-0 p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand-600">People search</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{result.query}</h1>
            <p className="mt-2 text-sm text-ink-600">{result.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line bg-paper-100 px-3 py-1 font-medium text-ink-700">
              {result.status}
            </span>
            <span className="rounded-full border border-line bg-paper-100 px-3 py-1 text-ink-600">
              {result.searchesRun} searches · {result.pagesCrawled} pages
              {result.durationMs != null ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : ''}
            </span>
          </div>
        </div>

        {(parsed?.role || parsed?.company || parsed?.location) && (
          <dl className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-ink-500">Role</dt>
              <dd className="text-sm font-medium text-ink-900">{parsed?.role || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-500">Company</dt>
              <dd className="text-sm font-medium text-ink-900">{parsed?.company || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-500">Location</dt>
              <dd className="text-sm font-medium text-ink-900">{parsed?.location || '—'}</dd>
            </div>
          </dl>
        )}
      </div>

      {result.bestMatch && (
        <CandidateCard candidate={result.bestMatch} featured />
      )}

      {result.candidates.filter((c) => c !== result.bestMatch && c.fullName !== result.bestMatch?.fullName).length >
        0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-800">Other matches</h2>
          {result.candidates
            .filter((c) => c.fullName !== result.bestMatch?.fullName)
            .map((candidate) => (
              <CandidateCard key={`${candidate.fullName}-${candidate.title}`} candidate={candidate} />
            ))}
        </div>
      )}

      {result.sources?.length > 0 && (
        <div className="rounded-xl border border-line bg-paper-0 p-4 shadow-card">
          <h2 className="text-sm font-semibold text-ink-800">Sources crawled</h2>
          <ul className="mt-3 space-y-2">
            {result.sources.slice(0, 12).map((source) => (
              <li key={source.url} className="text-sm">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-700 hover:underline"
                >
                  {source.title || source.url}
                </a>
                {source.snippet && (
                  <p className="mt-0.5 line-clamp-2 text-ink-500">{source.snippet}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.trace?.length > 0 && (
        <details className="rounded-xl border border-line bg-paper-0 p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-semibold text-ink-800">
            Research trace ({result.trace.length} steps)
          </summary>
          <ol className="mt-3 space-y-2">
            {result.trace.map((step, idx) => (
              <li key={`${step.at}-${idx}`} className="text-sm">
                <span className="font-medium text-ink-800">{step.step.replace(/_/g, ' ')}</span>
                <span className="text-ink-500"> — {step.detail}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  featured = false,
}: {
  candidate: PeopleSearchCandidate;
  featured?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-paper-0 p-5 shadow-card ${
        featured ? 'border-brand-200 ring-1 ring-brand-100' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {featured && (
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Best match</p>
          )}
          <h3 className="text-xl font-bold tracking-tight text-ink-900">{candidate.fullName}</h3>
          <p className="mt-1 text-sm text-ink-600">
            {[candidate.title, candidate.company, candidate.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${confidenceTone(candidate.confidence)}`}
        >
          {confidenceLabel(candidate.confidence)} · {Math.round(candidate.confidence * 100)}%
        </span>
      </div>

      {candidate.summary && <p className="mt-3 text-sm text-ink-700">{candidate.summary}</p>}

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {candidate.email && (
          <div>
            <dt className="text-xs font-medium text-ink-500">Email</dt>
            <dd className="text-sm text-ink-900">{candidate.email}</dd>
          </div>
        )}
        {candidate.phone && (
          <div>
            <dt className="text-xs font-medium text-ink-500">Phone</dt>
            <dd className="text-sm text-ink-900">{candidate.phone}</dd>
          </div>
        )}
        {candidate.linkedinUrl && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ink-500">LinkedIn</dt>
            <dd>
              <a
                href={candidate.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-700 hover:underline"
              >
                {candidate.linkedinUrl}
              </a>
            </dd>
          </div>
        )}
        {candidate.profileUrl && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ink-500">Profile / page</dt>
            <dd>
              <a
                href={candidate.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-brand-700 hover:underline"
              >
                {candidate.profileUrl}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {candidate.matchReasons?.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {candidate.matchReasons.map((reason) => (
            <li
              key={reason}
              className="rounded-full border border-line bg-paper-100 px-2.5 py-1 text-xs text-ink-600"
            >
              {reason}
            </li>
          ))}
        </ul>
      )}

      {candidate.evidence?.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Evidence</p>
          <ul className="mt-2 space-y-2">
            {candidate.evidence.slice(0, 4).map((item) => (
              <li
                key={item.slice(0, 40)}
                className="rounded-lg bg-paper-100 px-3 py-2 text-sm italic text-ink-700"
              >
                “{item}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidate.sources?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {candidate.sources.slice(0, 4).map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {source.title || 'Source'}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function BusinessList({ businesses }: { businesses: SalesBusiness[] }) {
  if (!businesses.length) {
    return <EmptyState title="No businesses yet" hint="The agent fills this as research runs." />;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-0 shadow-card">
      {businesses.map((b) => (
        <li key={b.id} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-ink-900">{b.name}</p>
            <span className="text-xs text-ink-500">{b.status}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {[b.category, b.city, b.address].filter(Boolean).join(' · ')}
          </p>
          {b.websiteUrl && (
            <a
              href={b.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-brand-700 hover:underline"
            >
              {b.websiteUrl}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ContactList({ contacts }: { contacts: SalesContact[] }) {
  if (!contacts.length) {
    return <EmptyState title="No decision-makers yet" hint="Crawling public pages for contacts…" />;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-0 shadow-card">
      {contacts.map((c) => (
        <li key={c.id} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-ink-900">
              {c.fullName}
              {c.title ? <span className="font-normal text-ink-500"> · {c.title}</span> : null}
            </p>
            <span className="text-xs text-ink-500">{c.status}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-600">{c.email || 'No email found'}</p>
          {c.researchSummary && <p className="mt-1 text-sm text-ink-500">{c.researchSummary}</p>}
        </li>
      ))}
    </ul>
  );
}

function OutreachList({
  outreach,
  busy,
  onSimulateReply,
}: {
  outreach: SalesOutreach[];
  busy: boolean;
  onSimulateReply: (m: SalesOutreach) => void;
}) {
  if (!outreach.length) {
    return <EmptyState title="No emails yet" hint="Atmosphere product outreach appears here as it sends." />;
  }
  return (
    <ul className="space-y-3">
      {outreach.map((m) => (
        <li key={m.id} className="rounded-xl border border-line bg-paper-0 p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {m.direction} · step {m.sequenceStep} · {m.status}
              {m.intent ? ` · ${m.intent}` : ''}
            </p>
            {m.direction === 'outbound' && m.status !== 'replied' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSimulateReply(m)}
                className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-50"
              >
                Simulate interested reply
              </button>
            )}
          </div>
          {m.subject && <p className="mt-1 text-sm font-medium text-ink-900">{m.subject}</p>}
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink-600">{m.body}</pre>
        </li>
      ))}
    </ul>
  );
}

function MeetingList({ meetings }: { meetings: SalesMeeting[] }) {
  if (!meetings.length) {
    return (
      <EmptyState
        title="No demos booked yet"
        hint="When a buyer replies positively, the agent books an Atmosphere product demo so you can close."
      />
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-0 shadow-card">
      {meetings.map((m) => (
        <li key={m.id} className="px-4 py-3">
          <p className="font-medium text-ink-900">{m.title}</p>
          <p className="mt-0.5 text-sm text-ink-600">
            {new Date(m.startsAt).toLocaleString()} – {new Date(m.endsAt).toLocaleTimeString()}
          </p>
          <p className="text-sm text-ink-500">
            {m.location || 'Video demo'} · {m.status} · booked by {m.bookedBy}
          </p>
        </li>
      ))}
    </ul>
  );
}

function EventList({ events }: { events: SalesEvent[] }) {
  if (!events.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-ink-800">{e.eventType.replace(/_/g, ' ')}</span>
            <time className="text-xs text-ink-500">{new Date(e.createdAt).toLocaleString()}</time>
          </div>
          {e.detail && <p className="mt-0.5 text-ink-600">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
