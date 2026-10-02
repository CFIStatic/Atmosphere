/**
 * Campaign markdown, client copy for the live preview in the builder.
 *
 * Same rules as backend/src/analytics/campaignEmail.ts, which renders what is
 * actually sent: escape everything, then allow # / ## headings, paragraphs,
 * - bullets, **bold**, *italic* and http(s)/mailto links. Keep the two in
 * step; both have tests on the same fixtures.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s]+$/i.test(href)) return href;
  return null;
}

/** Inline formatting on already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
      const safe = safeHref(href.replace(/&amp;/g, '&'));
      return safe ? `<a href="${escapeHtml(safe)}">${text}</a>` : whole;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

export function renderCampaignMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) {
      out.push(`<ul>${list.map((li) => `<li>${inline(escapeHtml(li))}</li>`).join('')}</ul>`);
    }
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,2})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length === 1 ? 'h1' : 'h2';
      out.push(`<${level}>${inline(escapeHtml(heading[2]!.trim()))}</${level}>`);
    } else if (bullet) {
      flushPara();
      list.push(bullet[1]!.trim());
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/** Plain-text alternative: markdown markers removed, links spelled out. */
export function campaignMarkdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,2}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .trim();
}
