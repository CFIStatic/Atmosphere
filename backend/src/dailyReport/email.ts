import { atmosphereWordmarkHtml } from '../lib/brandMark.js';
import { PRIVACY_REDACTED_LABEL } from '../audio/privacyRedactions.js';
import type { DailyJobGlanceReport } from './types.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absoluteUrl(origin: string | null | undefined, path: string): string {
  const base = (origin || '').replace(/\/$/, '');
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function dailyJobReportEmail(input: {
  report: DailyJobGlanceReport;
  origin?: string | null;
}): { subject: string; text: string; html: string } {
  const r = input.report;
  const job = r.jobTitle?.trim() || 'Job';
  const org = r.orgName?.trim() || 'Atmosphere';
  const day = r.localDay;
  const viewLink = absoluteUrl(input.origin, `/jobs/${r.jobId}`);

  const lines: string[] = [
    `${org} — end of day Glance for ${job}`,
    `Day: ${day} (${r.timezone})`,
    '',
    r.overview,
    '',
  ];

  for (const clip of r.clips) {
    const title = clip.title || clip.phase || 'Clip';
    lines.push(`• ${title}`);
    if (clip.headline && clip.headline !== PRIVACY_REDACTED_LABEL) {
      lines.push(`  ${clip.headline}`);
    }
    for (const p of clip.points.slice(0, 4)) {
      lines.push(`  – ${p}`);
    }
    if (clip.people.length) {
      lines.push(`  Who: ${clip.people.join(', ')}`);
    }
    if (clip.privacyProtected) {
      lines.push('  (Privacy-protected segments omitted)');
    }
    lines.push('');
  }

  lines.push(
    'Nobody wrote this — Atmosphere summarized today’s clips automatically.',
    '',
    `Open the job file: ${viewLink}`,
  );

  const clipBlocks = r.clips
    .map((clip) => {
      const title = escapeHtml(clip.title || clip.phase || 'Clip');
      const headline =
        clip.headline && clip.headline !== PRIVACY_REDACTED_LABEL
          ? `<p style="margin:6px 0 0;font-size:14px;color:#3f3a34;">${escapeHtml(clip.headline)}</p>`
          : '';
      const points =
        clip.points.length > 0
          ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#57534e;">${clip.points
              .slice(0, 4)
              .map((p) => `<li>${escapeHtml(p)}</li>`)
              .join('')}</ul>`
          : '';
      const people = clip.people.length
        ? `<p style="margin:6px 0 0;font-size:12px;color:#78716c;">Who: ${escapeHtml(clip.people.join(', '))}</p>`
        : '';
      const privacy = clip.privacyProtected
        ? `<p style="margin:6px 0 0;font-size:11px;color:#a8a29e;">Privacy-protected segments omitted</p>`
        : '';
      return `<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e7e0d4;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#1c1917;">${title}</p>
        ${headline}${points}${people}${privacy}
      </div>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:20px;line-height:1.3;color:#1c1917;">
            Today on ${escapeHtml(job)}
          </h1>
          <p style="margin:8px 0 0;font-size:13px;color:#78716c;">
            ${escapeHtml(day)} · ${escapeHtml(r.timezone)} · from ${escapeHtml(org)}
          </p>
          <p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            ${escapeHtml(r.overview)}
          </p>
          ${clipBlocks}
          <p style="margin:24px 0 0;">
            <a href="${escapeHtml(viewLink)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Open job file
            </a>
          </p>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            Nobody wrote this — Atmosphere summarized today’s clips (Glance). Privacy-protected moments stay redacted.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `Today on ${job}: Glance summary (${day})`,
    text: lines.join('\n'),
    html,
  };
}
