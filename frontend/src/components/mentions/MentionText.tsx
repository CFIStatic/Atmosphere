import { splitMentionRuns } from '../../lib/mentions';

export function MentionText({ text, onDark = false }: { text: string; onDark?: boolean }) {
  const runs = splitMentionRuns(text);
  return (
    <>
      {runs.map((run, index) =>
        run.kind === 'mention' ? (
          <span
            key={`${run.handle}-${index}`}
            className={onDark ? 'mention-chip mention-chip-on-dark' : 'mention-chip'}
            data-testid="mention-chip"
            data-handle={run.handle}
          >
            @{run.handle}
          </span>
        ) : (
          <span key={`t-${index}`}>{run.text}</span>
        ),
      )}
    </>
  );
}
