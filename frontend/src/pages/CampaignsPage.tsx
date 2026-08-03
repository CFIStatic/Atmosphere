import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import {
  api,
  type Campaign,
  type CampaignChannel,
  type CampaignMember,
  type CampaignMemberStatus,
  type Territory,
  type WeatherGroup,
  type PlaceCategory,
  type AudienceMember,
  type SendPreview,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { PlaceFinder } from '../components/campaigns/PlaceFinder';
import { WeatherWatch } from '../components/campaigns/WeatherWatch';

/**
 * Campaigns — deliberate outreach, and whether it worked.
 *
 * A lead answers "what is happening with this opportunity". A campaign is not
 * an opportunity: its unit of work is the touch, and most of the people in one
 * have no lead at all. Creating a lead for every person you email would fill
 * the pipeline with opportunities nobody agreed exist, which is why members
 * reference a contact or a prospect directly.
 *
 * The numbers are the reason to open this page, so they lead. "Sent 40, opened
 * 12, replied 3" is the whole story of a campaign, and a page that made you
 * click into each one to assemble that would be a worse page.
 */

const STATUS_ORDER: CampaignMemberStatus[] = [
  'pending', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed', 'skipped',
];

const STATUS_STYLE: Record<CampaignMemberStatus, string> = {
  pending: 'bg-paper-200/60 text-ink-500',
  sent: 'bg-paper-200/60 text-ink-700',
  opened: 'bg-brand-50 text-brand-700',
  replied: 'bg-success-50 text-success-600',
  bounced: 'bg-danger-50 text-danger-600',
  unsubscribed: 'bg-danger-50 text-danger-600',
  skipped: 'bg-paper-200/60 text-ink-500',
};

export function CampaignsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, CampaignMember[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>('email');
  const [territoryId, setTerritoryId] = useState('');

  // Weather trigger + audience rules + the message itself. A weather campaign
  // sends while nobody is watching, so all three are written up front.
  const [triggerKind, setTriggerKind] = useState<'manual' | 'weather'>('manual');
  const [groups, setGroups] = useState<string[]>([]);
  const [leadHours, setLeadHours] = useState(48);
  const [weatherGroups, setWeatherGroups] = useState<WeatherGroup[]>([]);
  const [placeCats, setPlaceCats] = useState<PlaceCategory[]>([]);
  const [audCategories, setAudCategories] = useState<string[]>([]);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [titleWords, setTitleWords] = useState('facilities, operations, property');
  const [subject, setSubject] = useState('Checking in ahead of the weather');
  const [body, setBody] = useState(
    'Hi {{first_name}},\n\nHope things are good at {{company}}. We\u2019re watching {{event}} for {{area}} over the next couple of days and wanted to check in before it arrives.\n\nIf anything does come up \u2014 water, roof, anything \u2014 we can have someone out same day. No obligation either way; just wanted you to have a number that answers.\n\n\u2014 {{sender}}',
  );
  const [audience, setAudience] = useState<Record<string, AudienceMember[]>>({});
  const [preview, setPreview] = useState<Record<string, SendPreview>>({});
  const [sending, setSending] = useState<string | null>(null);

  async function load() {
    try {
      const [campaigns, terr, weather, cats] = await Promise.all([
        api.campaigns(),
        api.territories(),
        api.weatherGroups().catch(() => ({ groups: [] as WeatherGroup[] })),
        api.placeCategories().catch(() => ({ categories: [] as PlaceCategory[] })),
      ]);
      setItems(campaigns.items);
      setTerritories(terr.items);
      setWeatherGroups(weather.groups);
      setPlaceCats(cats.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns.');
      setItems([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openCampaign(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (!next) return;

    if (!members[next]) {
      try {
        const res = await api.campaignMembers(next);
        setMembers((prev) => ({ ...prev, [next]: res.items }));
      } catch {
        setMembers((prev) => ({ ...prev, [next]: [] }));
      }
    }
    // Who the *rules* would reach, which is not the same as who has already
    // been added — and it is the number that matters before a send.
    if (!audience[next]) {
      try {
        const res = await api.campaignAudience(next);
        setAudience((prev) => ({ ...prev, [next]: res.members }));
      } catch {
        setAudience((prev) => ({ ...prev, [next]: [] }));
      }
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCampaign({
        name,
        goal: goal || null,
        channel,
        territoryId: territoryId || null,
        triggerKind,
        triggerConfig:
          triggerKind === 'weather' ? { groups, leadTimeHours: leadHours, cooldownDays: 14 } : {},
        audienceConfig: {
          placeCategories: audCategories,
          includeContacts,
          territoryId: territoryId || null,
          titleKeywords: titleWords
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
        messageSubject: subject || null,
        messageBody: body || null,
      });
      setName('');
      setGoal('');
      setTerritoryId('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(campaignId: string, memberId: string, status: CampaignMemberStatus) {
    // Optimistic: marking a touch is the most repeated action on this page and
    // waiting on a round trip for each one makes working a list feel broken.
    setMembers((prev) => ({
      ...prev,
      [campaignId]: (prev[campaignId] ?? []).map((m) =>
        m.id === memberId ? { ...m, status } : m,
      ),
    }));
    try {
      await api.setCampaignMemberStatus(campaignId, memberId, status);
      // Counts live on the campaign row, so they need a refresh to stay true.
      const res = await api.campaigns();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that.');
      const res = await api.campaignMembers(campaignId);
      setMembers((prev) => ({ ...prev, [campaignId]: res.items }));
    }
  }

  /**
   * The dry run. Never sends — and it is the default action on purpose,
   * because a weather campaign's audience is a rule rather than a list and the
   * only way to know who it reaches today is to ask.
   */
  async function check(id: string) {
    setSending(id);
    setError(null);
    try {
      const result = await api.sendCampaign(id);
      setPreview((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that campaign.');
    } finally {
      setSending(null);
    }
  }

  async function reallySend(id: string, count: number) {
    // A confirm on an action that mails real people from the customer's own
    // address. The count is in the question because "send this campaign?" is
    // a different decision at 6 recipients and at 600.
    if (!window.confirm(`Send this campaign to ${count} ${count === 1 ? 'person' : 'people'} now?`)) {
      return;
    }
    setSending(id);
    setError(null);
    try {
      const res = await api.sendCampaign(id, { confirm: true });
      setPreview((prev) => ({ ...prev, [id]: res }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that campaign.');
    } finally {
      setSending(null);
    }
  }

  const territoryName = useMemo(() => {
    const map = new Map(territories.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [territories]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="Campaigns"
        description="Deliberate outreach to a list of people, and what came back. Most of them will not have a lead yet — that is the point."
        action={
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700"
          >
            {creating ? 'Cancel' : 'New campaign'}
          </button>
        }
      />

      {creating && (
        <form onSubmit={create} className="mt-6 space-y-4 rounded-xl glass-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Name</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 property managers — North Austin"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Goal</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Get on the approved vendor list"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Channel</span>
              <select
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={channel}
                onChange={(e) => setChannel(e.target.value as CampaignChannel)}
              >
                <option value="email">Email</option>
                <option value="call">Call</option>
                <option value="mixed">Both</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Territory</span>
              <select
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={territoryId}
                onChange={(e) => setTerritoryId(e.target.value)}
              >
                <option value="">Not territory-specific</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* ---- what makes it go out ---- */}
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              When it sends
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {(['manual', 'weather'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setTriggerKind(kind)}
                  aria-pressed={triggerKind === kind}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    triggerKind === kind
                      ? 'bg-brand-600 text-ink-900'
                      : 'glass-card text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {kind === 'manual' ? 'When I send it' : 'When the weather turns'}
                </button>
              ))}
            </div>

            {triggerKind === 'weather' && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {weatherGroups.map((g) => {
                    const on = groups.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        title={g.blurb}
                        onClick={() =>
                          setGroups((prev) =>
                            prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                          )
                        }
                        aria-pressed={on}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          on ? 'bg-caution-50 text-caution-600' : 'glass-card text-ink-600'
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>

                <label className="block max-w-xs">
                  <span className="text-sm font-medium text-ink-700">Send when it is within</span>
                  <select
                    className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                    value={leadHours}
                    onChange={(e) => setLeadHours(Number(e.target.value))}
                  >
                    <option value={12}>12 hours</option>
                    <option value={24}>1 day</option>
                    <option value={48}>2 days</option>
                    <option value={72}>3 days</option>
                  </select>
                  <span className="mt-1.5 block text-xs text-ink-500">
                    Warnings usually arrive hours ahead, watches a day or two. Further out than this
                    and it waits — a storm that misses makes the next email easy to ignore.
                  </span>
                </label>
              </div>
            )}
          </fieldset>

          {/* ---- who it goes to ---- */}
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              Who it goes to
            </legend>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={includeContacts}
                onChange={(e) => setIncludeContacts(e.target.checked)}
                className="mt-0.5 accent-brand-600"
              />
              <span className="text-sm text-ink-700">
                People already in my CRM
                <span className="block text-xs text-ink-500">
                  Filtered by the territory and job titles below.
                </span>
              </span>
            </label>

            <p className="mt-3 text-sm text-ink-700">Buildings I have saved</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {placeCats.map((c) => {
                const on = audCategories.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={c.blurb}
                    onClick={() =>
                      setAudCategories((prev) =>
                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                      )
                    }
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      on ? 'bg-brand-600 text-ink-900' : 'glass-card text-ink-600 hover:text-ink-900'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            <label className="mt-3 block">
              <span className="text-sm font-medium text-ink-700">Job titles</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={titleWords}
                onChange={(e) => setTitleWords(e.target.value)}
                placeholder="facilities, operations, property"
              />
              <span className="mt-1.5 block text-xs text-ink-500">
                Comma separated. Leave empty to reach everyone in the territory.
              </span>
            </label>
          </fieldset>

          {/* ---- what it says ---- */}
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              What it says
            </legend>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Subject</span>
              <input
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-ink-700">Message</span>
              <textarea
                rows={9}
                className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm leading-relaxed text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-ink-500">
                <code className="text-ink-600">{'{{first_name}}'}</code>{' '}
                <code className="text-ink-600">{'{{company}}'}</code>{' '}
                <code className="text-ink-600">{'{{event}}'}</code>{' '}
                <code className="text-ink-600">{'{{area}}'}</code>{' '}
                <code className="text-ink-600">{'{{sender}}'}</code> get filled in. A missing name
                becomes “there”, never “Hi ,”.
              </span>
            </label>
          </fieldset>

          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            Create campaign
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <WeatherWatch />
        <PlaceFinder territories={territories} onImported={() => void load()} />
      </div>

      {items === null ? (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No campaigns yet"
            hint="A campaign is a list of people and a reason to contact them. Start one from a territory, or from the contacts you found in Find contacts."
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((campaign) => {
            const counts = campaign.counts ?? {};
            const total = counts.total ?? 0;
            const open = openId === campaign.id;
            return (
              <li key={campaign.id} className="rounded-xl glass-card p-4">
                <button
                  onClick={() => void openCampaign(campaign.id)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-ink-900">{campaign.name}</h2>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {campaign.goal ?? 'No stated goal'}
                      {territoryName(campaign.territoryId)
                        ? ` · ${territoryName(campaign.territoryId)}`
                        : ''}
                      {' · '}
                      {campaign.channel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {campaign.triggerKind === 'weather' && (
                      <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600">
                        weather
                      </span>
                    )}
                    <span className="text-xs text-ink-500">
                      {total} {total === 1 ? 'person' : 'people'}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                        campaign.status === 'active'
                          ? 'bg-success-50 text-success-600'
                          : campaign.status === 'paused'
                            ? 'bg-caution-50 text-caution-600'
                            : 'bg-paper-200/60 text-ink-500'
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </div>
                </button>

                {/* The numbers are the story: sent, opened, replied, in order. */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {STATUS_ORDER.filter((s) => counts[s]).map((status) => (
                    <span
                      key={status}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}
                    >
                      {counts[status]} {status}
                    </span>
                  ))}
                  {total === 0 && (
                    <span className="text-[11px] text-ink-500">Nobody added yet.</span>
                  )}
                </div>

                {open && (
                  <div className="mt-4 border-t border-line pt-4">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void check(campaign.id)}
                        disabled={sending === campaign.id}
                        className="flex items-center gap-2 rounded-lg glass-card px-3 py-2 text-xs font-semibold text-ink-800 transition hover:bg-paper-200/50 disabled:opacity-50"
                      >
                        {sending === campaign.id && (
                          <SpinnerIcon className="animate-spin" width={14} height={14} />
                        )}
                        Check who this would reach
                      </button>
                      {preview[campaign.id]?.dryRun && (preview[campaign.id].wouldSend ?? 0) > 0 && (
                        <button
                          onClick={() =>
                            void reallySend(campaign.id, preview[campaign.id].wouldSend ?? 0)
                          }
                          disabled={sending === campaign.id}
                          className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
                        >
                          Send to {preview[campaign.id].wouldSend} now
                        </button>
                      )}
                    </div>

                    {preview[campaign.id] && <SendReport report={preview[campaign.id]} />}

                    {audience[campaign.id] && audience[campaign.id].length > 0 && (
                      <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
                        <p className="text-xs font-semibold text-ink-900">
                          Its rules would reach{' '}
                          <span className="tabular-nums">{audience[campaign.id].length}</span>{' '}
                          {audience[campaign.id].length === 1 ? 'person' : 'people'} today
                        </p>
                        <ul className="mt-1.5 space-y-0.5">
                          {audience[campaign.id].slice(0, 5).map((m) => (
                            <li key={`${m.kind}-${m.id}`} className="text-[11px] text-ink-600">
                              {m.name}
                              {m.company && m.company !== m.name ? ` · ${m.company}` : ''} —{' '}
                              <span className="text-ink-500">{m.why}</span>
                            </li>
                          ))}
                          {audience[campaign.id].length > 5 && (
                            <li className="text-[11px] text-ink-500">
                              +{audience[campaign.id].length - 5} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {!members[campaign.id] ? (
                      <p className="text-xs text-ink-500">Loading…</p>
                    ) : members[campaign.id].length === 0 ? (
                      <p className="text-xs text-ink-500">
                        Nobody in this campaign yet. Add people from Find contacts or Accounts.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {members[campaign.id].map((member) => (
                          <li
                            key={member.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper-100/40 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-ink-800">
                                {member.personName}
                              </p>
                              <p className="text-[11px] text-ink-500">
                                {member.personCompany ?? '—'}
                                {member.personEmail ? ` · ${member.personEmail}` : ''}
                              </p>
                            </div>
                            <select
                              value={member.status}
                              onChange={(e) =>
                                void setStatus(
                                  campaign.id,
                                  member.id,
                                  e.target.value as CampaignMemberStatus,
                                )
                              }
                              className="rounded-lg glass-field px-2 py-1 text-[11px] text-ink-800 outline-none"
                            >
                              {STATUS_ORDER.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

/**
 * What a dry run found.
 *
 * The blocked list is shown with its reasons rather than summarised to a
 * number, because "34 blocked" tells nobody anything while "12 unsubscribed,
 * 3 already sent, 19 personal addresses" tells them their audience rule is
 * pointed at the wrong people.
 */
function SendReport({ report }: { report: SendPreview }) {
  const byReason = new Map<string, number>();
  for (const b of report.blocked) byReason.set(b.reason, (byReason.get(b.reason) ?? 0) + 1);

  const READABLE: Record<string, string> = {
    suppressed: 'on your do-not-contact list',
    erased: 'asked to be erased',
    unsubscribed: 'unsubscribed',
    already_sent: 'already sent this',
    role_address: 'shared mailbox (info@, sales@)',
    personal_address: 'personal address',
    disposable: 'throwaway inbox',
    invalid: 'not a valid address',
    bounced_before: 'bounced before',
    over_campaign_cap: 'over the campaign limit',
    over_daily_cap: 'over today’s sending limit',
  };

  return (
    <div className="mb-4 rounded-lg border border-line p-3">
      <p className="text-xs font-semibold text-ink-900">
        {report.dryRun ? (
          <>
            Would send to <span className="tabular-nums">{report.wouldSend}</span>
          </>
        ) : (
          <>
            Sent <span className="tabular-nums">{report.sent}</span>
            {report.from ? ` from ${report.from}` : ''}
          </>
        )}
      </p>

      {byReason.size > 0 && (
        <ul className="mt-2 space-y-0.5">
          {[...byReason.entries()].map(([reason, count]) => (
            <li key={reason} className="text-[11px] text-ink-600">
              <span className="tabular-nums">{count}</span> skipped — {READABLE[reason] ?? reason}
            </li>
          ))}
        </ul>
      )}

      {report.warnings && report.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {report.warnings.map((w) => (
            <li key={w} className="text-[11px] text-caution-600">
              {w}
            </li>
          ))}
        </ul>
      )}

      {report.failures && report.failures.length > 0 && (
        <p className="mt-2 text-[11px] text-danger-600">
          {report.failures.length} failed to send.
        </p>
      )}

      {report.sample && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-500">Preview the message</summary>
          <pre className="mt-1.5 whitespace-pre-wrap rounded-lg bg-paper-100/40 p-3 text-[11px] leading-relaxed text-ink-700">
            {report.sample}
          </pre>
        </details>
      )}
    </div>
  );
}
