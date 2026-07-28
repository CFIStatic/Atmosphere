import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  type PortalConversation,
  type PortalMessage,
  type PortalShare,
  type PortalVisibility,
} from '../../lib/api';
import { SpinnerIcon } from '../icons';
import { Card, EmptyState } from '../pm/primitives';

const VISIBILITY_TOGGLES: {
  key:
    | 'showSchedule'
    | 'showPhaseProgress'
    | 'showMilestones'
    | 'showCustomerUpdates'
    | 'showDryingSummary'
    | 'showDocuments'
    | 'showClaimBasics'
    | 'showDeductible'
    | 'showOfficeContact'
    | 'showAdjusterContact'
    | 'showFieldContact'
    | 'allowChat'
    | 'allowAdjusterChat'
    | 'allowGroupChat'
    | 'allowPolicyUpload'
    | 'allowInsuranceQa';
  label: string;
  hint: string;
}[] = [
  { key: 'showSchedule', label: 'Tentative schedule', hint: 'Start / target dates' },
  { key: 'showPhaseProgress', label: 'Phase progress', hint: 'Current workflow phase' },
  { key: 'showMilestones', label: 'Milestones', hint: 'Customer / carrier / permit dates' },
  { key: 'showCustomerUpdates', label: 'Customer updates', hint: 'Approved or sent messages' },
  { key: 'showDryingSummary', label: 'Drying summary', hint: 'High-level dry-out status' },
  { key: 'showDocuments', label: 'Documents checklist', hint: 'Provided / waived only' },
  { key: 'showClaimBasics', label: 'Claim basics', hint: 'Carrier and claim number' },
  { key: 'showDeductible', label: 'Deductible amount', hint: 'Requires claim basics' },
  { key: 'showOfficeContact', label: 'Office contact', hint: 'Who the homeowner should call' },
  { key: 'showAdjusterContact', label: 'Adjuster contact', hint: 'From the project record' },
  { key: 'showFieldContact', label: 'Field contact', hint: 'Optional crew contact' },
  { key: 'allowChat', label: 'Company chat', hint: 'Homeowner ↔ your company DM' },
  { key: 'allowAdjusterChat', label: 'Adjuster chat', hint: 'Homeowner ↔ adjuster DM' },
  { key: 'allowGroupChat', label: 'Group chat', hint: 'Homeowner + company + adjuster' },
  { key: 'allowPolicyUpload', label: 'Allow policy upload', hint: 'Paste / upload policy text' },
  { key: 'allowInsuranceQa', label: 'Assistant Q&A', hint: 'Location + carrier aware answers' },
];

/**
 * Staff controls for the HomeOwner communications portal: mint links, brand,
 * limit shared info, and reply in company / adjuster / group threads.
 */
export function HomeownerPortalPanel({ projectId }: { projectId: string }) {
  const [shares, setShares] = useState<PortalShare[]>([]);
  const [visibility, setVisibility] = useState<PortalVisibility | null>(null);
  const [conversations, setConversations] = useState<PortalConversation[]>([]);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [thread, setThread] = useState<PortalMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [welcomeNote, setWelcomeNote] = useState('');
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [officePhone, setOfficePhone] = useState('');
  const [officeEmail, setOfficeEmail] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [reply, setReply] = useState('');
  const [replyAs, setReplyAs] = useState<'staff' | 'adjuster'>('staff');

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const load = useCallback(async () => {
    try {
      const data = await api.portalProject(projectId);
      setShares(data.shares);
      setVisibility(data.visibility);
      setConversations(data.conversations);
      setMessages(data.messages);
      setBrandName(data.visibility.brandName ?? '');
      setLogoUrl(data.visibility.logoUrl ?? '');
      setOfficePhone(data.visibility.officePhone ?? '');
      setOfficeEmail(data.visibility.officeEmail ?? '');
      setCustomMessage(data.visibility.customMessage ?? '');
      const preferred =
        data.conversations.find((c) => c.kind === 'company') ??
        data.conversations.find((c) => c.kind === 'group') ??
        data.conversations[0];
      if (preferred) {
        setActiveConversationId(preferred.id);
        const detail = await api.portalStaffConversationMessages(projectId, preferred.id);
        setThread(detail.messages);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load homeowner portal settings.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectConversation(id: string) {
    setActiveConversationId(id);
    setBusy(true);
    try {
      const detail = await api.portalStaffConversationMessages(projectId, id);
      setThread(detail.messages);
      const conv = detail.conversation;
      setReplyAs(conv.includesAdjuster && !conv.includesCompany ? 'adjuster' : 'staff');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function mintShare(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFreshLink(null);
    try {
      const created = await api.portalCreateShare(projectId, {
        welcomeNote: welcomeNote.trim() || null,
      });
      setFreshLink(`${window.location.origin}${created.path}`);
      setWelcomeNote('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a share link.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(shareId: string) {
    setBusy(true);
    try {
      await api.portalRevokeShare(projectId, shareId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke that link.');
    } finally {
      setBusy(false);
    }
  }

  async function saveVisibility(patch: Partial<PortalVisibility>) {
    if (!visibility) return;
    const next = { ...visibility, ...patch };
    setVisibility(next);
    try {
      const { visibility: saved } = await api.portalUpdateVisibility(projectId, patch);
      setVisibility(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save visibility.');
      await load();
    }
  }

  async function saveContactFields(e: FormEvent) {
    e.preventDefault();
    await saveVisibility({
      brandName: brandName.trim() || null,
      logoUrl: logoUrl.trim() || null,
      officePhone: officePhone.trim() || null,
      officeEmail: officeEmail.trim() || null,
      customMessage: customMessage.trim() || null,
    });
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim() || !activeConversationId) return;
    setBusy(true);
    try {
      await api.portalStaffReply(projectId, activeConversationId, reply.trim(), replyAs);
      setReply('');
      const detail = await api.portalStaffConversationMessages(projectId, activeConversationId);
      setThread(detail.messages);
      const data = await api.portalProject(projectId);
      setMessages(data.messages);
      setConversations(data.conversations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that reply.');
    } finally {
      setBusy(false);
    }
  }

  if (!visibility) {
    return (
      <Card className="mt-6" title="HomeOwner Report">
        {error ? (
          <p className="text-sm text-ink-600">{error}</p>
        ) : (
          <div className="flex justify-center py-6 text-brand-600">
            <SpinnerIcon className="animate-spin" width={22} height={22} />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      className="mt-6"
      title="HomeOwner Report"
      action={
        <span className="text-xs text-ink-500">Communications · company · adjuster · group</span>
      }
    >
      {error && <p className="mb-3 text-sm text-danger-700">{error}</p>}

      <form onSubmit={mintShare} className="space-y-3 rounded-lg border border-line bg-paper-50 p-3">
        <p className="text-sm text-ink-700">
          Create a private link. The homeowner gets side conversations with your company, their
          adjuster, and a group thread so everyone stays aligned.
        </p>
        <textarea
          value={welcomeNote}
          onChange={(e) => setWelcomeNote(e.target.value)}
          rows={2}
          placeholder="Optional welcome note…"
          className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          Create homeowner link
        </button>
        {freshLink && (
          <div className="rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-ink-800">
            <p className="font-medium text-success-700">Copy this link now — it will not be shown again.</p>
            <p className="mt-1 break-all font-mono text-xs">{freshLink}</p>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-brand-700 hover:underline"
              onClick={() => void navigator.clipboard.writeText(freshLink)}
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </form>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Active links</h3>
        {shares.length === 0 ? (
          <EmptyState>No homeowner links yet.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm text-ink-800">
                    {s.customerName ?? s.label ?? 'Homeowner link'}{' '}
                    <span className="text-xs uppercase text-ink-500">{s.status}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    Created {new Date(s.createdAt).toLocaleDateString()}
                    {s.lastAccessedAt
                      ? ` · last opened ${new Date(s.lastAccessedAt).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                {s.status === 'active' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(s.id)}
                    className="rounded-lg border border-line bg-paper-0 px-2.5 py-1 text-xs text-ink-700 hover:bg-paper-100"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          What homeowners can see &amp; who they can message
        </h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {VISIBILITY_TOGGLES.map(({ key, label, hint }) => {
            const on = Boolean(visibility[key]);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => void saveVisibility({ [key]: !on })}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                    on
                      ? 'border-brand-200 bg-brand-50'
                      : 'border-line bg-paper-0 hover:bg-paper-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-paper-0'
                    }`}
                    aria-hidden
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span>
                    <span className="block text-sm text-ink-800">{label}</span>
                    <span className="block text-xs text-ink-500">{hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <form onSubmit={saveContactFields} className="mt-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Company brand on the chat
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Company display name"
            className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          />
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="Logo URL (https://…)"
            className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={officePhone}
            onChange={(e) => setOfficePhone(e.target.value)}
            placeholder="Office phone"
            className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          />
          <input
            value={officeEmail}
            onChange={(e) => setOfficeEmail(e.target.value)}
            placeholder="Office email"
            className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          />
        </div>
        <textarea
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          rows={2}
          placeholder="Custom message shown on the portal…"
          className="w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
        />
        <button
          type="submit"
          className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-700 hover:bg-paper-100"
        >
          Save brand &amp; contact details
        </button>
      </form>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Conversations
        </h3>
        {conversations.length === 0 ? (
          <EmptyState>No conversations yet — mint a homeowner link first.</EmptyState>
        ) : (
          <div className="mt-2 grid gap-3 lg:grid-cols-[14rem_1fr]">
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void selectConversation(c.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      activeConversationId === c.id
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-ink-700 hover:bg-paper-100'
                    }`}
                  >
                    <span className="block font-medium">{c.title}</span>
                    <span className="block text-xs uppercase tracking-wide text-ink-500">
                      {c.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="rounded-lg border border-line bg-paper-0 p-3">
              {activeConversation ? (
                <>
                  <p className="text-xs text-ink-500">
                    {activeConversation.kind === 'group'
                      ? 'Group · homeowner, company, adjuster'
                      : activeConversation.kind === 'adjuster'
                        ? 'Direct with adjuster — reply as adjuster when coordinating'
                        : activeConversation.kind === 'company'
                          ? 'Direct with company'
                          : 'Assistant Q&A'}
                  </p>
                  <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {thread.length === 0 ? (
                      <li className="text-sm text-ink-500">No messages in this thread yet.</li>
                    ) : (
                      thread.map((m) => (
                        <li key={m.id} className="rounded-lg bg-paper-50 px-3 py-2 text-sm">
                          <p className="text-xs uppercase tracking-wide text-ink-500">
                            {m.authorKind}
                            {m.authorName ? ` · ${m.authorName}` : ''}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-ink-800">{m.body}</p>
                        </li>
                      ))
                    )}
                  </ul>
                  {activeConversation.kind !== 'assistant' && (
                    <form onSubmit={sendReply} className="mt-3 space-y-2">
                      {activeConversation.includesAdjuster && (
                        <select
                          value={replyAs}
                          onChange={(e) => setReplyAs(e.target.value as 'staff' | 'adjuster')}
                          className="rounded-lg border border-line bg-paper-0 px-2 py-2 text-sm"
                        >
                          {activeConversation.includesCompany && (
                            <option value="staff">Reply as company</option>
                          )}
                          <option value="adjuster">Reply as adjuster</option>
                        </select>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder="Reply in this conversation…"
                          className="flex-1 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                        />
                        <button
                          type="submit"
                          disabled={busy || !reply.trim()}
                          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          Reply
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-500">Select a conversation.</p>
              )}
            </div>
          </div>
        )}
        {messages.length > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            {messages.length} recent message{messages.length === 1 ? '' : 's'} across all threads.
          </p>
        )}
      </div>
    </Card>
  );
}
