import { useMemo, useState } from 'react';
import type { EvidenceLogEntry, ProofPeoplePresent, TranscriptSegment } from '../../lib/api';
import { overlaySpeakerDisplayName } from '../../lib/speakerDisplay';
import { EvidenceLog } from './EvidenceLog';
import { VerbatimTranscript } from './VerbatimTranscript';

/**
 * Proof layer — dense timed evidence + exact transcript, collapsed by default.
 * Intelligence stays available; the wall of log is not the default face.
 * Body mounts only when expanded so Glance/Scan stay calm.
 */
export function FullEvidence({
  entries,
  status,
  onSeek,
  activeAtSeconds,
  transcriptSegments,
  transcriptText,
  people,
  defaultOpen = false,
  emptyHint = 'No timed evidence yet. Run Read this video / Hear the mic from Proof of work.',
}: {
  entries: EvidenceLogEntry[];
  status?: 'pending' | 'failed' | null;
  onSeek?: (seconds: number) => void;
  activeAtSeconds?: number | null;
  transcriptSegments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  people?: ProofPeoplePresent | null;
  defaultOpen?: boolean;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const namedEntries = useMemo(
    () => overlaySpeakerDisplayName(entries, people),
    [entries, people],
  );
  const namedSegments = useMemo(
    () => (transcriptSegments ? overlaySpeakerDisplayName(transcriptSegments, people) : transcriptSegments),
    [transcriptSegments, people],
  );
  const hasTranscript = Boolean(
    namedSegments?.length || String(transcriptText || '').trim(),
  );
  const hasLog = namedEntries.length > 0 || status === 'pending' || status === 'failed';

  if (!hasLog && !hasTranscript) {
    return (
      <p className="mt-3 text-[12px] text-ink-500" data-testid="full-evidence-empty">
        {emptyHint}
      </p>
    );
  }

  const countLabel = namedEntries.length
    ? `${namedEntries.length} moment${namedEntries.length === 1 ? '' : 's'}`
    : hasTranscript
      ? 'exact transcript'
      : status === 'pending'
        ? 'reading…'
        : 'log';

  return (
    <details
      className="mt-3 rounded-lg border border-line/80 bg-paper-50/40 px-3 py-2.5"
      data-testid="full-evidence"
      open={open}
      onToggle={(event) => {
        setOpen((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary
        className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-ink-500 [&::-webkit-details-marker]:hidden"
        data-testid="full-evidence-summary"
      >
        <span className="inline-flex flex-wrap items-baseline gap-2">
          <span>Full evidence</span>
          <span className="font-normal normal-case tracking-normal text-ink-400">
            {countLabel} · SCENE / SAID · exact quotes
          </span>
        </span>
      </summary>
      {open ? (
        <div className="mt-3 space-y-3" data-testid="full-evidence-body">
          {hasLog ? (
            <EvidenceLog
              entries={namedEntries}
              status={status}
              onSeek={onSeek}
              activeAtSeconds={activeAtSeconds}
              empty={emptyHint}
            />
          ) : null}
          {hasTranscript ? (
            <VerbatimTranscript
              segments={namedSegments}
              transcriptText={transcriptText}
              onSeek={onSeek}
              activeAtSeconds={activeAtSeconds}
            />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
