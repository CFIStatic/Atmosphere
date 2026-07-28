import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type HomeownerReport,
  type PortalMessage,
  type PortalPolicyMeta,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';

type Tab = 'progress' | 'ask' | 'policy';

/**
 * Public HomeOwner Report — tokenized guest surface.
 * No org cookies; the share token in the URL is the credential.
 */
export function HomeownerReportPage() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<HomeownerReport | null>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [policies, setPolicies] = useState<PortalPolicyMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('progress');
  const [draft, setDraft] = useState('');
  const [askDraft, setAskDraft] = useState('');
  const [askHistory, setAskHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>(
    [],
  );
  const [policyText, setPolicyText] = useState('');
  const [policyName, setPolicyName] = useState('policy.txt');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.portalGuestReport(token);
      setReport(data.report);
      setAssistantEnabled(data.assistantEnabled);
      setError(null);

      if (data.report.capabilities.chat) {
        const { messages: msgs } = await api.portalGuestMessages(token);
        setMessages(msgs);
      }
      if (data.report.capabilities.policyUpload || data.report.capabilities.insuranceQa) {
        const { policies: pols } = await api.portalGuestPolicies(token);
        setPolicies(pols);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this report.');
      setReport(null);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const company = report?.orgName ?? 'Your restoration company';

  const locationLine = useMemo(() => {
    if (!report) return null;
    return [report.project.address, report.project.city, report.project.region]
      .filter(Boolean)
      .join(', ');
  }, [report]);

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !report?.capabilities.chat) return;
    setBusy(true);
    try {
      const { message } = await api.portalGuestSendMessage(token, draft.trim());
      setMessages((prev) => [...prev, message]);
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that message.');
    } finally {
      setBusy(false);
    }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!askDraft.trim()) return;
    const question = askDraft.trim();
    setBusy(true);
    setAskDraft('');
    setAskHistory((h) => [...h, { role: 'user', content: question }]);
    try {
      const { reply } = await api.portalGuestAsk(token, question, askHistory);
      setAskHistory((h) => [...h, { role: 'assistant', content: reply }]);
      if (report?.capabilities.chat) {
        const { messages: msgs } = await api.portalGuestMessages(token);
        setMessages(msgs);
      }
    } catch (err) {
      setAskHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: err instanceof ApiError ? err.message : 'Could not answer that right now.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPolicy(e: FormEvent) {
    e.preventDefault();
    if (!policyText.trim() || !report?.capabilities.policyUpload) return;
    setBusy(true);
    try {
      const { policy } = await api.portalGuestUploadPolicy(token, {
        fileName: policyName.trim() || 'policy.txt',
        mimeType: 'text/plain',
        contentText: policyText.trim(),
        byteSize: policyText.trim().length,
      });
      setPolicies((prev) => [policy, ...prev]);
      setPolicyText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that policy.');
    } finally {
      setBusy(false);
    }
  }

  function onPolicyFile(file: File | null) {
    if (!file) return;
    setPolicyName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setPolicyText(text.slice(0, 200_000));
    };
    reader.readAsText(file);
  }

  if (!report) {
    return (
      <div className="hor-shell grid min-h-screen place-items-center px-6">
        {error ? (
          <div className="max-w-md text-center">
            <Logo />
            <p className="mt-6 text-sm text-ink-700">{error}</p>
          </div>
        ) : (
          <SpinnerIcon className="animate-spin text-brand-600" width={28} height={28} />
        )}
      </div>
    );
  }

  return (
    <div className="hor-shell min-h-screen">
      <header className="hor-hero border-b border-line/70">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex items-start justify-between gap-4">
            <Logo />
            <p className="text-right text-xs text-ink-500">
              Job {report.project.projectNumber}
              {report.project.phaseLabel ? ` · ${report.project.phaseLabel}` : ''}
            </p>
          </div>
          <div className="hor-fade max-w-2xl">
            <p className="text-sm font-medium tracking-wide text-brand-700">{company}</p>
            <h1 className="mt-2 font-display text-3xl leading-tight text-ink-900 sm:text-4xl">
              {report.share.customerName
                ? `${report.share.customerName}'s restoration report`
                : report.project.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-600">
              {report.share.welcomeNote ||
                report.customMessage ||
                'Follow your tentative schedule, see what is happening on the job, and ask questions anytime.'}
            </p>
            {locationLine && (
              <p className="mt-3 text-sm text-ink-500">{locationLine}</p>
            )}
          </div>

          <nav className="flex gap-1 rounded-xl bg-paper-0/70 p-1 shadow-card backdrop-blur">
            {(
              [
                ['progress', 'Progress'],
                ['ask', 'Ask & chat'],
                ['policy', 'Policy'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tab === id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-ink-600 hover:bg-paper-100 hover:text-ink-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        {error && (
          <p className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}

        {tab === 'progress' && <ProgressTab report={report} />}
        {tab === 'ask' && (
          <AskTab
            report={report}
            messages={messages}
            askHistory={askHistory}
            draft={draft}
            askDraft={askDraft}
            busy={busy}
            assistantEnabled={assistantEnabled}
            onDraft={setDraft}
            onAskDraft={setAskDraft}
            onSendChat={sendChat}
            onAsk={ask}
          />
        )}
        {tab === 'policy' && (
          <PolicyTab
            report={report}
            policies={policies}
            policyText={policyText}
            policyName={policyName}
            busy={busy}
            onPolicyText={setPolicyText}
            onPolicyName={setPolicyName}
            onFile={onPolicyFile}
            onUpload={uploadPolicy}
          />
        )}
      </main>
    </div>
  );
}

function ProgressTab({ report }: { report: HomeownerReport }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="hor-panel hor-fade space-y-5">
        <h2 className="font-display text-xl text-ink-900">What is happening</h2>
        {report.project.phaseLabel && (
          <p className="text-sm text-ink-700">
            Current phase: <span className="font-medium text-ink-900">{report.project.phaseLabel}</span>
            {' · '}
            Status {report.project.status.replace('_', ' ')}
          </p>
        )}

        {report.schedule && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Tentative schedule
            </h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <ScheduleItem label="Scheduled start" value={fmtDate(report.schedule.scheduledStartAt)} />
              <ScheduleItem label="Target completion" value={fmtDate(report.schedule.targetCompletionAt)} />
              <ScheduleItem label="Work started" value={fmtDate(report.schedule.startedAt)} />
              <ScheduleItem label="Completed" value={fmtDate(report.schedule.completedAt)} />
            </dl>
            <p className="mt-2 text-xs text-ink-500">
              Dates are tentative and can move after inspections or carrier approvals.
            </p>
          </div>
        )}

        {report.drying && (
          <div className="rounded-xl bg-paper-50 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Drying</h3>
            <p className="mt-1 text-sm text-ink-800">{report.drying.headline}</p>
            <p className="mt-1 text-xs text-ink-500">
              {report.drying.areasAtGoal} area(s) at goal
              {report.drying.daysDrying != null ? ` · day ${report.drying.daysDrying}` : ''}
            </p>
          </div>
        )}

        {report.milestones && report.milestones.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Milestones</h3>
            <ul className="mt-2 divide-y divide-line">
              {report.milestones.map((m) => (
                <li key={`${m.label}-${m.dueAt}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-ink-800">{m.label}</p>
                    <p className="text-xs text-ink-500">
                      {fmtDate(m.dueAt)} · {m.kind}
                    </p>
                  </div>
                  <span className="text-xs text-ink-500">
                    {m.completedAt ? 'Done' : 'Upcoming'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.updates && report.updates.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Updates from the team
            </h3>
            <ul className="mt-2 space-y-3">
              {report.updates.map((u, i) => (
                <li key={`${u.createdAt}-${i}`} className="rounded-xl border border-line bg-paper-0 p-3">
                  {u.subject && <p className="text-sm font-medium text-ink-900">{u.subject}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{u.body}</p>
                  <p className="mt-2 text-xs text-ink-400">{fmtDate(u.sentAt ?? u.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.documents && report.documents.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Documents</h3>
            <ul className="mt-2 space-y-1">
              {report.documents.map((d) => (
                <li key={d.label} className="flex justify-between text-sm text-ink-700">
                  <span>{d.label}</span>
                  <span className="text-ink-500">{d.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside className="space-y-6">
        <section className="hor-panel hor-fade" style={{ animationDelay: '80ms' }}>
          <h2 className="font-display text-xl text-ink-900">Who to call</h2>
          <div className="mt-4 space-y-4">
            <ContactBlock title="Restoration office" contact={report.contacts.office} />
            <ContactBlock title="Insurance adjuster" contact={report.contacts.adjuster} />
            <ContactBlock title="Field contact" contact={report.contacts.field} />
            {!report.contacts.office && !report.contacts.adjuster && !report.contacts.field && (
              <p className="text-sm text-ink-500">
                Contacts have not been shared for this job yet. Use Ask &amp; chat to reach the team.
              </p>
            )}
          </div>
        </section>

        {report.claim && (
          <section className="hor-panel hor-fade" style={{ animationDelay: '120ms' }}>
            <h2 className="font-display text-lg text-ink-900">Claim basics</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Carrier</dt>
                <dd className="text-ink-800">{report.claim.carrier ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Claim #</dt>
                <dd className="text-ink-800">{report.claim.claimNumber ?? '—'}</dd>
              </div>
              {report.claim.deductibleCents != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Deductible</dt>
                  <dd className="text-ink-800">
                    ${(report.claim.deductibleCents / 100).toFixed(2)}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        <section className="hor-panel hor-fade" style={{ animationDelay: '160ms' }}>
          <h2 className="font-display text-lg text-ink-900">
            For {report.regulation.regionLabel}
            {report.regulation.carrierLabel ? ` · ${report.regulation.carrierLabel}` : ''}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-ink-700">
            {report.regulation.bullets.slice(0, 4).map((b) => (
              <li key={b.slice(0, 40)}>{b}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">{report.regulation.disclaimer}</p>
        </section>
      </aside>
    </div>
  );
}

function AskTab({
  report,
  messages,
  askHistory,
  draft,
  askDraft,
  busy,
  assistantEnabled,
  onDraft,
  onAskDraft,
  onSendChat,
  onAsk,
}: {
  report: HomeownerReport;
  messages: PortalMessage[];
  askHistory: { role: 'user' | 'assistant'; content: string }[];
  draft: string;
  askDraft: string;
  busy: boolean;
  assistantEnabled: boolean;
  onDraft: (v: string) => void;
  onAskDraft: (v: string) => void;
  onSendChat: (e: FormEvent) => void;
  onAsk: (e: FormEvent) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {report.capabilities.chat && (
        <section className="hor-panel flex min-h-[28rem] flex-col">
          <h2 className="font-display text-xl text-ink-900">Message the team</h2>
          <p className="mt-1 text-sm text-ink-500">
            Questions about the schedule, access, or what is happening on site.
          </p>
          <div className="cx-scroll mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-ink-500">No messages yet. Say hello — the office will see it.</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.authorKind === 'homeowner'
                      ? 'ml-auto bg-brand-600 text-white'
                      : 'bg-paper-100 text-ink-800'
                  }`}
                >
                  <p className="text-[11px] opacity-70">
                    {m.authorName ?? m.authorKind}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={onSendChat} className="mt-4 flex gap-2">
            <input
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              placeholder="Ask the restoration team…"
              className="flex-1 rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-sm outline-none ring-brand-500 focus:ring-2"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      )}

      {report.capabilities.insuranceQa && (
        <section className="hor-panel flex min-h-[28rem] flex-col">
          <h2 className="font-display text-xl text-ink-900">Insurance &amp; policy Q&amp;A</h2>
          <p className="mt-1 text-sm text-ink-500">
            Answers adapt to {report.regulation.regionLabel}
            {report.regulation.carrierLabel ? ` and ${report.regulation.carrierLabel}` : ''}.
            {!assistantEnabled && ' Rule-based answers are available until a model key is configured.'}
          </p>
          <div className="cx-scroll mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {askHistory.length === 0 ? (
              <p className="text-sm text-ink-500">
                Try: “What should I ask my adjuster next?” or “What does my deductible mean for this job?”
              </p>
            ) : (
              askHistory.map((turn, i) => (
                <div
                  key={`${turn.role}-${i}`}
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    turn.role === 'user'
                      ? 'ml-auto bg-ink-800 text-white'
                      : 'bg-paper-100 text-ink-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={onAsk} className="mt-4 flex gap-2">
            <input
              value={askDraft}
              onChange={(e) => onAskDraft(e.target.value)}
              placeholder="Ask about insurance, schedule, or your policy…"
              className="flex-1 rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-sm outline-none ring-brand-500 focus:ring-2"
            />
            <button
              type="submit"
              disabled={busy || !askDraft.trim()}
              className="rounded-xl bg-ink-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </section>
      )}

      {!report.capabilities.chat && !report.capabilities.insuranceQa && (
        <p className="text-sm text-ink-600">
          Messaging and Q&amp;A are turned off for this report by the restoration company.
        </p>
      )}
    </div>
  );
}

function PolicyTab({
  report,
  policies,
  policyText,
  policyName,
  busy,
  onPolicyText,
  onPolicyName,
  onFile,
  onUpload,
}: {
  report: HomeownerReport;
  policies: PortalPolicyMeta[];
  policyText: string;
  policyName: string;
  busy: boolean;
  onPolicyText: (v: string) => void;
  onPolicyName: (v: string) => void;
  onFile: (f: File | null) => void;
  onUpload: (e: FormEvent) => void;
}) {
  if (!report.capabilities.policyUpload) {
    return (
      <p className="text-sm text-ink-600">
        Policy upload is turned off for this report. You can still use Ask &amp; chat for general
        insurance questions if that is enabled.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <section className="hor-panel">
        <h2 className="font-display text-xl text-ink-900">Upload your policy</h2>
        <p className="mt-1 text-sm text-ink-500">
          Paste declarations-page text or upload a text export. We use it only to answer your
          questions on this job — it is not legal advice.
        </p>
        <form onSubmit={onUpload} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-ink-500">File name</label>
            <input
              value={policyName}
              onChange={(e) => onPolicyName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-500">Or choose a text file</label>
            <input
              type="file"
              accept=".txt,.md,.csv,text/plain"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-ink-600"
            />
          </div>
          <textarea
            value={policyText}
            onChange={(e) => onPolicyText(e.target.value)}
            rows={12}
            placeholder="Paste policy or declarations text here…"
            className="w-full rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-sm outline-none ring-brand-500 focus:ring-2"
          />
          <button
            type="submit"
            disabled={busy || policyText.trim().length < 20}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            Save policy for Q&amp;A
          </button>
        </form>
      </section>

      <section className="hor-panel">
        <h2 className="font-display text-lg text-ink-900">Uploaded</h2>
        {policies.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Nothing uploaded yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {policies.map((p) => (
              <li key={p.id} className="rounded-xl border border-line bg-paper-50 px-3 py-2.5">
                <p className="text-sm font-medium text-ink-800">{p.fileName}</p>
                <p className="text-xs text-ink-500">{fmtDate(p.uploadedAt)}</p>
                {p.summary && <p className="mt-1 text-xs text-ink-600 line-clamp-3">{p.summary}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-ink-500">{report.regulation.disclaimer}</p>
      </section>
    </div>
  );
}

function ContactBlock({
  title,
  contact,
}: {
  title: string;
  contact: { name: string | null; phone?: string | null; email?: string | null } | null;
}) {
  if (!contact) return null;
  if (!contact.name && !contact.phone && !contact.email) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {contact.name && <p className="mt-1 text-sm font-medium text-ink-900">{contact.name}</p>}
      {contact.phone && (
        <a className="mt-0.5 block text-sm text-brand-700 hover:underline" href={`tel:${contact.phone}`}>
          {contact.phone}
        </a>
      )}
      {contact.email && (
        <a className="mt-0.5 block text-sm text-brand-700 hover:underline" href={`mailto:${contact.email}`}>
          {contact.email}
        </a>
      )}
    </div>
  );
}

function ScheduleItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper-50 px-3 py-2.5">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'TBD';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'TBD';
  }
}
