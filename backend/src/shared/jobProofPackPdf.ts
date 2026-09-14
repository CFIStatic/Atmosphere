/**
 * Render a job proof pack as a printable PDF (insurer / GC / homeowner).
 */

import PDFDocument from 'pdfkit';
import { ATMOSPHERE_ACCENT_BAR, ATMOSPHERE_INK } from '../lib/brandMark.js';
import {
  formatProofPackClock,
  type JobProofPack,
  type ProofPackClip,
} from './jobProofPack.js';

const MARGIN = 48;
const PAGE_WIDTH = 612; // US Letter
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawHeader(doc: PDFKit.PDFDocument, pack: JobProofPack) {
  doc
    .fillColor(ATMOSPHERE_ACCENT_BAR)
    .rect(MARGIN, MARGIN, 28, 4)
    .fill();
  doc
    .fillColor(ATMOSPHERE_INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Atmosphere', MARGIN + 36, MARGIN - 2, { continued: false });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#57534E')
    .text('Job proof pack / report', MARGIN + 36, MARGIN + 16);

  const jobLine = [
    pack.job.number != null ? `Job #${pack.job.number}` : null,
    pack.job.name,
  ]
    .filter(Boolean)
    .join(' · ');
  doc.moveDown(1.4);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(ATMOSPHERE_INK).text(jobLine || 'Job file');
  const meta = [
    pack.job.address,
    pack.job.claimNumber ? `Claim ${pack.job.claimNumber}` : null,
    pack.job.workType,
    pack.workDateFilter ? `Work date ${pack.workDateFilter}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  if (meta) {
    doc.font('Helvetica').fontSize(9).fillColor('#57534E').text(meta);
  }
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#78716C')
    .text(`Exported ${pack.exportedAt}`);
  doc.moveDown(0.6);
  doc
    .strokeColor('#E7E5E4')
    .lineWidth(1)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 36);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ATMOSPHERE_INK).text(title);
  doc.moveDown(0.35);
}

function bulletList(doc: PDFKit.PDFDocument, items: string[], empty = 'None on file.') {
  if (!items.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#78716C').text(empty);
    doc.moveDown(0.4);
    return;
  }
  for (const item of items) {
    ensureSpace(doc, 28);
    doc.font('Helvetica').fontSize(9).fillColor('#292524').text(`•  ${item}`, {
      width: CONTENT_WIDTH,
      align: 'left',
    });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.35);
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  if (doc.y + need > doc.page.height - MARGIN) {
    doc.addPage();
  }
}

function drawClip(doc: PDFKit.PDFDocument, clip: ProofPackClip) {
  ensureSpace(doc, 80);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(ATMOSPHERE_INK)
    .text(`${clip.workDate} · ${clip.company} · ${clip.phase}`);
  if (clip.person) {
    doc.font('Helvetica').fontSize(8).fillColor('#57534E').text(`Filmed by ${clip.person}`);
  }
  if (clip.summary) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#292524').text(clip.summary, {
      width: CONTENT_WIDTH,
    });
  }
  if (clip.people.length) {
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#57534E')
      .text(`Who: ${clip.people.join(', ')}`);
  }

  if (clip.quotes.length) {
    doc.moveDown(0.35);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text('Timed quotes');
    for (const q of clip.quotes.slice(0, 12)) {
      ensureSpace(doc, 32);
      const clock = formatProofPackClock(q.tSec);
      const who = q.speaker ? `${q.speaker} · ` : '';
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#44403C')
        .text(`[${clock}] ${who}${q.text}`, { width: CONTENT_WIDTH });
      if (q.quote && q.quote !== q.text) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(8)
          .fillColor('#78716C')
          .text(`    “${q.quote}”`, { width: CONTENT_WIDTH - 12 });
      }
      doc.moveDown(0.1);
    }
  }

  if (clip.decisions.length || clip.nextSteps.length) {
    doc.moveDown(0.3);
    if (clip.decisions.length) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text('Decisions');
      bulletList(
        doc,
        clip.decisions.map((d) => {
          const clock = d.tSec != null ? `[${formatProofPackClock(d.tSec)}] ` : '';
          return `${clock}${d.text}`;
        }),
      );
    }
    if (clip.nextSteps.length) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text('Next steps');
      bulletList(
        doc,
        clip.nextSteps.map((d) => {
          const clock = d.tSec != null ? `[${formatProofPackClock(d.tSec)}] ` : '';
          return `${clock}${d.text}`;
        }),
      );
    }
  }

  const framed = clip.frames.filter((f) => f.jpeg && f.jpeg.length > 0);
  if (framed.length) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ATMOSPHERE_INK).text('Key frames');
    doc.moveDown(0.2);
    const gap = 10;
    const cellW = (CONTENT_WIDTH - gap) / 2;
    const cellH = 110;
    let col = 0;
    let rowY = doc.y;
    for (const frame of framed.slice(0, 4)) {
      ensureSpace(doc, cellH + 24);
      if (col === 0) rowY = doc.y;
      const x = MARGIN + col * (cellW + gap);
      try {
        doc.image(frame.jpeg!, x, rowY, {
          fit: [cellW, cellH - 14],
          align: 'center',
          valign: 'center',
        });
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
        .fillColor('#78716C')
        .text(`t=${formatProofPackClock(frame.atSeconds)}`, x, rowY + cellH - 12, {
          width: cellW,
        });
      col += 1;
      if (col >= 2) {
        col = 0;
        doc.y = rowY + cellH + 8;
      }
    }
    if (col !== 0) doc.y = rowY + cellH + 8;
  } else if (clip.privacyRangesRedacted > 0) {
    doc
      .moveDown(0.2)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#78716C')
      .text('Key frames omitted where privacy redaction applies, or no stills on file.');
  }

  doc.moveDown(0.7);
}

function addPageNumbers(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#A8A29E')
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - 36, {
        width: CONTENT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
  }
}

/** Build a PDF Buffer from a proof pack (frames may include jpeg buffers). */
export async function renderJobProofPackPdf(pack: JobProofPack): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: pack.job.name
          ? `Atmosphere proof pack — ${pack.job.name}`
          : 'Atmosphere job proof pack',
        Author: 'Atmosphere',
        Subject: 'Job proof pack / report',
        CreationDate: new Date(pack.exportedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, pack);

    sectionTitle(doc, 'What happened');
    bulletList(doc, pack.overview.whatHappened, 'No filmed summary on file yet.');

    sectionTitle(doc, 'Who');
    bulletList(doc, pack.overview.who, 'No people identified on file yet.');

    sectionTitle(doc, 'Decisions');
    bulletList(doc, pack.overview.decisions, 'No decisions recorded yet.');

    sectionTitle(doc, 'Next steps');
    bulletList(doc, pack.overview.nextSteps, 'No open next steps on file.');

    if (pack.days.length) {
      sectionTitle(doc, 'By work day');
      for (const day of pack.days) {
        ensureSpace(doc, 48);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(ATMOSPHERE_INK)
          .text(`${day.workDate} · ${day.company} · ${day.decision}`);
        const line = day.aiSummary ?? day.summary;
        if (line) {
          doc.font('Helvetica').fontSize(8).fillColor('#44403C').text(line, {
            width: CONTENT_WIDTH,
          });
        }
        if (day.concerns.length) {
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor('#78716C')
            .text(`Concerns: ${day.concerns.join('; ')}`);
        }
        doc.moveDown(0.35);
      }
    }

    if (pack.disputes.length) {
      sectionTitle(doc, 'Disputes / integrity');
      for (const d of pack.disputes) {
        ensureSpace(doc, 36);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(ATMOSPHERE_INK)
          .text(`${d.title} (${d.severity})`);
        if (d.detail) {
          doc.font('Helvetica').fontSize(8).fillColor('#44403C').text(d.detail, {
            width: CONTENT_WIDTH,
          });
        }
        doc.moveDown(0.25);
      }
    }

    if (pack.clips.length) {
      sectionTitle(doc, 'Clips — quotes & evidence');
      for (const clip of pack.clips) {
        drawClip(doc, clip);
      }
    } else {
      sectionTitle(doc, 'Clips');
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#78716C')
        .text('No clips on file for this job (or date filter).');
    }

    doc.moveDown(0.5);
    ensureSpace(doc, 40);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#78716C')
      .text(pack.privacyNotice, { width: CONTENT_WIDTH });
    doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#A8A29E')
      .text(
        'Generated by Atmosphere for insurer, GC, and homeowner review. Chain-of-custody JSON remains available separately.',
        { width: CONTENT_WIDTH },
      );

    addPageNumbers(doc);
    doc.end();
  });
}

export function proofPackFilename(pack: JobProofPack): string {
  const num = pack.job.number != null ? String(pack.job.number) : pack.job.id.slice(0, 8);
  const date = pack.workDateFilter ? `-${pack.workDateFilter}` : '';
  return `atmosphere-proof-pack-job-${num}${date}.pdf`;
}
