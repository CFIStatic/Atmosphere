import { displayAskWebSources, type AskWebSource } from '../lib/askWebSources';

/** Web results rendered only from the structured Ask field, never from answer markdown. */
export function AskWebResults({ sources }: { sources?: readonly AskWebSource[] | null }) {
  const rows = displayAskWebSources(sources);
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5" data-testid="ask-web-results">
      <p className="text-[13px] font-semibold text-ink-900">Web results</p>
      <ul className="list-disc space-y-1 pl-5 marker:text-ink-500">
        {rows.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2"
            >
              {source.title}
            </a>
            {source.snippet ? <span className="text-ink-700"> — {source.snippet}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
