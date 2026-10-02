import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { count } from '../lib/format';
import { renderCampaignMarkdown } from '../lib/campaignMarkdown';
import {
  STATUSES,
  STATUS_LABEL,
  audienceSummary,
  matchesAudience,
  planLabel,
  planOptions,
} from '../lib/contacts';
import type {
  AudienceCount,
  Campaign,
  CampaignAudience,
  CampaignDraft,
  CampaignSendingState,
  ContactStatus,
} from '../lib/types';
import { ErrorLine, Footnotes, Loading, PageHeader, Section, Tag } from '../components/report';

const EMPTY: CampaignDraft = {
  name: '',
  subject: '',
  bodyMarkdown: '',
  audience: { plans: [], statuses: [], sources: [] },
};

type FormatKind = 'bold' | 'italic' | 'heading' | 'list' | 'link';
const FORMATS: Array<[string, string, FormatKind]> = [
  ['B', 'Bold', 'bold'],
  ['I', 'Italic', 'italic'],
  ['H', 'Heading', 'heading'],
  ['•', 'Bulleted list', 'list'],
  ['Link', 'Link', 'link'],
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Wrap the textarea selection in markdown markers. */
function wrapSelection(el: HTMLTextAreaElement | null, before: string, after = before, placeholder = 'text') {
  if (!el) return null;
  const { selectionStart: s, selectionEnd: e, value } = el;
  const selected = value.slice(s, e) || placeholder;
  return value.slice(0, s) + before + selected + after + value.slice(e);
}

function prefixLine(el: HTMLTextAreaElement | null, prefix: string) {
  if (!el) return null;
  const { selectionStart: s, value } = el;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  return value.slice(0, lineStart) + prefix + value.slice(lineStart);
}

export function CampaignBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [sending, setSending] = useState<CampaignSendingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [counts, setCounts] = useState<AudienceCount | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const contacts = useApi(() => api.contacts(), []);
  const list = useApi(() => api.campaigns(), []);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    api
      .campaign(id!)
      .then(({ campaign: c, sending: s }) => {
        if (cancelled) return;
        setCampaign(c);
        setSending(s);
        setDraft({ name: c.name, subject: c.subject, bodyMarkdown: c.bodyMarkdown, audience: c.audience });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load this campaign');
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const sendingState = sending ?? list.data?.sending ?? null;
  const editable = !campaign || campaign.status === 'draft';

  // Server-side recipient count (filters + suppressions), debounced.
  const audienceKey = JSON.stringify(draft.audience);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .audienceCount(JSON.parse(audienceKey) as CampaignAudience)
        .then((next) => {
          if (!cancelled) setCounts(next);
        })
        .catch(() => {
          if (!cancelled) setCounts(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audienceKey]);

  const allContacts = useMemo(() => contacts.data?.contacts ?? [], [contacts.data]);
  const localMatched = useMemo(
    () => allContacts.filter((c) => matchesAudience(c, draft.audience)),
    [allContacts, draft.audience],
  );
  const recipients = counts?.recipients ?? localMatched.filter((c) => !c.suppressed).length;
  const html = useMemo(() => renderCampaignMarkdown(draft.bodyMarkdown), [draft.bodyMarkdown]);

  function update<K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setNotice(null);
  }

  function updateAudience(next: Partial<CampaignAudience>) {
    setDraft((d) => ({ ...d, audience: { ...d.audience, ...next } }));
    setNotice(null);
  }

  async function save(): Promise<Campaign | null> {
    setSaving(true);
    setActionError(null);
    try {
      const { campaign: saved } = campaign
        ? await api.updateCampaign(campaign.id, draft)
        : await api.createCampaign(draft);
      setCampaign(saved);
      setNotice(`Draft saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`);
      if (isNew) navigate(`/campaigns/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save the draft');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!campaign) return;
    if (!window.confirm(`Delete the draft “${campaign.name}”? This cannot be undone.`)) return;
    try {
      await api.deleteCampaign(campaign.id);
      navigate('/campaigns');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete the draft');
    }
  }

  async function openConfirm() {
    const saved = await save();
    if (!saved) return;
    setConfirmChecked(false);
    setConfirmOpen(true);
  }

  async function send() {
    if (!campaign) return;
    setSendBusy(true);
    setActionError(null);
    try {
      const result = await api.sendCampaign(campaign.id, recipients);
      setCampaign(result.campaign);
      setConfirmOpen(false);
      setNotice(`Sent to ${count(result.sent)} of ${count(result.attempted)} recipients; ${count(result.failed)} failed.`);
    } catch (err) {
      setActionError(err instanceof ApiError || err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendBusy(false);
    }
  }

  function applyFormat(kind: FormatKind) {
    const el = bodyRef.current;
    const next =
      kind === 'bold'
        ? wrapSelection(el, '**')
        : kind === 'italic'
          ? wrapSelection(el, '*')
          : kind === 'heading'
            ? prefixLine(el, '## ')
            : kind === 'list'
              ? prefixLine(el, '- ')
              : wrapSelection(el, '[', '](https://)', 'link text');
    if (next !== null) update('bodyMarkdown', next);
    el?.focus();
  }

  if (!isNew && !campaign && !loadError) return <Loading label="Loading campaign" />;

  const readyToSend = editable && draft.subject.trim() !== '' && draft.bodyMarkdown.trim() !== '' && recipients > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Contacts & campaigns · Campaign builder"
        title={draft.name.trim() || (isNew ? 'New campaign' : 'Untitled campaign')}
        subtitle={
          <>
            <Link to="/campaigns" className="text-brand-600 underline-offset-2 hover:underline">
              All campaigns
            </Link>
            {campaign && (
              <span className="ml-3">
                <Tag tone={campaign.status === 'draft' ? 'neutral' : campaign.status === 'sent' ? 'good' : 'accent'}>
                  {campaign.status}
                </Tag>
              </span>
            )}
          </>
        }
      />
      {loadError && <ErrorLine message={loadError} />}
      {actionError && <ErrorLine message={actionError} />}

      <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div>
          <Section title="1. Audience" note="Empty filters mean everyone">
            <div className="space-y-4 text-[13px]">
              <fieldset disabled={!editable}>
                <legend className="eyebrow mb-1.5">Plan</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {planOptions(allContacts).map((p) => (
                    <label key={p} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[rgb(var(--brand-500))]"
                        checked={draft.audience.plans.includes(p)}
                        onChange={() => updateAudience({ plans: toggle(draft.audience.plans, p) })}
                      />
                      {planLabel(p === 'none' ? null : p)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={!editable}>
                <legend className="eyebrow mb-1.5">Subscription status</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {STATUSES.map((s: ContactStatus) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[rgb(var(--brand-500))]"
                        checked={draft.audience.statuses.includes(s)}
                        onChange={() => updateAudience({ statuses: toggle(draft.audience.statuses, s) })}
                      />
                      {STATUS_LABEL[s]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={!editable}>
                <legend className="eyebrow mb-1.5">Source</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-[rgb(var(--brand-500))]"
                      checked={draft.audience.sources.includes('stripe')}
                      onChange={() => updateAudience({ sources: toggle(draft.audience.sources, 'stripe') })}
                    />
                    Stripe
                  </label>
                  <label className="flex items-center gap-1.5 text-ink-400">
                    <input type="checkbox" disabled checked={false} readOnly />
                    CRM (coming soon)
                  </label>
                </div>
              </fieldset>

              <table className="report-table max-w-md" data-testid="audience-count">
                <tbody>
                  <tr>
                    <td>Contacts matching filters</td>
                    <td className="num">{count(counts?.matched ?? localMatched.length)}</td>
                  </tr>
                  <tr>
                    <td>Less: unsubscribed</td>
                    <td className="num">({count(counts?.suppressed ?? localMatched.filter((c) => c.suppressed).length)})</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-ink-900">Recipients</td>
                    <td className="num font-semibold text-ink-900">{count(recipients)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[12px] text-ink-500">{audienceSummary(draft.audience)}</p>
            </div>
          </Section>

          <Section title="2. Message" note="Markdown; no images or HTML">
            <div className="space-y-3">
              <label className="block">
                <span className="eyebrow">Campaign name (internal)</span>
                <input
                  className="field mt-1"
                  value={draft.name}
                  maxLength={200}
                  disabled={!editable}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="e.g. Q4 product update"
                />
              </label>
              <label className="block">
                <span className="eyebrow">Subject line</span>
                <input
                  className="field mt-1"
                  value={draft.subject}
                  maxLength={200}
                  disabled={!editable}
                  onChange={(e) => update('subject', e.target.value)}
                  placeholder="What the recipient sees in their inbox"
                />
                <span className="mt-0.5 block text-right text-[11px] text-ink-400 tabular-nums">
                  {draft.subject.length} / 200
                </span>
              </label>
              <div>
                <div className="flex items-end justify-between">
                  <span className="eyebrow">Body</span>
                  <div className="flex gap-px" role="toolbar" aria-label="Formatting">
                    {FORMATS.map(([label, title, kind]) => (
                      <button
                        key={title}
                        type="button"
                        title={title}
                        aria-label={title}
                        disabled={!editable}
                        className="btn min-w-[30px] px-2 py-0.5 text-[12px]"
                        onClick={() => applyFormat(kind)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  ref={bodyRef}
                  className="field mt-1 min-h-[260px] font-mono text-[12.5px] leading-relaxed"
                  value={draft.bodyMarkdown}
                  disabled={!editable}
                  onChange={(e) => update('bodyMarkdown', e.target.value)}
                  placeholder={'## Heading\n\nA paragraph with **bold**, *italic* and a [link](https://example.test).\n\n- A bullet'}
                />
              </div>
            </div>
          </Section>
        </div>

        <div>
          <Section title="3. Preview" note="As each recipient will see it">
            <div className="border border-line-strong bg-paper-0" data-testid="email-preview">
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-1 border-b border-line px-4 py-3 text-[12.5px]">
                <dt className="text-ink-500">From</dt>
                <dd className="text-ink-800">Atmosphere (platform mail sender)</dd>
                <dt className="text-ink-500">To</dt>
                <dd className="text-ink-800">Each recipient individually · {count(recipients)} emails</dd>
                <dt className="text-ink-500">Subject</dt>
                <dd className="font-semibold text-ink-900">{draft.subject || <span className="font-normal text-ink-400">No subject yet</span>}</dd>
              </dl>
              <div className="campaign-preview px-5 py-5 font-display text-[15px] leading-relaxed text-ink-900">
                {draft.bodyMarkdown.trim() ? (
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <p className="text-ink-400">The body preview appears here.</p>
                )}
                <hr className="my-6 border-line" />
                <p className="font-sans text-[11.5px] leading-normal text-ink-500">
                  You are receiving this because you have an Atmosphere account.{' '}
                  <span className="underline">Unsubscribe</span>.
                  <br />
                  Company postal address (set on the server)
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-500">
              Each email has its own one-click unsubscribe link and List-Unsubscribe header. Unsubscribes are honoured on the
              next send.
            </p>
          </Section>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t-2 border-rule py-3">
        <button type="button" className="btn" onClick={() => void save()} disabled={!editable || saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        {campaign && campaign.status === 'draft' && (
          <button type="button" className="btn text-danger-600" onClick={() => void remove()}>
            Delete draft
          </button>
        )}
        {notice && <span className="text-[12.5px] text-ink-600" role="status">{notice}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {sendingState && !sendingState.enabled && (
            <span className="text-[12px] text-caution-600" data-testid="sending-off">
              Sending is off on this server
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!readyToSend || saving}
            onClick={() => void openConfirm()}
            title={readyToSend ? undefined : 'Add a subject, a body and at least one recipient'}
          >
            Send campaign…
          </button>
        </div>
      </div>

      {confirmOpen && campaign && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-ink-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-send-title"
        >
          <div className="w-full max-w-lg border border-line-strong bg-paper-0 p-6 shadow-none">
            <p className="eyebrow">Confirm send</p>
            <h2 id="confirm-send-title" className="mt-1 text-[22px] text-ink-900">
              Send campaign to {count(recipients)} recipients?
            </h2>
            <table className="report-table mt-4">
              <tbody>
                <tr><td>Campaign</td><td>{draft.name || 'Untitled campaign'}</td></tr>
                <tr><td>Subject</td><td>{draft.subject}</td></tr>
                <tr><td>Audience</td><td>{audienceSummary(draft.audience)}</td></tr>
                <tr><td>Unsubscribed, skipped</td><td className="num">{count(counts?.suppressed ?? 0)}</td></tr>
                <tr><td className="font-semibold text-ink-900">Recipients</td><td className="num font-semibold text-ink-900">{count(recipients)}</td></tr>
              </tbody>
            </table>
            {sendingState && !sendingState.enabled ? (
              <p className="mt-4 border-l-2 border-caution-600 pl-3 text-[12.5px] text-ink-700" data-testid="confirm-sending-off">
                <span className="font-semibold text-ink-900">Sending is off.</span> {sendingState.reason} This campaign stays a
                draft and no email will be sent.
              </p>
            ) : (
              <label className="mt-4 flex items-start gap-2 text-[13px] text-ink-800">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[rgb(var(--brand-500))]"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                />
                I have checked the preview and want to email {count(recipients)} customers now. This cannot be undone.
              </label>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!sendingState?.enabled || !confirmChecked || sendBusy}
                onClick={() => void send()}
              >
                {sendBusy ? 'Sending…' : `Send to ${count(recipients)} recipients`}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footnotes
        notes={[
          'Recipients are worked out again on the server at send time from live Stripe contacts and the suppression list; the send is refused if the count differs from the one confirmed here.',
          'Preview uses the same markdown rules as the sent email: headings, paragraphs, bullets, bold, italic and http(s) or mailto links. Everything else is shown as plain text.',
        ]}
      />
    </div>
  );
}
