import { useState } from 'react';
import { GlassModal } from './GlassModal';
import { CREW_INVITE_INTRO, CREW_PHONE_INVITE_INTRO, InviteCrewPanel } from './InviteCrewPanel';
import { HOMEOWNER_SHARE_INTRO, ShareJobProgressPanel } from './ShareJobProgressPanel';

/**
 * The one Share popup for a job file: invite the homeowner to follow
 * progress, or invite a trade or crew to film. Opens on Homeowner.
 */

type Audience = 'homeowner' | 'crew' | 'subcontractor';

const TABS: { key: Audience; label: string }[] = [
  { key: 'homeowner', label: 'Homeowner' },
  { key: 'crew', label: 'Subcontractor or crew' },
];

/** Access tab → Invite: the same flows, split three ways, crew first. */
const ACCESS_TABS: { key: Audience; label: string }[] = [
  { key: 'crew', label: 'Crew' },
  { key: 'subcontractor', label: 'Subcontractor' },
  { key: 'homeowner', label: 'Homeowner' },
];

const ROLE_HINT: Record<Audience, string> = {
  crew: 'Mobile number or email',
  subcontractor: 'Email',
  homeowner: 'Email',
};

const SUB_INVITE_INTRO = 'Email a Field Capture link so a subcontractor can film this job.';

export function SharePopup({
  jobId,
  onClose,
  initial,
  variant = 'share',
  onInvited,
}: {
  jobId: string;
  onClose: () => void;
  initial?: Audience;
  /** share: header Share button. access: Access tab Invite button. */
  variant?: 'share' | 'access';
  onInvited?: () => void;
}) {
  const access = variant === 'access';
  const tabs = access ? ACCESS_TABS : TABS;
  const [audience, setAudience] = useState<Audience>(initial ?? (access ? 'crew' : 'homeowner'));
  const [roleOpen, setRoleOpen] = useState(false);
  const intro =
    audience === 'homeowner'
      ? HOMEOWNER_SHARE_INTRO
      : audience === 'subcontractor'
        ? SUB_INVITE_INTRO
        : access
          ? CREW_PHONE_INVITE_INTRO
          : CREW_INVITE_INTRO;

  return (
    <GlassModal
      title={access ? 'Invite to this job' : 'Share'}
      description={intro}
      onClose={onClose}
      testId={access ? 'access-invite-popup' : 'share-popup'}
    >
      {access ? (
        <div className="relative mb-5">
          <span id="access-invite-role" className="text-xs font-medium text-ink-700">
            Role
          </span>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={roleOpen}
            aria-labelledby="access-invite-role"
            data-testid="access-invite-role"
            onClick={() => setRoleOpen((open) => !open)}
            className="mt-1.5 flex h-10 w-full items-center justify-between rounded-lg glass-field px-3 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-500/25"
          >
            {tabs.find((t) => t.key === audience)?.label}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-ink-500">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          {roleOpen ? (
            <ul
              role="listbox"
              aria-labelledby="access-invite-role"
              className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg bg-paper-0 py-1 shadow-lg ring-1 ring-ink-900/10"
            >
              {tabs.map((tab) => (
                <li
                  key={tab.key}
                  role="option"
                  aria-selected={audience === tab.key}
                  onClick={() => {
                    setAudience(tab.key);
                    setRoleOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm hover:bg-ink-900/5 ${
                    audience === tab.key ? 'font-semibold text-ink-900' : 'text-ink-700'
                  }`}
                >
                  <span className="block">{tab.label}</span>
                  <span className="block text-[11px] font-normal text-ink-500">{ROLE_HINT[tab.key]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
      <div
          role="tablist"
          aria-label="Who to invite"
          className={`mb-5 grid ${access ? 'grid-cols-3' : 'grid-cols-2'} gap-1 rounded-xl bg-ink-900/5 p-1 ring-1 ring-inset ring-ink-900/10`}
        >
          {tabs.map((tab) => {
            const selected = audience === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setAudience(tab.key)}
                className={`h-8 rounded-lg text-[13px] font-medium transition ${
                  selected
                    ? 'bg-ink-900/10 text-ink-900 shadow-sm ring-1 ring-inset ring-ink-900/10'
                    : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      <div role="tabpanel">
        {audience === 'homeowner' ? (
          <ShareJobProgressPanel jobId={jobId} creating modal onInvited={onInvited} />
        ) : audience === 'subcontractor' ? (
          <InviteCrewPanel key="sub" jobId={jobId} mode="subcontractor" onInvited={onInvited} />
        ) : access ? (
          <InviteCrewPanel key="crew" jobId={jobId} mode="crew" onInvited={onInvited} />
        ) : (
          <InviteCrewPanel jobId={jobId} onInvited={onInvited} />
        )}
      </div>
    </GlassModal>
  );
}
