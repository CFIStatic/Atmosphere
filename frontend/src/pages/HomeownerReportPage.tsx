import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type HomeownerReport,
  type PortalMessage,
  type PortalPolicyMeta,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';

type ThreadItem =
  | { kind: 'message'; message: PortalMessage }
  | { kind: 'local'; id: string; role: 'user' | 'assistant'; content: string };

/**
 * HomeOwner Report — ChatGPT-style chat portal branded with the restoration
 * company's logo and name (e.g. ServiceMaster Recovery Services).
 */
export function HomeownerReportPage() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<HomeownerReport | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [localTurns, setLocalTurns] = useState<
    { id: string; role: 'user' | 'assistant'; content: string }[]
  >([]);
  const [policies, setPolicies] = useState<PortalPolicyMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [policyName, setPolicyName] = useState('policy.txt');
  const [logoBroken, setLogoBroken] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.portalGuestReport(token);
      setReport(data.report);
      setError(null);
      setLogoBroken(false);

      if (data.report.capabilities.chat || data.report.capabilities.insuranceQa) {
        try {
          const { messages: msgs } = await api.portalGuestMessages(token);
          setMessages(msgs);
        } catch {
          // Chat may be off; insurance Q&A can still work without history.
        }
      }
      if (data.report.capabilities.policyUpload) {
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

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, localTurns, busy]);

  const brandName = report?.brand.name ?? report?.orgName ?? 'Restoration team';

  const thread: ThreadItem[] = useMemo(() => {
    const fromServer: ThreadItem[] = messages.map((m) => ({ kind: 'message', message: m }));
    const fromLocal: ThreadItem[] = localTurns.map((t) => ({
      kind: 'local',
      id: t.id,
      role: t.role,
      content: t.content,
    }));
    return [...fromServer, ...fromLocal];
  }, [messages, localTurns]);

  const suggestions = useMemo(() => {
    if (!report) return [];
    const items: string[] = [];
    if (report.schedule) items.push('What is the tentative schedule for my job?');
    if (report.project.phaseLabel) items.push(`What does the ${report.project.phaseLabel} phase mean?`);
    if (report.contacts.office || report.contacts.adjuster) {
      items.push('Who should I call if I have a question?');
    }
    if (report.drying) items.push('How is the drying going on my property?');
    items.push('What should I know about my insurance claim?');
    if (report.capabilities.policyUpload) {
      items.push('I uploaded my policy — what does my deductible mean here?');
    }
    return items.slice(0, 4);
  }, [report]);

  async function send(question: string) {
    if (!report || !question.trim() || busy) return;
    const text = question.trim();
    const canAsk = report.capabilities.insuranceQa;
    const canChat = report.capabilities.chat;

    if (!canAsk && !canChat) {
      setError('Messaging is turned off for this report.');
      return;
    }

    setBusy(true);
    setDraft('');
    setError(null);

    const history = thread
      .map((item) => {
        if (item.kind === 'local') {
          return { role: item.role, content: item.content };
        }
        const role =
          item.message.authorKind === 'homeowner'
            ? ('user' as const)
            : ('assistant' as const);
        return { role, content: item.message.body };
      })
      .filter((t) => t.content.trim().length > 0)
      .slice(-16);

    if (canAsk) {
      const userId = `local-u-${Date.now()}`;
      setLocalTurns((prev) => [...prev, { id: userId, role: 'user', content: text }]);
      try {
        const { reply } = await api.portalGuestAsk(token, text, history);
        setLocalTurns((prev) => [
          ...prev,
          { id: `local-a-${Date.now()}`, role: 'assistant', content: reply },
        ]);
        // Prefer server history when chat persistence is on.
        if (canChat) {
          const { messages: msgs } = await api.portalGuestMessages(token);
          setMessages(msgs);
          setLocalTurns([]);
        }
      } catch (err) {
        setLocalTurns((prev) => [
          ...prev,
          {
            id: `local-e-${Date.now()}`,
            role: 'assistant',
            content: err instanceof ApiError ? err.message : 'Could not answer that right now.',
          },
        ]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
      return;
    }

    // Chat-only mode: message the team without an assistant reply.
    try {
      const { message } = await api.portalGuestSendMessage(token, text);
      setMessages((prev) => [...prev, message]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that message.');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
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
      setShowPolicy(false);
      setBusy(false);
      await send(
        'I just uploaded my insurance policy. Can you help me understand what matters for this claim?',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that policy.');
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
      <div className="gpt-shell grid min-h-screen place-items-center px-6">
        {error ? (
          <div className="max-w-md text-center">
            <p className="text-base font-medium text-ink-900">This report is unavailable</p>
            <p className="mt-2 text-sm text-ink-600">{error}</p>
          </div>
        ) : (
          <SpinnerIcon className="animate-spin text-ink-500" width={28} height={28} />
        )}
      </div>
    );
  }

  const empty = thread.length === 0 && !busy;
  const welcome =
    report.share.welcomeNote ||
    report.customMessage ||
    `Ask anything about your restoration job with ${brandName}.`;

  return (
    <div className="gpt-shell flex h-[100dvh] flex-col overflow-hidden">
      {/* Brand header */}
      <header className="gpt-header shrink-0">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyMark
              name={brandName}
              logoUrl={logoBroken ? null : report.brand.logoUrl}
              onLogoError={() => setLogoBroken(true)}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-ink-900">
                {brandName}
              </p>
              <p className="truncate text-xs text-ink-500">
                Job {report.project.projectNumber}
                {report.project.phaseLabel ? ` · ${report.project.phaseLabel}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {report.capabilities.policyUpload && (
              <button
                type="button"
                onClick={() => setShowPolicy(true)}
                className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-paper-100"
              >
                Policy
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-paper-100"
            >
              Job details
            </button>
          </div>
        </div>
      </header>

      {/* Thread */}
      <div ref={scrollerRef} className="gpt-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {empty ? (
            <EmptyChat
              brandName={brandName}
              logoUrl={logoBroken ? null : report.brand.logoUrl}
              onLogoError={() => setLogoBroken(true)}
              welcome={welcome}
              customerName={report.share.customerName}
              suggestions={suggestions}
              onSuggest={(s) => void send(s)}
            />
          ) : (
            <ul className="space-y-6">
              {thread.map((item) => {
                if (item.kind === 'message') {
                  const isUser = item.message.authorKind === 'homeowner';
                  return (
                    <ChatBubble
                      key={item.message.id}
                      isUser={isUser}
                      brandName={brandName}
                      logoUrl={logoBroken ? null : report.brand.logoUrl}
                      onLogoError={() => setLogoBroken(true)}
                      authorLabel={
                        isUser
                          ? 'You'
                          : item.message.authorKind === 'staff'
                            ? brandName
                            : item.message.authorName ?? brandName
                      }
                      body={item.message.body}
                    />
                  );
                }
                return (
                  <ChatBubble
                    key={item.id}
                    isUser={item.role === 'user'}
                    brandName={brandName}
                    logoUrl={logoBroken ? null : report.brand.logoUrl}
                    onLogoError={() => setLogoBroken(true)}
                    authorLabel={item.role === 'user' ? 'You' : brandName}
                    body={item.content}
                  />
                );
              })}
              {busy && (
                <li className="flex items-start gap-3">
                  <CompanyMark
                    name={brandName}
                    logoUrl={logoBroken ? null : report.brand.logoUrl}
                    onLogoError={() => setLogoBroken(true)}
                    size="sm"
                  />
                  <div className="pt-1.5">
                    <TypingDots />
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="gpt-composer shrink-0">
        <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
          {error && (
            <p className="mb-2 text-center text-xs text-danger-700">{error}</p>
          )}
          {!empty && suggestions.length > 0 && thread.length < 3 && (
            <div className="mb-3 flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 2).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(s)}
                  className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={onSubmit} className="gpt-input-shell">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={`Message ${brandName}…`}
              disabled={busy || (!report.capabilities.chat && !report.capabilities.insuranceQa)}
              className="gpt-textarea"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send message"
              className="gpt-send"
            >
              <SendIcon />
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] text-ink-400">
            Answers about your job and insurance are educational — confirm coverage with your
            adjuster. Powered for {brandName}.
          </p>
        </div>
      </div>

      {showDetails && (
        <DetailsDrawer report={report} brandName={brandName} onClose={() => setShowDetails(false)} />
      )}
      {showPolicy && (
        <PolicyDrawer
          policies={policies}
          policyText={policyText}
          policyName={policyName}
          busy={busy}
          disclaimer={report.regulation.disclaimer}
          onClose={() => setShowPolicy(false)}
          onPolicyText={setPolicyText}
          onPolicyName={setPolicyName}
          onFile={onPolicyFile}
          onUpload={uploadPolicy}
        />
      )}
    </div>
  );
}

function EmptyChat({
  brandName,
  logoUrl,
  onLogoError,
  welcome,
  customerName,
  suggestions,
  onSuggest,
}: {
  brandName: string;
  logoUrl: string | null;
  onLogoError: () => void;
  welcome: string;
  customerName: string | null;
  suggestions: string[];
  onSuggest: (s: string) => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-2 text-center">
      <div className="gpt-empty-mark">
        <CompanyMark name={brandName} logoUrl={logoUrl} onLogoError={onLogoError} size="lg" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
        {customerName ? `Hi ${customerName.split(' ')[0]}` : `Welcome`}
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">{welcome}</p>
      <p className="mt-1 text-xs text-ink-400">{brandName}</p>
      {suggestions.length > 0 && (
        <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="gpt-suggest rounded-2xl border border-line bg-paper-0 px-4 py-3 text-left text-sm text-ink-700 transition hover:bg-paper-50 hover:shadow-card"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  isUser,
  brandName,
  logoUrl,
  onLogoError,
  authorLabel,
  body,
}: {
  isUser: boolean;
  brandName: string;
  logoUrl: string | null;
  onLogoError: () => void;
  authorLabel: string;
  body: string;
}) {
  if (isUser) {
    return (
      <li className="flex justify-end gap-3">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <p className="mb-1 text-right text-[11px] font-medium text-ink-400">You</p>
          <div className="rounded-3xl rounded-br-md bg-ink-900 px-4 py-3 text-sm leading-relaxed text-white">
            <p className="whitespace-pre-wrap">{body}</p>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3">
      <CompanyMark name={brandName} logoUrl={logoUrl} onLogoError={onLogoError} size="sm" />
      <div className="min-w-0 max-w-[85%] flex-1 sm:max-w-[80%]">
        <p className="mb-1 text-[11px] font-medium text-ink-500">{authorLabel}</p>
        <div className="rounded-3xl rounded-tl-md bg-paper-0 px-4 py-3 text-sm leading-relaxed text-ink-800 shadow-card ring-1 ring-line/80">
          <p className="whitespace-pre-wrap">{body}</p>
        </div>
      </div>
    </li>
  );
}

function CompanyMark({
  name,
  logoUrl,
  onLogoError,
  size = 'md',
}: {
  name: string;
  logoUrl: string | null;
  onLogoError?: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim =
    size === 'lg' ? 'h-16 w-16' : size === 'md' ? 'h-10 w-10' : 'h-8 w-8';
  const text = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-sm' : 'text-xs';
  const initials = companyInitials(name);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={onLogoError}
        className={`${dim} shrink-0 rounded-full object-contain bg-paper-0 ring-1 ring-line`}
      />
    );
  }

  return (
    <span
      className={`${dim} ${text} grid shrink-0 place-items-center rounded-full bg-[#0B3D2E] font-semibold text-white shadow-card`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'RC';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  // Prefer first letters of first two meaningful words (skip "Recovery", "Services" if 3+)
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function DetailsDrawer({
  report,
  brandName,
  onClose,
}: {
  report: HomeownerReport;
  brandName: string;
  onClose: () => void;
}) {
  const location = [report.project.address, report.project.city, report.project.region]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="gpt-drawer-root" role="dialog" aria-modal="true" aria-label="Job details">
      <button type="button" className="gpt-drawer-scrim" aria-label="Close" onClick={onClose} />
      <aside className="gpt-drawer">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{brandName}</p>
            <h2 className="text-lg font-semibold text-ink-900">Job details</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-700"
          >
            Close
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {location && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Property</h3>
              <p className="mt-1 text-ink-800">{location}</p>
            </section>
          )}
          {report.project.phaseLabel && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Progress</h3>
              <p className="mt-1 text-ink-800">
                {report.project.phaseLabel} · {report.project.status.replace('_', ' ')}
              </p>
            </section>
          )}
          {report.schedule && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Tentative schedule
              </h3>
              <dl className="mt-2 space-y-1.5">
                <Row label="Start" value={fmtDate(report.schedule.scheduledStartAt)} />
                <Row label="Target completion" value={fmtDate(report.schedule.targetCompletionAt)} />
                <Row label="Work started" value={fmtDate(report.schedule.startedAt)} />
              </dl>
            </section>
          )}
          {report.drying && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Drying</h3>
              <p className="mt-1 text-ink-800">{report.drying.headline}</p>
            </section>
          )}
          {(report.contacts.office || report.contacts.adjuster || report.contacts.field) && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Who to call
              </h3>
              <div className="mt-2 space-y-3">
                <ContactLine title="Office" contact={report.contacts.office} />
                <ContactLine title="Adjuster" contact={report.contacts.adjuster} />
                <ContactLine title="Field" contact={report.contacts.field} />
              </div>
            </section>
          )}
          {report.claim && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Claim</h3>
              <dl className="mt-2 space-y-1.5">
                <Row label="Carrier" value={report.claim.carrier ?? '—'} />
                <Row label="Claim #" value={report.claim.claimNumber ?? '—'} />
                {report.claim.deductibleCents != null && (
                  <Row
                    label="Deductible"
                    value={`$${(report.claim.deductibleCents / 100).toFixed(2)}`}
                  />
                )}
              </dl>
            </section>
          )}
          {report.milestones && report.milestones.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Milestones
              </h3>
              <ul className="mt-2 space-y-2">
                {report.milestones.map((m) => (
                  <li key={`${m.label}-${m.dueAt}`} className="flex justify-between gap-2">
                    <span className="text-ink-800">{m.label}</span>
                    <span className="text-ink-500">{m.completedAt ? 'Done' : fmtDate(m.dueAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {report.updates && report.updates.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Updates</h3>
              <ul className="mt-2 space-y-3">
                {report.updates.map((u, i) => (
                  <li key={`${u.createdAt}-${i}`} className="rounded-xl bg-paper-50 px-3 py-2">
                    {u.subject && <p className="font-medium text-ink-900">{u.subject}</p>}
                    <p className="mt-0.5 whitespace-pre-wrap text-ink-700">{u.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              For {report.regulation.regionLabel}
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-ink-700">
              {report.regulation.bullets.slice(0, 3).map((b) => (
                <li key={b.slice(0, 32)}>{b}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-400">{report.regulation.disclaimer}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

function PolicyDrawer({
  policies,
  policyText,
  policyName,
  busy,
  disclaimer,
  onClose,
  onPolicyText,
  onPolicyName,
  onFile,
  onUpload,
}: {
  policies: PortalPolicyMeta[];
  policyText: string;
  policyName: string;
  busy: boolean;
  disclaimer: string;
  onClose: () => void;
  onPolicyText: (v: string) => void;
  onPolicyName: (v: string) => void;
  onFile: (f: File | null) => void;
  onUpload: (e: FormEvent) => void;
}) {
  return (
    <div className="gpt-drawer-root" role="dialog" aria-modal="true" aria-label="Upload policy">
      <button type="button" className="gpt-drawer-scrim" aria-label="Close" onClick={onClose} />
      <aside className="gpt-drawer">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink-900">Your policy</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-700"
          >
            Close
          </button>
        </div>
        <form onSubmit={onUpload} className="space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-ink-600">
            Paste declarations text or upload a text file. We use it only to answer your questions
            in this chat.
          </p>
          <input
            value={policyName}
            onChange={(e) => onPolicyName(e.target.value)}
            placeholder="File name"
            className="w-full rounded-xl border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-ink-800 focus:ring-2"
          />
          <input
            type="file"
            accept=".txt,.md,.csv,text/plain"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-600"
          />
          <textarea
            value={policyText}
            onChange={(e) => onPolicyText(e.target.value)}
            rows={10}
            placeholder="Paste policy text…"
            className="w-full rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-sm outline-none ring-ink-800 focus:ring-2"
          />
          <button
            type="submit"
            disabled={busy || policyText.trim().length < 20}
            className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save &amp; ask about it
          </button>
          {policies.length > 0 && (
            <ul className="space-y-2 pt-2">
              {policies.map((p) => (
                <li key={p.id} className="rounded-xl bg-paper-50 px-3 py-2 text-sm">
                  <p className="font-medium text-ink-800">{p.fileName}</p>
                  <p className="text-xs text-ink-500">{fmtDate(p.uploadedAt)}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-400">{disclaimer}</p>
        </form>
      </aside>
    </div>
  );
}

function ContactLine({
  title,
  contact,
}: {
  title: string;
  contact: { name: string | null; phone?: string | null; email?: string | null } | null;
}) {
  if (!contact || (!contact.name && !contact.phone && !contact.email)) return null;
  return (
    <div>
      <p className="text-xs text-ink-500">{title}</p>
      {contact.name && <p className="font-medium text-ink-900">{contact.name}</p>}
      {contact.phone && (
        <a className="block text-ink-700 underline-offset-2 hover:underline" href={`tel:${contact.phone}`}>
          {contact.phone}
        </a>
      )}
      {contact.email && (
        <a
          className="block text-ink-700 underline-offset-2 hover:underline"
          href={`mailto:${contact.email}`}
        >
          {contact.email}
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-800">{value}</dd>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="gpt-typing inline-flex items-center gap-1 rounded-full bg-paper-0 px-3 py-2 ring-1 ring-line">
      <span />
      <span />
      <span />
    </span>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
