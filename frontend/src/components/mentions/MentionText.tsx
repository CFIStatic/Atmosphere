import { splitMentionRuns } from '../../lib/mentions';

export function MentionText({ text, onDark = false }: { text: string; onDark?: boolean }) {
  const runs = splitMentionRuns(text);
  return (
    <>
      {runs.map((run, index) =>
        run.kind === 'mention' ? (
          <span
            key={`${run.userId ?? run.name}-${index}`}
            className={onDark ? 'mention-chip mention-chip-on-dark' : 'mention-chip'}
            data-testid="mention-chip"
            data-user-id={run.userId ?? undefined}
          >
            @{run.name}
          </span>
        ) : (
          <span key={`t-${index}`}>{run.text}</span>
        ),
      )}
    </>
  );
}
