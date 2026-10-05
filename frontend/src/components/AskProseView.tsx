import { parseAskProseBlocks, type AskInline, type AskProseBlock } from '../lib/askProse';
import { parseAskQuoteTrailer } from '../lib/askSources';
import { sanitizeSpeakerProse } from '../lib/speakerLabel';
import { MentionText } from './mentions/MentionText';

/**
 * Ask answer markdown (bold, lists, headings) with no raw HTML.
 * Text leaves go through MentionText. Speaker labels are normalized first.
 */
function InlineNodes({ nodes }: { nodes: AskInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === 'text') return <MentionText key={`t-${index}`} text={node.text} />;
        if (node.kind === 'link') {
          return (
            <a
              key={`a-${index}`}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-ink-300 underline-offset-2"
            >
              {node.text}
            </a>
          );
        }
        if (node.kind === 'code') {
          return (
            <code key={`c-${index}`} className="rounded bg-paper-100 px-1 py-px font-mono text-[0.92em] text-ink-900">
              {node.text}
            </code>
          );
        }
        if (node.kind === 'bold') {
          return (
            <strong key={`b-${index}`} className="font-semibold">
              <InlineNodes nodes={node.children} />
            </strong>
          );
        }
        return (
          <em key={`i-${index}`}>
            <InlineNodes nodes={node.children} />
          </em>
        );
      })}
    </>
  );
}

function Block({ block }: { block: AskProseBlock }) {
  if (block.kind === 'heading') {
    const Tag = block.level === 3 ? 'h3' : 'h2';
    return (
      <Tag className="text-[13px] font-semibold text-ink-900">
        <InlineNodes nodes={block.children} />
      </Tag>
    );
  }
  if (block.kind === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag
        className={block.ordered ? 'list-decimal space-y-0.5 pl-4' : 'list-disc space-y-0.5 pl-4'}
      >
        {block.items.map((item, index) => (
          <li key={index}>
            <InlineNodes nodes={item} />
          </li>
        ))}
      </Tag>
    );
  }
  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-paper-100 px-2 py-1.5 font-mono text-[12px] text-ink-900">
        {block.text}
      </pre>
    );
  }
  if (block.kind === 'table') {
    return (
      <div className="space-y-0.5">
        {block.headers.length ? (
          <p className="font-semibold">
            {block.headers.map((cell, index) => (
              <span key={index}>
                {index > 0 ? ' · ' : null}
                <InlineNodes nodes={cell} />
              </span>
            ))}
          </p>
        ) : null}
        {block.rows.map((row, index) => (
          <p key={index}>
            {row.map((cell, cellIndex) => (
              <span key={cellIndex}>
                {cellIndex > 0 ? ' · ' : null}
                <InlineNodes nodes={cell} />
              </span>
            ))}
          </p>
        ))}
      </div>
    );
  }
  return (
    <p>
      <InlineNodes nodes={block.children} />
    </p>
  );
}

export function AskProseView({ text, protect = [] }: { text: string; protect?: string[] }) {
  const titles = [
    ...protect,
    ...parseAskQuoteTrailer(text).flatMap((quote) => (quote.clipTitle ? [quote.clipTitle] : [])),
  ];
  const blocks = parseAskProseBlocks(sanitizeSpeakerProse(text, { protect: titles }));
  if (!blocks.length) return <MentionText text={text} />;
  return (
    <div className="space-y-1.5" data-testid="ask-prose">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
