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
