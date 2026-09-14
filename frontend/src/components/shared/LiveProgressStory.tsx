import { useState } from 'react';
import {
  liveStoryHasContent,
  type HomeownerLiveProgressStory,
  type LiveStoryMoment,
} from './jobLiveProgressStory';

/**
 * Calm progressive disclosure of what happened on the job in plain English.
 * Glance headlines by default; Scan detail on expand. Privacy-protected clips
 * never quote private moments.
 */
export function LiveProgressStory({ story }: { story: HomeownerLiveProgressStory }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!liveStoryHasContent(story)) return null;

  return (
    <section
      className="rounded-xl glass-card px-5 py-4 sm:px-6"
      data-testid="homeowner-live-progress-story"
      aria-label="What happened"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">What happened</h3>
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
          Live story · Glance
        </p>
      </div>
      <p
        className="mt-2 text-sm leading-relaxed text-ink-800"
        data-testid="live-story-overview"
      >
        {story.overview}
      </p>

      {story.moments.length > 0 ? (
        <ol className="mt-3 divide-y divide-line rounded-lg border border-line" data-testid="live-story-timeline">
          {story.moments.map((moment) => (
            <MomentRow
              key={moment.id}
              moment={moment}
              open={openId === moment.id}
              onToggle={() => setOpenId((cur) => (cur === moment.id ? null : moment.id))}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function MomentRow({
  moment,
  open,
  onToggle,
}: {
  moment: LiveStoryMoment;
  open: boolean;
  onToggle: () => void;
}) {
  const canExpand =
    moment.scan.length > 0 || moment.people.length > 0 || moment.privacyProtected;

  return (
    <li className="px-3 py-2.5" data-testid={`live-story-moment-${moment.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-500">
            {moment.whenLabel}
            {moment.phase ? ` · ${moment.phase}` : ''}
          </p>
          {moment.glance ? (
            <p className="mt-0.5 text-sm font-medium text-ink-900">{moment.glance}</p>
          ) : moment.privacyProtected ? (
            <p className="mt-0.5 text-sm text-ink-500">Privacy-protected segment omitted</p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-500">Clip on file</p>
          )}
        </div>
        {canExpand ? (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-full bg-paper-200/60 px-2.5 py-0.5 text-[11px] font-semibold text-ink-600 hover:bg-paper-200"
            aria-expanded={open}
            data-testid={`live-story-expand-${moment.id}`}
          >
            {open ? 'Hide Scan' : 'Scan'}
          </button>
        ) : null}
      </div>

      {open && canExpand ? (
        <div className="mt-2 space-y-1.5" data-testid={`live-story-scan-${moment.id}`}>
          {moment.people.length > 0 ? (
            <p className="text-xs text-ink-600">
              <span className="font-semibold text-ink-700">Who: </span>
              {moment.people.join(', ')}
            </p>
          ) : null}
          {moment.scan.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-sm text-ink-700">
              {moment.scan.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
          {moment.privacyProtected ? (
            <p className="text-[11px] text-ink-400">Private intervals were not included.</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
