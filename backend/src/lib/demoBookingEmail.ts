import {
  DEMO_SLOT_MINUTES,
  DEMO_TIME_ZONE,
  type DemoBookingInput,
} from './demoBooking.js';

/**
 * Branded demo-booking mail: the host notification and the visitor
 * confirmation. Table layout + inline styles for Gmail / Outlook, a
 * prefers-color-scheme block for Apple Mail / iOS dark mode, and a header
 * band that is dark in both modes so the hosted logo (dark PNG, not an
 * attachment) never disappears on an inverted background.
 */

export const DEMO_EMAIL_LOGO_URL =
  'https://atmosphereteam.com/assets/email/atmosphere-lockup-dark.png';
const SITE_URL = 'https://atmosphereteam.com';

const INK = '#1C1917';
const INK_SOFT = '#57534E';
const INK_FAINT = '#78716C';
const PAPER = '#FBFAF7';
const CARD = '#FFFFFF';
const LINE = '#E3DED4';
const ACCENT = '#D2500A';
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function validZone(tz: string | null | undefined): string {
  if (!tz) return DEMO_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEMO_TIME_ZONE;
  }
}

/** Short zone label; Chicago reads "CT" (not CDT/CST) to match the site. */
function zoneLabel(start: Date, tz: string): string {
  if (tz === DEMO_TIME_ZONE) return 'CT';
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(start)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

/** "Tue Oct 13, 9:00 AM CT" */
export function slotSubjectLabel(start: Date, tz: string = DEMO_TIME_ZONE): string {
  const zone = validZone(tz);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
    .format(start)
    .replace(',', '');
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(start)
    .replace(/\u202f/g, ' ');
  return `${day}, ${time} ${zoneLabel(start, zone)}`;
}

/** { date: "Tuesday, October 13, 2026", time: "9:00 – 9:30 AM CT" } */
export function slotParts(
  start: Date,
  tz: string = DEMO_TIME_ZONE,
): { date: string; time: string } {
  const zone = validZone(tz);
  const end = new Date(start.getTime() + DEMO_SLOT_MINUTES * 60_000);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(
      d,
    );
  const a = t(start).replace(/\u202f/g, ' ');
  const z = t(end).replace(/\u202f/g, ' ');
  const sameHalf = a.slice(-2) === z.slice(-2);
  return { date, time: `${sameHalf ? a.slice(0, -3) : a} – ${z} ${zoneLabel(start, zone)}` };
}

type Row = { label: string; value: string; href?: string };

function rowsHtml(rows: Row[]): string {
  return rows
    .map(
      (r, i) => `
                <tr>
                  <td class="em-label" valign="top" style="padding:${i === 0 ? '0' : '12px'} 16px 0 0;width:96px;font-family:${MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT};white-space:nowrap;">${esc(r.label)}</td>
                  <td class="em-ink" valign="top" style="padding:${i === 0 ? '0' : '12px'} 0 0;font-size:15px;line-height:1.45;color:${INK};word-break:break-word;">${
                    r.href
                      ? `<a href="${esc(r.href)}" class="em-link" style="color:${ACCENT};text-decoration:none;">${esc(r.value)}</a>`
                      : esc(r.value).replace(/\n/g, '<br />')
                  }</td>
                </tr>`,
    )
    .join('');
}

function layout(input: {
  invite: string;
  title: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  when: { date: string; time: string };
  rows: Row[];
  after: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${esc(input.title)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (max-width: 600px) {
      .em-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .em-h1 { font-size: 24px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .em-body, .em-bg { background: #141311 !important; }
      .em-card { background: #1D1B18 !important; border-color: #2A2825 !important; }
      .em-when { background: #241F1B !important; border-color: #3B3833 !important; border-left-color: #E8590C !important; }
      .em-eyebrow { color: #F26E22 !important; }
      .em-ink, .em-h1 { color: #F1EFEB !important; }
      .em-soft { color: #A09C93 !important; }
      .em-label, .em-faint { color: #807C74 !important; }
      .em-rule { border-color: #2A2825 !important; }
      .em-link { color: #F26E22 !important; }
    }
    [data-ogsc] .em-ink, [data-ogsc] .em-h1 { color: #F1EFEB !important; }
    [data-ogsc] .em-soft { color: #A09C93 !important; }
  </style>
</head>
<body class="em-body" style="margin:0;padding:0;background:${PAPER};font-family:${FONT};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(input.preheader)}</div>
  <table role="presentation" class="em-bg" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAPER};">
    <tr><td align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
      <table role="presentation" class="em-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${CARD};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
        <tr><td bgcolor="${INK}" style="background:${INK};padding:22px 32px;" class="em-pad">
          <a href="${SITE_URL}" style="text-decoration:none;"><img src="${DEMO_EMAIL_LOGO_URL}" width="180" height="28" alt="Atmosphere" style="display:block;width:180px;height:28px;border:0;outline:none;color:#FFFFFF;font-family:${FONT};font-size:20px;font-weight:700;" /></a>
        </td></tr>
        <tr><td bgcolor="${ACCENT}" style="background:${ACCENT};height:3px;line-height:3px;font-size:3px;">&nbsp;</td></tr>
        <tr><td class="em-pad" style="padding:32px 32px 8px;">
          <p class="em-eyebrow" style="margin:0 0 10px;font-family:${MONO};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${ACCENT};">${esc(input.eyebrow)}</p>
          <h1 class="em-h1" style="margin:0;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${INK};">${esc(input.heading)}</h1>
          <p class="em-soft" style="margin:12px 0 0;font-size:15px;line-height:1.55;color:${INK_SOFT};">${input.intro}</p>
        </td></tr>
        <tr><td class="em-pad" style="padding:20px 32px 0;">
          <table role="presentation" class="em-when" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF7F1;border:1px solid #F3D9C6;border-left:4px solid ${ACCENT};border-radius:12px;">
            <tr><td style="padding:16px 18px;">
              <p class="em-ink" style="margin:0;font-size:17px;font-weight:700;line-height:1.35;color:${INK};">${esc(input.when.date)}</p>
              <p class="em-soft" style="margin:4px 0 0;font-size:15px;line-height:1.4;color:${INK_SOFT};">${esc(input.when.time)} &middot; ${DEMO_SLOT_MINUTES} min</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td class="em-pad" style="padding:16px 32px 0;">
          <p class="em-ink" style="margin:0;font-size:15px;line-height:1.55;color:${INK};">${esc(input.invite)}</p>
        </td></tr>
        <tr><td class="em-pad" style="padding:22px 32px 4px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rowsHtml(input.rows)}
          </table>
        </td></tr>
        <tr><td class="em-pad" style="padding:20px 32px 30px;">
          <div class="em-rule em-soft" style="border-top:1px solid ${LINE};padding-top:18px;font-size:14px;line-height:1.6;color:${INK_SOFT};" >${input.after}</div>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
        <tr><td class="em-faint" style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${INK_FAINT};text-align:center;">
          <strong class="em-soft" style="color:${INK_SOFT};">Atmosphere</strong> &middot; Intelligence for contractors &middot;
          <a href="${SITE_URL}" class="em-link" style="color:${INK_FAINT};text-decoration:underline;">atmosphereteam.com</a><br />
          You're receiving this because a demo was booked at atmosphereteam.com/demo.<br />
          &copy; ${new Date().getFullYear()} Atmosphere. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctLabel(start: Date): string {
  const p = slotParts(start, DEMO_TIME_ZONE);
  return `${p.date}, ${p.time}`;
}
export function guestInviteLine(start: Date, hostName: string): string {
  return `Your Google Calendar invite with the video link for ${ctLabel(start)} is on its way from ${hostName}.`;
}
export function hostInviteLine(start: Date, guestName: string): string {
  return `A Google Calendar invite with the video link for ${ctLabel(start)} is going out to ${guestName} from your calendar.`;
}

const TEXT_FOOTER = [
  '—',
  'Atmosphere · Intelligence for contractors',
  'https://atmosphereteam.com',
  `© ${new Date().getFullYear()} Atmosphere. All rights reserved.`,
];

export function demoHostEmail(
  b: DemoBookingInput,
  start: Date,
): { subject: string; text: string; html: string } {
  const ct = slotParts(start, DEMO_TIME_ZONE);
  const guestZone = b.timeZone ? validZone(b.timeZone) : null;
  const theirs = guestZone && guestZone !== DEMO_TIME_ZONE ? slotParts(start, guestZone) : null;
  const subject = `New demo booked: ${b.name}, ${slotSubjectLabel(start)}`;
  const rows: Row[] = [
    { label: 'Name', value: b.name },
    { label: 'Email', value: b.email, href: `mailto:${b.email}` },
    { label: 'Company', value: b.company },
    ...(b.phone
      ? [{ label: 'Phone', value: b.phone, href: `tel:${b.phone.replace(/[^0-9+]/g, '')}` }]
      : []),
    ...(theirs ? [{ label: 'Their time', value: `${theirs.time} (${guestZone})` }] : []),
    ...(b.notes ? [{ label: 'Notes', value: b.notes }] : []),
  ];
  const invite = hostInviteLine(start, b.name);
  const html = layout({
    invite,
    title: subject,
    preheader: `${b.name} from ${b.company} booked ${slotSubjectLabel(start)}.`,
    eyebrow: 'New demo booked',
    heading: `${b.name} booked a demo`,
    intro: `${esc(b.company)} picked a time on atmosphereteam.com/demo.`,
    when: ct,
    rows,
    after: `Reply to this email to reach ${esc(b.name.split(/\s+/)[0] || b.name)} directly.`,
  });
  const text = [
    `New demo booked: ${b.name} (${b.company})`,
    '',
    `When:     ${ct.date}, ${ct.time} (${DEMO_SLOT_MINUTES} min)`,
    `Name:     ${b.name}`,
    `Email:    ${b.email}`,
    `Company:  ${b.company}`,
    b.phone ? `Phone:    ${b.phone}` : null,
    theirs ? `Their time: ${theirs.time} (${guestZone})` : null,
    b.notes ? `Notes:    ${b.notes}` : null,
    '',
    invite,
    '',
    'Reply to this email to reach them.',
    '',
    ...TEXT_FOOTER,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
  return { subject, text, html };
}

export function demoGuestEmail(
  b: DemoBookingInput,
  start: Date,
  hostName: string,
): { subject: string; text: string; html: string } {
  const zone = validZone(b.timeZone || DEMO_TIME_ZONE);
  const when = slotParts(start, zone);
  const first = b.name.split(/\s+/)[0] || b.name;
  const subject = `Your Atmosphere demo is confirmed: ${slotSubjectLabel(start, zone)}`;
  const rows: Row[] = [
    { label: 'With', value: `${hostName}, Founder` },
    { label: 'Length', value: `${DEMO_SLOT_MINUTES} minutes` },
    { label: 'Booked for', value: `${b.name} · ${b.company}` },
    { label: 'Email', value: b.email },
  ];
  const invite = guestInviteLine(start, hostName);
  const html = layout({
    invite,
    title: subject,
    preheader: `You're booked for ${slotSubjectLabel(start, zone)}. Your calendar invite is on its way.`,
    eyebrow: 'Demo confirmed',
    heading: `You're booked, ${first}`,
    intro: `Thanks for booking time with Atmosphere. ${esc(hostName)} will walk you through what Atmosphere would do on the jobs you run.`,
    when,
    rows,
    after: `<strong class="em-ink" style="color:${INK};">Need to reschedule or have a question?</strong> Just reply to this email and it goes straight to ${esc(hostName.split(/\s+/)[0] || hostName)}.`,
  });
  const text = [
    `Hi ${first},`,
    '',
    `Your Atmosphere demo is confirmed.`,
    '',
    `When:   ${when.date}, ${when.time} (${DEMO_SLOT_MINUTES} min)`,
    `With:   ${hostName}, Founder`,
    '',
    invite,
    '',
    'Need to reschedule or have a question? Just reply to this email.',
    '',
    ...TEXT_FOOTER,
  ].join('\n');
  return { subject, text, html };
}
