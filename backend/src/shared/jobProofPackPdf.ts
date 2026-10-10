/**
 * Render a job file report as a printable PDF (insurer / GC / homeowner).
 *
 * Order: job details, summary, an index of every file, work days, open items,
 * then each file in full (metadata, AI summary, analysis, key frames,
 * transcript, custody record), the job timeline, and who has access.
 */

import PDFDocument from 'pdfkit';
import { ATMOSPHERE_ACCENT_BAR, ATMOSPHERE_INK, ATMOSPHERE_MARK_BARS } from '../lib/brandMark.js';
import {
  formatProofPackClock,
  type JobProofPack,
  type ProofPackClip,
} from './jobProofPack.js';

const MARGIN = 48;
const PAGE_WIDTH = 612; // US Letter
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LABEL_WIDTH = 112;

const MUTED = '#57534E';
const FAINT = '#78716C';
const BODY = '#292524';
const RULE = '#E7E5E4';

export type ReportRenderOptions = {
  /** IANA time zone for printed times (the requester's). Falls back to UTC. */
  timeZone?: string | null;
};

/** A valid IANA zone, or null. */
export function safeTimeZone(zone: string | null | undefined): string | null {
  const z = String(zone ?? '').trim();
  if (!z || z.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

/** "Oct 8, 2026, 7:12 PM EDT" — the report's one way of printing a moment. */
export function formatReportTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone) ?? 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/** "Oct 8, 2026" for a moment, in the requester's zone. */
export function formatReportDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone) ?? 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** "Oct 8, 2026" for a YYYY-MM-DD work date. */
export function formatWorkDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!m) return String(date ?? '—');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** "2 min 22 sec", "53 sec", "1 hr 4 min". */
export function formatLength(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const n = Math.max(0, Math.round(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h} hr ${m} min`;
  if (m) return s ? `${m} min ${s} sec` : `${m} min`;
  return `${s} sec`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** An enum word ("before", "after", "punch_list") as a customer reads it in the proof pack. */
export function phaseLabel(phase: string | null | undefined): string {
  const word = String(phase ?? '').trim().toLowerCase();
  if (word === 'before') return 'Before';
  if (word === 'after') return 'After';
  return word ? word[0].toUpperCase() + word.slice(1).replace(/_/g, ' ') : '';
}

/** A work day's review decision in customer words. */
export function decisionLabel(decision: string | null | undefined): string {
  if (decision === 'accepted') return 'Accepted';
  if (decision === 'rejected') return 'Rejected';
  return 'Not reviewed';
}

function checkVerdictLabel(verdict: string): string {
  if (verdict === 'pass') return 'Passed';
  if (verdict === 'fail') return 'Failed';
  return 'Could not tell';
}

function checkName(key: string): string {
  const k = key.replace(/_/g, ' ').trim();
  return k ? k[0]!.toUpperCase() + k.slice(1) : 'Check';
}

function accessStateLabel(state: string): string {
  if (state === 'revoked') return 'Removed';
  if (state === 'expired') return 'Expired';
  if (state === 'claimed') return 'Active (account)';
  return 'Active';
}

export function clipDisplayTitle(clip: ProofPackClip): string {
  return clip.file.title ?? `${phaseLabel(clip.phase) || 'Video'} clip, ${formatWorkDate(clip.workDate)}`;
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  if (doc.y + need > doc.page.height - MARGIN) {
    doc.addPage();
  }
}

function rule(doc: PDFKit.PDFDocument, gapAfter = 0.8) {
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(gapAfter);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, opts: { newPage?: boolean } = {}) {
  if (opts.newPage) doc.addPage();
  else ensureSpace(doc, 48);
  doc.x = MARGIN;
  doc.fillColor(ATMOSPHERE_ACCENT_BAR).rect(MARGIN, doc.y + 3, 3, 11).fill();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ATMOSPHERE_INK).text(title, MARGIN + 10, doc.y);
  doc.x = MARGIN;
  doc.moveDown(0.4);
}

function subTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 30);
  doc.moveDown(0.25);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text(title, MARGIN, doc.y);
  doc.moveDown(0.2);
}

function emptyLine(doc: PDFKit.PDFDocument, text: string) {
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(FAINT).text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.4);
}

function bulletList(doc: PDFKit.PDFDocument, items: string[], empty = 'None on file.') {
  if (!items.length) {
    emptyLine(doc, empty);
    return;
  }
  for (const item of items) {
    ensureSpace(doc, 24);
    doc.font('Helvetica').fontSize(9).fillColor(BODY).text(`•  ${item}`, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.35);
}

/** Label / value rows, label column on the left. */
function keyValues(doc: PDFKit.PDFDocument, rows: Array<[string, string | null | undefined]>) {
  for (const [label, raw] of rows) {
    const value = raw == null || raw === '' ? '—' : raw;
    const valueWidth = CONTENT_WIDTH - LABEL_WIDTH;
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(doc.heightOfString(value, { width: valueWidth }), 11);
    ensureSpace(doc, h + 4);
    const y = doc.y;
    doc.fillColor(FAINT).text(label, MARGIN, y, { width: LABEL_WIDTH - 8 });
    doc.fillColor(BODY).text(value, MARGIN + LABEL_WIDTH, y, { width: valueWidth });
    doc.y = y + h + 3;
  }
  doc.x = MARGIN;
}

type Column = { header: string; width: number };

/** A simple ruled table. Rows wrap; the header repeats on a new page. */
function table(doc: PDFKit.PDFDocument, columns: Column[], rows: string[][]) {
  const pad = 4;
  const drawHeader = () => {
    const y = doc.y;
    doc.fillColor('#F5F5F4').rect(MARGIN, y, CONTENT_WIDTH, 16).fill();
    let x = MARGIN;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    for (const col of columns) {
      doc.text(col.header.toUpperCase(), x + pad, y + 5, { width: col.width - pad * 2, lineBreak: false });
      x += col.width;
    }
    doc.y = y + 18;
  };
  ensureSpace(doc, 40);
  drawHeader();
  for (const row of rows) {
    doc.font('Helvetica').fontSize(8);
    const h =
      Math.max(
        ...row.map((cell, i) => doc.heightOfString(cell || '—', { width: columns[i]!.width - pad * 2 })),
        10,
      ) + pad * 2;
    if (doc.y + h > doc.page.height - MARGIN) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let x = MARGIN;
    row.forEach((cell, i) => {
      doc
        .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(i === 0 ? ATMOSPHERE_INK : BODY)
        .text(cell || '—', x + pad, y + pad, { width: columns[i]!.width - pad * 2 });
      x += columns[i]!.width;
    });
    doc.y = y + h;
    doc
      .strokeColor(RULE)
      .lineWidth(0.5)
      .moveTo(MARGIN, doc.y)
      .lineTo(PAGE_WIDTH - MARGIN, doc.y)
      .stroke();
  }
  doc.x = MARGIN;
  doc.moveDown(0.8);
}

function drawMark(doc: PDFKit.PDFDocument, x: number, y: number) {
  ATMOSPHERE_MARK_BARS.forEach((color, i) => {
    doc.fillColor(color).rect(x, y + i * 5, 22, 3).fill();
  });
}

function drawCover(doc: PDFKit.PDFDocument, pack: JobProofPack, tz: string | null) {
  drawMark(doc, MARGIN, MARGIN);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(ATMOSPHERE_INK)
    .text('Atmosphere', MARGIN + 32, MARGIN + 1);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Job file report', MARGIN + 32, MARGIN + 19);

  doc.y = MARGIN + 52;
  doc.x = MARGIN;
  const title = [pack.job.number != null ? `Job #${pack.job.number}` : null, pack.job.name]
    .filter(Boolean)
    .join(' · ');
  doc.font('Helvetica-Bold').fontSize(20).fillColor(ATMOSPHERE_INK).text(title || 'Job file', {
    width: CONTENT_WIDTH,
  });
  if (pack.job.address) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(pack.job.address, { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.8);
  rule(doc, 0.6);

  const transcriptLines = pack.clips.reduce((n, c) => n + c.transcript.length, 0);
  const totalSeconds = pack.clips.reduce((n, c) => n + (c.file.durationSeconds ?? 0), 0);
  sectionTitle(doc, 'Job details');
  keyValues(doc, [
    ['Job number', pack.job.number != null ? String(pack.job.number) : null],
    ['Job name', pack.job.name],
    ['Property', pack.job.address],
    ['Claim number', pack.job.claimNumber],
    ['Work type', pack.job.workType ? phaseLabel(pack.job.workType) : null],
    ['Covers', pack.workDateFilter ? `Work date ${formatWorkDate(pack.workDateFilter)} only` : 'The whole job file'],
    [
      'In this report',
      [
        `${pack.clips.length} file${pack.clips.length === 1 ? '' : 's'}`,
        totalSeconds ? `${formatLength(totalSeconds)} of video` : null,
        `${pack.days.length} work day${pack.days.length === 1 ? '' : 's'}`,
        `${transcriptLines} transcript line${transcriptLines === 1 ? '' : 's'}`,
        pack.access ? `${pack.access.length} ${pack.access.length === 1 ? 'person' : 'people'} with access` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ['Generated', formatReportTime(pack.exportedAt, tz)],
    ['Generated by', pack.exportedBy],
  ]);
  doc.moveDown(0.6);
}

function drawFileIndex(doc: PDFKit.PDFDocument, pack: JobProofPack, tz: string | null) {
  sectionTitle(doc, 'Files on this job');
  if (!pack.clips.length) {
    emptyLine(doc, 'No files on this job (or date filter).');
    return;
  }
  table(
    doc,
    [
      { header: '#', width: 22 },
      { header: 'File', width: 168 },
      { header: 'Filmed', width: 98 },
      { header: 'Length', width: 60 },
      { header: 'Filed by', width: 90 },
      { header: 'Status', width: CONTENT_WIDTH - 22 - 168 - 98 - 60 - 90 },
    ],
    pack.clips.map((clip, i) => [
      String(i + 1),
      `${clipDisplayTitle(clip)}${clip.file.category ? `\n${phaseLabel(clip.file.category)}` : ''}`,
      clip.file.capturedAt ? formatReportTime(clip.file.capturedAt, tz) : formatWorkDate(clip.workDate),
      formatLength(clip.file.durationSeconds),
      clip.file.filedBy ?? clip.company,
      [clip.file.processing, clip.file.review].filter(Boolean).join('\n'),
    ]),
  );
}

function drawClip(doc: PDFKit.PDFDocument, clip: ProofPackClip, index: number, tz: string | null) {
  ensureSpace(doc, 120);
  doc.moveDown(0.3);
  rule(doc, 0.5);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(ATMOSPHERE_INK)
    .text(`${index + 1}. ${clipDisplayTitle(clip)}`, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      [formatWorkDate(clip.workDate), clip.company, phaseLabel(clip.file.category ?? clip.phase)]
        .filter(Boolean)
        .join(' · '),
    );
  doc.moveDown(0.3);

  if (clip.summary) {
    subTitle(doc, 'AI summary');
    doc.font('Helvetica').fontSize(9).fillColor(BODY).text(clip.summary, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
  }

  subTitle(doc, 'File details');
  const f = clip.file;
  keyValues(doc, [
    ['Filed by', f.filedBy],
    ['Trade', f.trade ? phaseLabel(f.trade) : null],
    ['Category', f.category ? phaseLabel(f.category) : null],
    ['Tags', f.tags.length ? f.tags.join(', ') : null],
    ['Filmed', formatReportTime(f.capturedAt, tz)],
    ['Received', formatReportTime(f.receivedAt, tz)],
    ['Length', formatLength(f.durationSeconds)],
    ['File size', formatBytes(f.byteSize)],
    ['Location', f.hasLocation ? 'Recorded with GPS' : 'No GPS on file'],
    ['Device', f.device],
    ['Processing', f.processing],
    ['Review', f.review],
    ...(f.viewCount != null
      ? ([
          [
            'Opened',
            `${f.viewCount} time${f.viewCount === 1 ? '' : 's'}${
              f.lastViewedAt ? `, last ${formatReportTime(f.lastViewedAt, tz)}` : ''
            }`,
          ],
        ] as Array<[string, string]>)
      : []),
    ['Hold', f.legalHold ? 'On hold (kept past retention)' : 'Not on hold'],
    ['Kept until', f.retentionUntil ? formatReportDate(f.retentionUntil, tz) : null],
    ['SHA-256 digest', f.contentHash],
    ['File ID', clip.id],
  ]);

  if (clip.people.length) {
    subTitle(doc, 'People');
    doc.font('Helvetica').fontSize(8.5).fillColor(BODY).text(clip.people.join(', '), MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
    doc.moveDown(0.3);
  }

  const a = clip.analysis;
  if (a.checks.length || a.rooms.length || a.events.length) {
    subTitle(doc, 'Analysis');
    if (a.checks.length) {
      for (const c of a.checks) {
        ensureSpace(doc, 14);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(c.verdict === 'fail' ? '#B91C1C' : BODY)
          .text(`${checkName(c.key)}: ${checkVerdictLabel(c.verdict)}${c.detail ? `. ${c.detail}` : ''}`, MARGIN, doc.y, {
            width: CONTENT_WIDTH,
          });
      }
      doc.moveDown(0.25);
    }
    for (const room of a.rooms) {
      ensureSpace(doc, 20);
      const span =
        room.startSeconds != null
          ? ` [${formatProofPackClock(room.startSeconds)}${
              room.endSeconds != null ? `–${formatProofPackClock(room.endSeconds)}` : ''
            }]`
          : '';
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ATMOSPHERE_INK).text(`${room.name}${span}`, MARGIN, doc.y);
      for (const finding of room.findings) {
        ensureSpace(doc, 12);
        const at = finding.atSeconds != null ? `[${formatProofPackClock(finding.atSeconds)}] ` : '';
        doc.font('Helvetica').fontSize(8).fillColor(BODY).text(`•  ${at}${finding.text}`, MARGIN + 8, doc.y, {
          width: CONTENT_WIDTH - 8,
        });
      }
      doc.moveDown(0.15);
    }
    if (a.events.length) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ATMOSPHERE_INK).text('What the video shows', MARGIN, doc.y);
      for (const e of a.events) {
        ensureSpace(doc, 12);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(BODY)
          .text(`[${formatProofPackClock(e.atSeconds)}] ${e.text}`, MARGIN + 8, doc.y, { width: CONTENT_WIDTH - 8 });
      }
      doc.moveDown(0.2);
    }
  }

  const timed = (items: typeof clip.decisions) =>
    items.map((d) => `${d.tSec != null ? `[${formatProofPackClock(d.tSec)}] ` : ''}${d.text}`);
  if (clip.decisions.length) {
    subTitle(doc, 'Decisions');
    bulletList(doc, timed(clip.decisions));
  }
  if (clip.nextSteps.length) {
    subTitle(doc, 'Next steps');
    bulletList(doc, timed(clip.nextSteps));
  }

  const framed = clip.frames.filter((fr) => fr.jpeg && fr.jpeg.length > 0);
  if (framed.length) {
    // Keep the heading with the first row of stills.
    ensureSpace(doc, 175);
    subTitle(doc, 'Key frames');
    const gap = 10;
    const cellW = (CONTENT_WIDTH - gap) / 2;
    const cellH = 130;
    let col = 0;
    let rowY = doc.y;
    for (const frame of framed.slice(0, 4)) {
      if (col === 0) {
        ensureSpace(doc, cellH + 16);
        rowY = doc.y;
      }
      const x = MARGIN + col * (cellW + gap);
      try {
        doc.image(frame.jpeg!, x, rowY, { fit: [cellW, cellH - 14], align: 'center', valign: 'center' });
      } catch {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#A8A29E')
          .text('(frame unavailable)', x, rowY + 40, { width: cellW, align: 'center' });
      }
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(FAINT)
        .text(`At ${formatProofPackClock(frame.atSeconds)}`, x, rowY + cellH - 12, { width: cellW });
      col += 1;
      if (col >= 2) {
        col = 0;
        doc.y = rowY + cellH + 6;
      }
    }
    if (col !== 0) doc.y = rowY + cellH + 6;
    doc.x = MARGIN;
  } else if (clip.privacyRangesRedacted > 0) {
    doc
      .moveDown(0.2)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(FAINT)
      .text('Key frames omitted where privacy redaction applies, or no stills on file.', MARGIN, doc.y);
  }

  subTitle(doc, 'Transcript');
  if (!clip.transcript.length) {
    emptyLine(doc, 'No speech transcribed for this file.');
  } else {
    const clockW = 40;
    for (const line of clip.transcript) {
      const body = line.speaker ? `${line.speaker}: ${line.text}` : line.text;
      doc.font('Helvetica').fontSize(8);
      const h = doc.heightOfString(body, { width: CONTENT_WIDTH - clockW });
      ensureSpace(doc, h + 3);
      const y = doc.y;
      doc.fillColor(FAINT).text(formatProofPackClock(line.tSec), MARGIN, y, { width: clockW - 6 });
      if (line.speaker) {
        doc
          .font('Helvetica-Bold')
          .fillColor(ATMOSPHERE_INK)
          .text(`${line.speaker}: `, MARGIN + clockW, y, { width: CONTENT_WIDTH - clockW, continued: true })
          .font('Helvetica')
          .fillColor(BODY)
          .text(line.text);
      } else {
        doc
          .font(line.text === 'Private moment redacted' ? 'Helvetica-Oblique' : 'Helvetica')
          .fillColor(line.text === 'Private moment redacted' ? FAINT : BODY)
          .text(line.text, MARGIN + clockW, y, { width: CONTENT_WIDTH - clockW });
      }
      doc.y = Math.max(doc.y, y + h) + 2;
    }
    doc.x = MARGIN;
    doc.moveDown(0.2);
  }

  if (clip.custody) {
    subTitle(doc, 'Custody record');
    if (!clip.custody.length) {
      emptyLine(doc, 'No custody entries recorded for this file.');
    } else {
      table(
        doc,
        [
          { header: 'When', width: 130 },
          { header: 'What', width: 110 },
          { header: 'Who', width: 130 },
          { header: 'Detail', width: CONTENT_WIDTH - 370 },
        ],
        clip.custody.map((c) => [
          formatReportTime(c.at, tz),
          c.action,
          [c.actor, c.role ? phaseLabel(c.role) : null].filter(Boolean).join(' · '),
          c.detail ?? '',
        ]),
      );
    }
  }
  doc.moveDown(0.4);
}

function addPageFooters(doc: PDFKit.PDFDocument, pack: JobProofPack) {
  const range = doc.bufferedPageRange();
  const fullLabel = [pack.job.number != null ? `Job #${pack.job.number}` : null, pack.job.name]
    .filter(Boolean)
    .join(' · ');
  const jobLabel = fullLabel.length > 48 ? `${fullLabel.slice(0, 47).trimEnd()}…` : fullLabel;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 34;
    // Writing below the bottom margin would otherwise add a page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#A8A29E')
      .text(`Atmosphere job file report${jobLabel ? ` · ${jobLabel}` : ''}`, MARGIN, y, {
        width: (CONTENT_WIDTH * 3) / 4,
        lineBreak: false,
      })
      .text(`Page ${i + 1} of ${range.count}`, MARGIN + (CONTENT_WIDTH * 3) / 4, y, {
        width: CONTENT_WIDTH / 4,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}

/** Build a PDF Buffer from a job file report (frames may include jpeg buffers). */
export async function renderJobProofPackPdf(
  pack: JobProofPack,
  options: ReportRenderOptions = {},
): Promise<Buffer> {
  const tz = safeTimeZone(options.timeZone);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: pack.job.name ? `Job file report — ${pack.job.name}` : 'Atmosphere job file report',
        Author: 'Atmosphere',
        Subject: 'Job file report',
        CreationDate: new Date(pack.exportedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCover(doc, pack, tz);

    sectionTitle(doc, 'Summary');
    subTitle(doc, 'What happened');
    bulletList(doc, pack.overview.whatHappened, 'No filmed summary on file yet.');
    subTitle(doc, 'Who was there');
    bulletList(doc, pack.overview.who, 'No people identified on file yet.');
    subTitle(doc, 'Decisions');
    bulletList(doc, pack.overview.decisions, 'No decisions recorded yet.');
    subTitle(doc, 'Next steps');
    bulletList(doc, pack.overview.nextSteps, 'No open next steps on file.');

    drawFileIndex(doc, pack, tz);

    if (pack.days.length) {
      sectionTitle(doc, 'Work days');
      for (const day of pack.days) {
        ensureSpace(doc, 40);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(ATMOSPHERE_INK)
          .text(`${formatWorkDate(day.workDate)} · ${day.company} · ${decisionLabel(day.decision)}`, MARGIN, doc.y);
        const line = day.aiSummary ?? day.summary;
        if (line) {
          doc.font('Helvetica').fontSize(8.5).fillColor(BODY).text(line, { width: CONTENT_WIDTH });
        }
        const pay = day.payable ? 'Payable' : 'Not payable yet';
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(FAINT)
          .text(`${pay}${day.payableBecause ? `: ${day.payableBecause}` : ''}`, { width: CONTENT_WIDTH });
        if (day.concerns.length) {
          doc.text(`Concerns: ${day.concerns.join('; ')}`, { width: CONTENT_WIDTH });
        }
        doc.moveDown(0.4);
      }
    }

    if (pack.punchList.length) {
      sectionTitle(doc, 'Open items');
      for (const item of pack.punchList) {
        ensureSpace(doc, 32);
        const clock = item.seekSeconds != null ? `[${formatProofPackClock(item.seekSeconds)}] ` : '';
        const meta = [item.workDate ? formatWorkDate(item.workDate) : null, item.company, item.ownerLabel, phaseLabel(item.source)]
          .filter(Boolean)
          .join(' · ');
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text(`${clock}${item.text}`, MARGIN, doc.y, {
          width: CONTENT_WIDTH,
        });
        if (meta) doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(meta);
        if (item.detail) {
          doc.font('Helvetica').fontSize(8).fillColor(BODY).text(item.detail, { width: CONTENT_WIDTH });
        }
        doc.moveDown(0.25);
      }
    }

    if (pack.disputes.length) {
      sectionTitle(doc, 'Disputes and integrity');
      for (const d of pack.disputes) {
        ensureSpace(doc, 32);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text(`${d.title} (${d.severity})`, MARGIN, doc.y);
        if (d.detail) {
          doc.font('Helvetica').fontSize(8).fillColor(BODY).text(d.detail, { width: CONTENT_WIDTH });
        }
        doc.moveDown(0.25);
      }
    }

    if (pack.clips.length) {
      sectionTitle(doc, 'Every file in full', { newPage: true });
      pack.clips.forEach((clip, i) => drawClip(doc, clip, i, tz));
    }

    sectionTitle(doc, 'Timeline', { newPage: true });
    if (!pack.timeline.length) {
      emptyLine(doc, 'Nothing on the timeline yet.');
    } else {
      table(
        doc,
        [
          { header: 'When', width: 130 },
          { header: 'What happened', width: CONTENT_WIDTH - 130 - 130 },
          { header: 'Who', width: 130 },
        ],
        pack.timeline.map((t) => [formatReportTime(t.at, tz), t.text, t.actor ?? '']),
      );
    }

    if (pack.access) {
      sectionTitle(doc, 'People with access');
      if (!pack.access.length) {
        emptyLine(doc, 'Nobody outside the office has access to this job.');
      } else {
        table(
          doc,
          [
            { header: 'Person', width: 130 },
            { header: 'Access', width: 100 },
            { header: 'Status', width: 70 },
            { header: 'Given by', width: 100 },
            { header: 'Last opened', width: CONTENT_WIDTH - 400 },
          ],
          pack.access.map((p) => [
            p.name,
            p.accessType,
            accessStateLabel(p.state),
            [p.grantedBy, p.grantedAt ? formatReportTime(p.grantedAt, tz) : null].filter(Boolean).join('\n'),
            p.lastAccessedAt ? formatReportTime(p.lastAccessedAt, tz) : 'Never',
          ]),
        );
      }
    }

    ensureSpace(doc, 40);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(pack.privacyNotice, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#A8A29E')
      .text(
        'Generated by Atmosphere from the job file. Each file’s SHA-256 digest can be compared against a copy of the original to show it has not changed.',
        { width: CONTENT_WIDTH },
      );

    addPageFooters(doc, pack);
    doc.end();
  });
}

export function proofPackFilename(pack: JobProofPack): string {
  const num = pack.job.number != null ? String(pack.job.number) : pack.job.id.slice(0, 8);
  const date = pack.workDateFilter ? `-${pack.workDateFilter}` : '';
  return `atmosphere-job-${num}-report${date}.pdf`;
}
