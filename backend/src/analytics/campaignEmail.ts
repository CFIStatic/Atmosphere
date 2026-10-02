/**
 * Campaign email rendering: a deliberately small markdown subset.
 *
 * Everything is HTML-escaped first, then a handful of constructs are turned
 * back on: # / ## headings, paragraphs, - bullet lists, **bold**, *italic*,
 * and [text](https://link). Links must be http(s) or mailto; anything else
 * stays as text. No raw HTML, images or scripts can get through.
 *
 * The Atmosphere Analytics builder previews with the same rules
 * (internal/src/lib/campaignMarkdown.ts). Keep the two in step; both have
 * tests on the same fixtures.
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

export interface CampaignEmailInput {
  subject: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  /** CAN-SPAM requires a valid physical postal address in commercial email. */
  postalAddress: string | null;
}

export interface CampaignEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildCampaignEmail(input: CampaignEmailInput): CampaignEmail {
  const unsub = escapeHtml(input.unsubscribeUrl);
  const address = input.postalAddress?.trim() || null;
  const footerText = [
    'You are receiving this because you have an Atmosphere account.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
    address,
  ]
    .filter(Boolean)
    .join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:#0f1b2d;font:15px/1.6 Georgia,'Times New Roman',serif">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
${renderCampaignMarkdown(input.bodyMarkdown)}
<hr style="border:0;border-top:1px solid #d5dae1;margin:32px 0 16px">
<p style="font:12px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#5b6675;margin:0">
You are receiving this because you have an Atmosphere account.
<a href="${unsub}" style="color:#5b6675">Unsubscribe</a>.${address ? `<br>${escapeHtml(address)}` : ''}
</p>
</div></body></html>`;
  return {
    subject: input.subject,
    html,
    text: `${campaignMarkdownToText(input.bodyMarkdown)}\n\n--\n${footerText}\n`,
  };
}

export function unsubscribeUrlFor(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}
