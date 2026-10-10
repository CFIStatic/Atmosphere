import { useState } from 'react';
import { GlassModal } from './GlassModal';
import { CREW_INVITE_INTRO, InviteCrewPanel } from './InviteCrewPanel';
import { HOMEOWNER_SHARE_INTRO, ShareJobProgressPanel } from './ShareJobProgressPanel';

/**
 * The one Share popup for a job file: invite the homeowner to follow
 * progress, or invite a trade or crew to film. Opens on Homeowner.
 */

type Audience = 'homeowner' | 'crew';

const TABS: { key: Audience; label: string }[] = [
  { key: 'homeowner', label: 'Homeowner' },
  { key: 'crew', label: 'Subcontractor or crew' },
];

export function SharePopup({
  jobId,
  onClose,
  initial = 'homeowner',
}: {
  jobId: string;
  onClose: () => void;
  initial?: Audience;
}) {
  const [audience, setAudience] = useState<Audience>(initial);

  return (
    <GlassModal
      title="Share"
      description={audience === 'homeowner' ? HOMEOWNER_SHARE_INTRO : CREW_INVITE_INTRO}
      onClose={onClose}
      testId="share-popup"
    >
      <div
        role="tablist"
        aria-label="Who to invite"
        className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-900/5 p-1 ring-1 ring-inset ring-ink-900/10"
      >
        {TABS.map((tab) => {
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
      <div role="tabpanel">
        {audience === 'homeowner' ? (
          <ShareJobProgressPanel jobId={jobId} creating modal />
        ) : (
          <InviteCrewPanel jobId={jobId} />
        )}
      </div>
    </GlassModal>
  );
}
