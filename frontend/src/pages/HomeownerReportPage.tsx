import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type HomeownerReport,
  type PortalConversation,
  type PortalMessage,
  type PortalPolicyMeta,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';

const KIND_ORDER: PortalConversation['kind'][] = ['assistant', 'company', 'adjuster', 'group'];

/**
 * HomeOwner communications portal — ChatGPT-style chat with side conversations:
 * company DM, adjuster DM, and a group thread so everyone stays on the same page.
 */
export function HomeownerReportPage() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<HomeownerReport | null>(null);
  const [conversations, setConversations] = useState<PortalConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [policies, setPolicies] = useState<PortalPolicyMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [policyName, setPolicyName] = useState('policy.txt');
  const [logoBroken, setLogoBroken] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
      ),
    [conversations],
  );

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const data = await api.portalGuestConversationMessages(token, conversationId);
      setMessages(data.messages);
    },
    [token],
  );

  const load = useCallback(async () => {
    try {
      const data = await api.portalGuestReport(token);
      setReport(data.report);
      setConversations(data.conversations);
      setError(null);
      setLogoBroken(false);

      const preferred =
        data.conversations.find((c) => c.kind === 'company') ??
        data.conversations.find((c) => c.kind === 'assistant') ??
        data.conversations[0] ??
        null;
      const nextId = preferred?.id ?? null;
      setActiveId(nextId);
      if (nextId) await loadMessages(nextId);

      if (data.report.capabilities.policyUpload) {
        const { policies: pols } = await api.portalGuestPolicies(token);
        setPolicies(pols);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this report.');
      setReport(null);
    }
  }, [token, loadMessages]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, activeId]);

  async function selectConversation(id: string) {
    if (id === activeId) {
      setSidebarOpen(false);
      return;
    }
    setActiveId(id);
    setMessages([]);
    setSidebarOpen(false);
    setBusy(true);
    try {
      await loadMessages(id);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that conversation.');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function send(textRaw: string) {
    if (!report || !active || !textRaw.trim() || busy) return;
    const text = textRaw.trim();
    setBusy(true);
    setDraft('');
    setError(null);

    try {
      if (active.kind === 'assistant') {
        const history = messages
          .map((m) => ({
            role: (m.authorKind === 'homeowner' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.body,
          }))
          .slice(-16);
        await api.portalGuestAsk(token, text, history, active.id);
        await loadMessages(active.id);
      } else {
        const { message } = await api.portalGuestSendMessage(token, active.id, text);
        setMessages((prev) => [...prev, message]);
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === active.id ? { ...c, lastMessageAt: new Date().toISOString() } : c,
        ),
      );
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
      const assistant = conversations.find((c) => c.kind === 'assistant');
      if (assistant) {
        setActiveId(assistant.id);
        setBusy(false);
        await loadMessages(assistant.id);
        await send(
          'I just uploaded my insurance policy. Can you help me understand what matters for this claim?',
        );
      } else {
        setBusy(false);
      }
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

  const brandName = report.brand.name;
  const empty = messages.length === 0 && !busy;
  const placeholder = active
    ? active.kind === 'assistant'
      ? `Ask ${brandName}…`
      : active.kind === 'company'
        ? `Message ${brandName}…`
        : active.kind === 'adjuster'
          ? 'Message your adjuster…'
          : 'Message the group…'
    : 'Select a conversation…';

  return (
    <div className="gpt-shell flex h-[100dvh] overflow-hidden">
      {/* Side conversations */}
      <aside
        className={`gpt-sidebar ${sidebarOpen ? 'gpt-sidebar-open' : ''}`}
        aria-label="Conversations"
      >
        <div className="border-b border-line px-4 py-4">
          <div className="flex items-center gap-3">
            <CompanyMark
              name={brandName}
              logoUrl={logoBroken ? null : report.brand.logoUrl}
              onLogoError={() => setLogoBroken(true)}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">{brandName}</p>
              <p className="truncate text-xs text-ink-500">Communications</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Message the company, your adjuster, or start a group so everyone is on the same page.
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {sortedConversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void selectConversation(c.id)}
              className={`gpt-convo ${activeId === c.id ? 'gpt-convo-active' : ''}`}
            >
              <span className="gpt-convo-icon" aria-hidden>
                {kindGlyph(c.kind)}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-ink-900">{c.title}</span>
                <span className="block truncate text-xs text-ink-500">{kindSubtitle(c)}</span>
              </span>
            </button>
          ))}
          {sortedConversations.length === 0 && (
            <p className="px-3 py-6 text-sm text-ink-500">
              No conversations are enabled for this job yet.
            </p>
          )}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          {report.capabilities.policyUpload && (
            <button
              type="button"
              onClick={() => setShowPolicy(true)}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-ink-700 hover:bg-paper-100"
            >
              Upload policy
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-ink-700 hover:bg-paper-100"
          >
            Job details
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="gpt-sidebar-scrim lg:hidden"
          aria-label="Close conversations"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="gpt-header shrink-0">
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-xs font-medium text-ink-700 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                Chats
              </button>
              {active ? (
                <>
                  <span className="hidden text-ink-400 sm:inline" aria-hidden>
                    {kindGlyph(active.kind)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{active.title}</p>
                    <p className="truncate text-xs text-ink-500">
                      Job {report.project.projectNumber}
                      {report.project.phaseLabel ? ` · ${report.project.phaseLabel}` : ''}
                      {' · '}
                      {participantLine(active, brandName)}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-600">Select a conversation</p>
              )}
            </div>
            <CompanyMark
              name={brandName}
              logoUrl={logoBroken ? null : report.brand.logoUrl}
              onLogoError={() => setLogoBroken(true)}
              size="sm"
            />
          </div>
        </header>

        <div ref={scrollerRef} className="gpt-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {!active ? (
              <p className="text-center text-sm text-ink-500">
                Choose a side conversation to get started.
              </p>
            ) : empty ? (
              <EmptyConversation
                conversation={active}
                brandName={brandName}
                logoUrl={logoBroken ? null : report.brand.logoUrl}
                onLogoError={() => setLogoBroken(true)}
                customerName={report.share.customerName}
                suggestions={suggestionsFor(active, report)}
                onSuggest={(s) => void send(s)}
              />
            ) : (
              <ul className="space-y-5">
                {messages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    message={m}
                    brandName={brandName}
                    logoUrl={logoBroken ? null : report.brand.logoUrl}
                    onLogoError={() => setLogoBroken(true)}
                  />
                ))}
                {busy && active.kind === 'assistant' && (
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

        <div className="gpt-composer shrink-0">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
            {error && <p className="mb-2 text-center text-xs text-danger-700">{error}</p>}
            <form onSubmit={onSubmit} className="gpt-input-shell">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={placeholder}
                disabled={busy || !active}
                className="gpt-textarea"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim() || !active}
                aria-label="Send message"
                className="gpt-send"
              >
                <SendIcon />
              </button>
            </form>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {active?.kind === 'group'
                ? 'Everyone in this group can see these messages — company and adjuster included.'
                : active?.kind === 'adjuster'
                  ? 'Direct with your adjuster. Use the group chat to loop in the company.'
                  : active?.kind === 'company'
                    ? `Direct with ${brandName}. Start a group chat to include your adjuster.`
                    : `Answers are educational — confirm coverage with your adjuster.`}
            </p>
          </div>
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

function EmptyConversation({
  conversation,
  brandName,
  logoUrl,
  onLogoError,
  customerName,
  suggestions,
  onSuggest,
}: {
  conversation: PortalConversation;
  brandName: string;
  logoUrl: string | null;
  onLogoError: () => void;
  customerName: string | null;
  suggestions: string[];
  onSuggest: (s: string) => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-2 text-center">
      <div className="gpt-empty-mark">
        <CompanyMark name={brandName} logoUrl={logoUrl} onLogoError={onLogoError} size="lg" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
        {conversation.title}
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">
        {emptyCopy(conversation, brandName, customerName)}
      </p>
      {suggestions.length > 0 && (
        <div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-2">
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
  message,
  brandName,
  logoUrl,
  onLogoError,
}: {
  message: PortalMessage;
  brandName: string;
  logoUrl: string | null;
  onLogoError: () => void;
}) {
  const isUser = message.authorKind === 'homeowner';
  if (isUser) {
    return (
      <li className="flex justify-end gap-3">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <p className="mb-1 text-right text-[11px] font-medium text-ink-400">You</p>
          <div className="rounded-3xl rounded-br-md bg-ink-900 px-4 py-3 text-sm leading-relaxed text-white">
            <p className="whitespace-pre-wrap">{message.body}</p>
          </div>
        </div>
      </li>
    );
  }

  const label =
    message.authorKind === 'adjuster'
      ? message.authorName ?? 'Adjuster'
      : message.authorKind === 'staff'
        ? message.authorName ?? brandName
        : message.authorName ?? brandName;

  return (
    <li className="flex items-start gap-3">
      <AuthorAvatar
        kind={message.authorKind}
        brandName={brandName}
        logoUrl={logoUrl}
        onLogoError={onLogoError}
        name={label}
      />
      <div className="min-w-0 max-w-[85%] flex-1 sm:max-w-[80%]">
        <p className="mb-1 text-[11px] font-medium text-ink-500">{label}</p>
        <div className="rounded-3xl rounded-tl-md bg-paper-0 px-4 py-3 text-sm leading-relaxed text-ink-800 shadow-card ring-1 ring-line/80">
          <p className="whitespace-pre-wrap">{message.body}</p>
        </div>
      </div>
    </li>
  );
}

function AuthorAvatar({
  kind,
  brandName,
  logoUrl,
  onLogoError,
  name,
}: {
  kind: PortalMessage['authorKind'];
  brandName: string;
  logoUrl: string | null;
  onLogoError: () => void;
  name: string;
}) {
  if (kind === 'adjuster') {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1e3a5f] text-[10px] font-semibold text-white">
        {companyInitials(name)}
      </span>
    );
  }
  return (
    <CompanyMark name={brandName} logoUrl={logoUrl} onLogoError={onLogoError} size="sm" />
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
  const dim = size === 'lg' ? 'h-16 w-16' : size === 'md' ? 'h-10 w-10' : 'h-8 w-8';
  const text = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-sm' : 'text-xs';
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
      {companyInitials(name)}
    </span>
  );
}

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'RC';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function kindGlyph(kind: PortalConversation['kind']): string {
  switch (kind) {
    case 'assistant':
      return '✦';
    case 'company':
      return '⌂';
    case 'adjuster':
      return '◇';
    case 'group':
      return '☰';
  }
}

function kindSubtitle(c: PortalConversation): string {
  switch (c.kind) {
    case 'assistant':
      return 'Job & insurance Q&A';
    case 'company':
      return 'Direct message';
    case 'adjuster':
      return 'Direct with adjuster';
    case 'group':
      return 'You · company · adjuster';
  }
}

function participantLine(c: PortalConversation, brandName: string): string {
  const parts = ['You'];
  if (c.includesCompany) parts.push(brandName);
  if (c.includesAdjuster) parts.push('Adjuster');
  if (c.includesAssistant) parts.push('Assistant');
  return parts.join(' · ');
}

function emptyCopy(
  c: PortalConversation,
  brandName: string,
  customerName: string | null,
): string {
  const hi = customerName ? `${customerName.split(' ')[0]}, ` : '';
  switch (c.kind) {
    case 'assistant':
      return `${hi}ask about your schedule, drying progress, or insurance for this job.`;
    case 'company':
      return `${hi}message ${brandName} directly about access, schedule, or what is happening on site.`;
    case 'adjuster':
      return `${hi}message your insurance adjuster directly. The restoration company will not see this thread.`;
    case 'group':
      return `${hi}put ${brandName} and your adjuster in one thread so everyone stays aligned.`;
  }
}

function suggestionsFor(c: PortalConversation, report: HomeownerReport): string[] {
  if (c.kind === 'assistant') {
    return [
      'What is the tentative schedule?',
      'Who should I call?',
      'How is drying going?',
      'What should I know about my claim?',
    ].slice(0, 4);
  }
  if (c.kind === 'company') {
    return [
      'When will the crew be back on site?',
      'Can someone call me about access?',
      'Please update me on progress.',
    ];
  }
  if (c.kind === 'adjuster') {
    return [
      'Can you confirm what is approved so far?',
      'When is the next inspection?',
      report.claim?.claimNumber
        ? `This is about claim ${report.claim.claimNumber}.`
        : 'I have a question about my claim.',
    ];
  }
  return [
    'Can we align on next steps for this claim?',
    'Please confirm the schedule together.',
    'I want both of you on the same page about scope.',
  ];
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
          {report.schedule && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Tentative schedule
              </h3>
              <dl className="mt-2 space-y-1.5">
                <Row label="Start" value={fmtDate(report.schedule.scheduledStartAt)} />
                <Row label="Target completion" value={fmtDate(report.schedule.targetCompletionAt)} />
              </dl>
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
              </dl>
            </section>
          )}
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
            Paste declarations text or upload a text file for Q&amp;A in the assistant chat.
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
