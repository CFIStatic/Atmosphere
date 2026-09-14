import type { EvidenceLogEntry, ProofConversation, ProofPeoplePresent, TranscriptSegment } from '../../lib/api';
import { ConversationPanel, conversationHasTalk } from './ConversationPanel';
import { PeoplePresentPanel } from './PeoplePresent';
import { FullEvidence } from './FullEvidence';

function hasPeople(people: ProofPeoplePresent | null | undefined): boolean {
  return Boolean(people?.peoplePresent?.length);
}

/**
 * Progressive Analysis for one clip: Glance → Scan → Full evidence (proof).
 * Keeps all intelligence; hides the dense log until expanded.
 */
export function ClipAnalysisLayers({
  conversation,
  people,
  evidenceEntries,
  evidenceStatus = null,
  onSeek,
  activeAtSeconds,
  phaseLabel,
  defaultEvidenceOpen = false,
}: {
  conversation?: ProofConversation | null;
  people?: ProofPeoplePresent | null;
  evidenceEntries: EvidenceLogEntry[];
  evidenceStatus?: 'pending' | 'failed' | null;
  onSeek?: (seconds: number) => void;
  activeAtSeconds?: number | null;
  phaseLabel?: string | null;
  defaultEvidenceOpen?: boolean;
}) {
  const talk = conversationHasTalk(conversation);
  const present = hasPeople(people);
  const hasProof =
    evidenceEntries.length > 0 ||
    evidenceStatus === 'pending' ||
    evidenceStatus === 'failed' ||
    Boolean(conversation?.transcriptSegments?.length) ||
    Boolean(conversation?.transcriptText?.trim());

  if (!talk && !present && !hasProof) {
    return (
      <p className="mt-2 text-[12px] text-ink-500" data-testid="clip-analysis-empty">
        Nothing to show yet. From Proof of work, run Read this video and Hear the mic —
        then Glance, Scan, and Full evidence fill in here.
      </p>
    );
  }

  const segments: TranscriptSegment[] | null | undefined =
    conversation?.transcriptSegments ?? null;
  const transcriptText = conversation?.transcriptText ?? null;

  return (
    <div className="space-y-1" data-testid="clip-analysis-layers">
      {phaseLabel ? (
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
          {phaseLabel}
        </p>
      ) : null}
      {talk ? <ConversationPanel conversation={conversation} onSeek={onSeek} /> : null}
      {present ? (
        <div data-testid="analysis-scan-people">
          <PeoplePresentPanel people={people} onSeek={onSeek} />
        </div>
      ) : null}
      <FullEvidence
        entries={evidenceEntries}
        status={evidenceStatus}
        onSeek={onSeek}
        activeAtSeconds={activeAtSeconds}
        transcriptSegments={segments}
        transcriptText={transcriptText}
        defaultOpen={defaultEvidenceOpen}
      />
    </div>
  );
}
