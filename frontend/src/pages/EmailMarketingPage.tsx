import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  EM_MESSAGE_STATUS_LABELS,
  EM_SEVERITY_LABELS,
  timeAgo,
  type EmCheckin,
  type EmMapContact,
  type EmMapResponse,
  type EmOutreachDetail,
  type EmScanResult,
  type EmStorm,
  type EmStormMatch,
} from '../lib/api';
import { AppShell, PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { ContactStormMap } from '../components/ContactStormMap';
import { RefreshIcon, SpinnerIcon, MailIcon, AlertIcon, CheckIcon } from '../components/icons';

type Tab = 'map' | 'storms' | 'checkins' | 'settings';

const SEVERITY_PILL: Record<string, string> = {
  advisory: 'bg-slate-100 text-slate-700',
  watch: 'bg-amber-100 text-amber-800',
  warning: 'bg-red-100 text-red-800',
  emergency: 'bg-red-200 text-red-950',
};

/**
 * Email Marketing — CRM contacts on a map, storm watch, outreach, check-ins.
 *
 * Flow matches how a salesperson actually works the weather: glance at the
 * book of business, see what is brewing, draft the personal note, send it,
 * then follow up once the storm has passed.
 */
export function EmailMarketingPage() {
  const [tab, setTab] = useState<Tab>('map');
  const [data, setData] = useState<EmMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<EmScanResult | null>(null);
  const [selectedStormId, setSelectedStormId] = useState<string | null>(null);
  const [matches, setMatches] = useState<EmStormMatch[]>([]);
  const [outreach, setOutreach] = useState<EmOutreachDetail | null>(null);
  const [checkins, setCheckins] = useState<EmCheckin[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    fromName: '',
    replyToEmail: '',
    companySignature: '',
    followUpDays: 2,
    includeOfferOfHelp: true,
  });

  const load = useCallback(async () => {
    try {
      const map = await api.emMap();
      setData(map);
      setSettingsForm({
        fromName: map.settings.fromName,
        replyToEmail: map.settings.replyToEmail ?? '',
        companySignature: map.settings.companySignature ?? '',
        followUpDays: map.settings.followUpDays,
        includeOfferOfHelp: map.settings.includeOfferOfHelp,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load email marketing.');
    }
  }, []);

  const loadCheckins = useCallback(async () => {
    try {
      const res = await api.emListCheckins({ limit: 100 });
      setCheckins(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load check-ins.');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCheckins();
  }, [load, loadCheckins]);

  const highlightedIds = useMemo(() => {
    if (matches.length > 0) return new Set(matches.map((m) => m.contactId));
    return undefined;
  }, [matches]);

  async function scanWeather(demo = false) {
    setScanning(true);
    setScanNote(null);
    try {
      const result = await api.emScanStorms({ demo });
      setScanResult(result);
      setScanNote(result.note);
      await load();
      if (result.storms[0]) {
        setSelectedStormId(result.storms[0].id);
        await loadMatches(result.storms[0].id);
        setTab('storms');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Weather scan failed.');
    } finally {
      setScanning(false);
    }
  }

  async function loadMatches(stormId: string) {
    try {
      const res = await api.emStormMatches(stormId);
      setMatches(res.matches);
      setSelectedStormId(stormId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load storm matches.');
    }
  }

  async function draftOutreach(stormId: string) {
    setBusy('draft');
    try {
      const detail = await api.emCreateOutreach({ stormId });
      setOutreach(detail);
      setTab('storms');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not draft outreach.');
    } finally {
      setBusy(null);
    }
  }

  async function sendOutreach() {
    if (!outreach) return;
    setBusy('send');
    try {
      const detail = await api.emSendOutreach(outreach.outreach.id);
      setOutreach(detail);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed.');
    } finally {
      setBusy(null);
    }
  }

  async function scheduleCheckins() {
    if (!selectedStormId) return;
    setBusy('checkins');
    try {
      await api.emScheduleCheckins({
        stormId: selectedStormId,
        outreachId: outreach?.outreach.id,
      });
      await loadCheckins();
      setTab('checkins');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule check-ins.');
    } finally {
      setBusy(null);
    }
  }

  async function sendCheckin(id: string) {
    setBusy(`checkin-${id}`);
    try {
      await api.emSendCheckin(id);
      await loadCheckins();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in send failed.');
    } finally {
      setBusy(null);
    }
  }

  async function completeCheckin(id: string) {
    setBusy(`done-${id}`);
    try {
      await api.emUpdateCheckin(id, { status: 'completed' });
      await loadCheckins();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update check-in.');
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy('settings');
    try {
      await api.emUpdateSettings({
        fromName: settingsForm.fromName,
        replyToEmail: settingsForm.replyToEmail || null,
        companySignature: settingsForm.companySignature || null,
        followUpDays: settingsForm.followUpDays,
        includeOfferOfHelp: settingsForm.includeOfferOfHelp,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setBusy(null);
    }
  }

  const selectedStorm: EmStorm | null =
    data?.storms.find((s) => s.id === selectedStormId) ?? null;

  if (!data && !error) {
    return (
      <AppShell>
        <PanelSpinner label="Loading email marketing…" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Email Marketing"
        description="Map your CRM contacts, watch for storms in their path, and send a personal check-in."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void scanWeather(false)}
              disabled={scanning}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {scanning ? <SpinnerIcon width={16} height={16} className="animate-spin" /> : <RefreshIcon width={16} height={16} />}
              Scan weather
            </button>
            <button
              type="button"
              onClick={() => void scanWeather(true)}
              disabled={scanning}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-100 disabled:opacity-60"
            >
              Demo storm
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {scanNote && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {scanNote}
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['map', 'Map'],
            ['storms', 'Storms & outreach'],
            ['checkins', 'Check-ins'],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'map' && data && (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm text-ink-600">
            <span>
              <strong className="text-ink-900">{data.contacts.length}</strong> mapped contacts
            </span>
            <span>
              <strong className="text-ink-900">{data.storms.length}</strong> active storms
            </span>
            {data.unmappedCount > 0 && (
              <span>
                <strong className="text-ink-900">{data.unmappedCount}</strong> properties missing
                coordinates
              </span>
            )}
            <span className="text-ink-400">
              Weather: {data.weatherProvider} · Email: {data.emailProvider}
            </span>
          </div>

          {data.contacts.length === 0 ? (
            <EmptyState
              title="No mapped contacts yet"
              hint="Add latitude and longitude on CRM properties (or sync a CRM that has them). Once pins appear here, storm scanning can match contacts in the path."
            />
          ) : (
            <ContactStormMap
              contacts={data.contacts}
              storms={data.storms}
              highlightedContactIds={highlightedIds}
              selectedStormId={selectedStormId}
              onSelectStorm={(storm) => {
                void loadMatches(storm.id);
                setTab('storms');
              }}
              onSelectContact={(_c: EmMapContact) => undefined}
            />
          )}

          {scanResult && scanResult.matches.length > 0 && (
            <div className="rounded-xl border border-line bg-paper-0 p-4">
              <h2 className="text-sm font-semibold text-ink-900">Latest scan</h2>
              <ul className="mt-2 divide-y divide-line">
                {scanResult.matches.map((m) => (
                  <li key={m.stormId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <span className="font-medium text-ink-900">{m.name}</span>
                      <span className="ml-2 text-ink-500">{m.eventType}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ink-600">
                        {m.emailableCount} emailable · {m.matchedCount} in path
                      </span>
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        onClick={() => {
                          void loadMatches(m.stormId);
                          setTab('storms');
                        }}
                      >
                        Review
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === 'storms' && data && (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Active storms
            </h2>
            {data.storms.length === 0 ? (
              <EmptyState
                title="No storms on the board"
                hint="Scan weather to pull National Weather Service alerts, or run a demo storm against your mapped contacts."
              />
            ) : (
              <ul className="space-y-2">
                {data.storms.map((storm) => (
                  <li key={storm.id}>
                    <button
                      type="button"
                      onClick={() => void loadMatches(storm.id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                        selectedStormId === storm.id
                          ? 'border-brand-400 bg-brand-50'
                          : 'border-line bg-paper-0 hover:bg-paper-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-ink-900">{storm.name}</p>
                          <p className="text-xs text-ink-500">{storm.eventType}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            SEVERITY_PILL[storm.severity] ?? SEVERITY_PILL.warning
                          }`}
                        >
                          {EM_SEVERITY_LABELS[storm.severity]}
                        </span>
                      </div>
                      {storm.areaDesc && (
                        <p className="mt-1 line-clamp-2 text-xs text-ink-500">{storm.areaDesc}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            {selectedStorm ? (
              <>
                <div className="rounded-xl border border-line bg-paper-0 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-ink-900">{selectedStorm.name}</h2>
                      <p className="text-sm text-ink-500">
                        {matches.length} contacts in path ·{' '}
                        {matches.filter((m) => !m.skipReason).length} emailable
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy === 'draft' || matches.length === 0}
                        onClick={() => void draftOutreach(selectedStorm.id)}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        {busy === 'draft' ? (
                          <SpinnerIcon width={15} height={15} className="animate-spin" />
                        ) : (
                          <MailIcon width={15} height={15} />
                        )}
                        Draft outreach
                      </button>
                      <button
                        type="button"
                        disabled={busy === 'checkins'}
                        onClick={() => void scheduleCheckins()}
                        className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-60"
                      >
                        Schedule check-ins
                      </button>
                    </div>
                  </div>

                  <ContactStormMap
                    contacts={data.contacts}
                    storms={[selectedStorm]}
                    highlightedContactIds={highlightedIds}
                    selectedStormId={selectedStorm.id}
                  />

                  <ul className="mt-3 max-h-56 overflow-y-auto divide-y divide-line text-sm">
                    {matches.map((m) => (
                      <li key={m.contactId} className="flex items-center justify-between gap-2 py-2">
                        <div>
                          <p className="font-medium text-ink-900">{m.name}</p>
                          <p className="text-xs text-ink-500">
                            {[m.city, m.region].filter(Boolean).join(', ') || '—'} ·{' '}
                            {m.distanceMiles} mi
                            {m.skipReason ? ` · ${m.skipReason.replace(/_/g, ' ')}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-ink-400">{m.email || 'no email'}</span>
                      </li>
                    ))}
                    {matches.length === 0 && (
                      <li className="py-6 text-center text-ink-500">
                        No mapped contacts fall inside this footprint.
                      </li>
                    )}
                  </ul>
                </div>

                {outreach && outreach.outreach.stormId === selectedStorm.id && (
                  <div className="rounded-xl border border-line bg-paper-0 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink-900">
                        Outreach · {outreach.outreach.status}
                      </h3>
                      {outreach.outreach.status !== 'sent' && (
                        <button
                          type="button"
                          disabled={busy === 'send'}
                          onClick={() => void sendOutreach()}
                          className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
                        >
                          {busy === 'send' ? (
                            <SpinnerIcon width={15} height={15} className="animate-spin" />
                          ) : (
                            <MailIcon width={15} height={15} />
                          )}
                          Send all drafts
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {outreach.outreach.sentCount} sent · {outreach.outreach.skippedCount} skipped ·{' '}
                      {outreach.outreach.failedCount} failed
                      {outreach.outreach.sentAt ? ` · ${timeAgo(outreach.outreach.sentAt)}` : ''}
                    </p>
                    <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                      {outreach.messages.map((msg) => (
                        <li key={msg.id} className="rounded-lg border border-line bg-paper-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-ink-900">
                              {msg.toName || msg.toEmail}
                            </p>
                            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                              {EM_MESSAGE_STATUS_LABELS[msg.status]}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-ink-800">{msg.subject}</p>
                          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-600">
                            {msg.bodyText}
                          </pre>
                          {msg.errorMessage && (
                            <p className="mt-2 flex items-center gap-1 text-xs text-red-700">
                              <AlertIcon width={12} height={12} /> {msg.errorMessage}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                title="Pick a storm"
                hint="Select a storm on the left — or scan weather — to see who is in the path and draft outreach."
              />
            )}
          </div>
        </section>
      )}

      {tab === 'checkins' && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Follow-up check-ins
          </h2>
          {checkins.length === 0 ? (
            <EmptyState
              title="No check-ins scheduled"
              hint="After you send storm outreach, schedule check-ins to ask contacts if everything is alright once the weather clears."
            />
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-paper-0">
              {checkins.map((c) => {
                const name = c.crmContacts
                  ? [c.crmContacts.firstName, c.crmContacts.lastName].filter(Boolean).join(' ') ||
                    c.crmContacts.email ||
                    'Contact'
                  : c.toEmail || 'Contact';
                return (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-900">{name}</p>
                      <p className="text-xs text-ink-500">
                        {c.emStorms?.name || 'Storm'} · due{' '}
                        {new Date(c.scheduledFor).toLocaleString()} · {c.status}
                      </p>
                      {c.subject && <p className="mt-1 text-sm text-ink-700">{c.subject}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(c.status === 'scheduled' || c.status === 'sent') && (
                        <button
                          type="button"
                          disabled={busy === `checkin-${c.id}` || c.status === 'sent'}
                          onClick={() => void sendCheckin(c.id)}
                          className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-50"
                        >
                          {c.status === 'sent' ? 'Sent' : 'Send check-in'}
                        </button>
                      )}
                      {c.status !== 'completed' && c.status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={busy === `done-${c.id}`}
                          onClick={() => void completeCheckin(c.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                        >
                          <CheckIcon width={12} height={12} /> Mark good
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'settings' && (
        <form onSubmit={saveSettings} className="max-w-xl space-y-4 rounded-xl border border-line bg-paper-0 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Outreach settings</h2>
          <label className="block text-sm">
            <span className="text-ink-600">From name</span>
            <input
              className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-ink-900"
              value={settingsForm.fromName}
              onChange={(e) => setSettingsForm((f) => ({ ...f, fromName: e.target.value }))}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-600">Reply-to email</span>
            <input
              type="email"
              className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-ink-900"
              value={settingsForm.replyToEmail}
              onChange={(e) => setSettingsForm((f) => ({ ...f, replyToEmail: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-600">Signature</span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-ink-900"
              value={settingsForm.companySignature}
              onChange={(e) =>
                setSettingsForm((f) => ({ ...f, companySignature: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-600">Follow-up delay (days)</span>
            <input
              type="number"
              min={1}
              max={30}
              className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-ink-900"
              value={settingsForm.followUpDays}
              onChange={(e) =>
                setSettingsForm((f) => ({ ...f, followUpDays: Number(e.target.value) || 2 }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={settingsForm.includeOfferOfHelp}
              onChange={(e) =>
                setSettingsForm((f) => ({ ...f, includeOfferOfHelp: e.target.checked }))
              }
            />
            Include offer of mitigation help in storm emails
          </label>
          <button
            type="submit"
            disabled={busy === 'settings'}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === 'settings' ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      )}
    </AppShell>
  );
}
