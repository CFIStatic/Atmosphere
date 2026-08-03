import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import {
  api,
  type Campaign,
  type CampaignChannel,
  type CampaignMember,
  type CampaignMemberStatus,
  type Territory,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';

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

  async function load() {
    try {
      const [campaigns, terr] = await Promise.all([api.campaigns(), api.territories()]);
      setItems(campaigns.items);
      setTerritories(terr.items);
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
    if (next && !members[next]) {
      try {
        const res = await api.campaignMembers(next);
        setMembers((prev) => ({ ...prev, [next]: res.items }));
      } catch {
        setMembers((prev) => ({ ...prev, [next]: [] }));
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
