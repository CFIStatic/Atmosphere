import { createHash } from 'node:crypto';
import { normalizeEquipment } from '../ingest/mica.js';
import { withDerivedGpp } from '../lib/psychrometrics.js';
import type { DryingReport } from '../planning/dryingProgress.js';
import type {
  EquipmentPlacement,
  MoistureReading,
  PsychrometricReading,
} from '../types.js';
import { normalizeMaterial } from '../ingest/docusketch.js';

/**
 * Outlook / email drying reports → DryingReport.
 *
 * Restoration shops routinely email (or auto-forward) daily drying reports from
 * Outlook: a subject like "Drying Report — FL-2026-0417839 Day 3", a body with
 * psychrometrics, moisture readings, equipment on site, and rooms at goal.
 * This parser turns that message into a visit the estimator can merge — so the
 * estimate updates when the mail arrives, without a tech retyping numbers.
 */

export interface OutlookDryingMessage {
  /** Message id from Graph / IMAP — used for idempotent imports. */
  id?: string;
  subject?: string;
  /** ISO received/sent time. */
  receivedAt?: string;
  /** Plain text body preferred; HTML is accepted and stripped. */
  body: string;
  from?: string;
  /** Optional claim hint when the subject does not carry one. */
  claimNumber?: string;
}

export interface OutlookParseResult {
  reports: DryingReport[];
  claimNumber?: string;
  warnings: string[];
}

/**
 * Parse one Outlook drying-report message into zero or more drying reports
 * (almost always one visit).
 */
export function dryingReportsFromOutlookMessage(message: OutlookDryingMessage): OutlookParseResult {
  const warnings: string[] = [];
  const text = normalizeBody(message.body);
  if (!text.trim()) {
    return { reports: [], warnings: ['Outlook message body was empty.'] };
  }

  const subject = message.subject ?? '';
  const claimNumber =
    message.claimNumber ??
    extractClaim(subject) ??
    extractClaim(text) ??
    undefined;

  const takenAt =
    message.receivedAt ??
    extractDate(subject) ??
    extractDate(text) ??
    new Date().toISOString();

  const moistureReadings = extractMoisture(text, takenAt, warnings);
  const psychrometrics = extractPsychro(text, takenAt);
  const equipment = extractEquipment(text, takenAt);
  const { dry, wet } = extractRoomStatus(text);

  const notes =
    firstLine(text) ||
    subject ||
    `Outlook drying report${claimNumber ? ` for ${claimNumber}` : ''}`;

  if (
    moistureReadings.length === 0 &&
    psychrometrics.length === 0 &&
    equipment.length === 0 &&
    dry.length === 0 &&
    wet.length === 0 &&
    !looksLikeDryingReport(subject, text)
  ) {
    warnings.push(
      'Message did not look like a drying report (no readings, equipment, or dry/wet rooms).',
    );
    return { reports: [], claimNumber, warnings };
  }

  const idSeed = message.id ?? [claimNumber, takenAt, subject, text.slice(0, 200)];
  const id = `outlook-${createHash('sha1').update(JSON.stringify(idSeed)).digest('hex').slice(0, 12)}`;

  const report: DryingReport = {
    id,
    takenAt: toIso(takenAt),
    source: 'outlook',
    notes: notes.slice(0, 500),
    moistureReadings: moistureReadings.length ? moistureReadings : undefined,
    psychrometrics: psychrometrics.length ? psychrometrics : undefined,
    equipment: equipment.length ? equipment : undefined,
    roomsAtDryStandard: dry.length ? dry : undefined,
    roomsStillWet: wet.length ? wet : undefined,
    evidence: [
      {
        id: `${id}-ev`,
        kind: 'note',
        capturedAt: toIso(takenAt),
        description: `Outlook drying report${subject ? `: ${subject}` : ''}${message.from ? ` from ${message.from}` : ''}`,
        tags: ['outlook', 'drying_report', 'capture'],
      },
    ],
    raw: {
      kind: 'outlook_message',
      id: message.id,
      subject: message.subject,
      from: message.from,
      receivedAt: message.receivedAt,
    },
  };

  return { reports: [report], claimNumber, warnings };
}

/** Parse a Graph-style mail list or a single message / .eml-ish payload. */
export function dryingReportsFromOutlookPayload(payload: unknown): OutlookParseResult {
  const warnings: string[] = [];
  const messages = normalizeOutlookPayload(payload);
  if (messages.length === 0) {
    return { reports: [], warnings: ['No Outlook messages found in the payload.'] };
  }

  const reports: DryingReport[] = [];
  let claimNumber: string | undefined;
  for (const message of messages) {
    const parsed = dryingReportsFromOutlookMessage(message);
    reports.push(...parsed.reports);
    warnings.push(...parsed.warnings);
    claimNumber = claimNumber ?? parsed.claimNumber;
  }
  return {
    reports: reports.sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)),
    claimNumber,
    warnings,
  };
}

function normalizeOutlookPayload(payload: unknown): OutlookDryingMessage[] {
  if (!payload) return [];
  if (typeof payload === 'string') {
    return [{ body: payload }];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => normalizeOutlookPayload(item));
  }
  const root = payload as Record<string, unknown>;

  const bodyContent = extractBodyContent(root);
  if (bodyContent !== null) {
    return [
      {
        id: typeof root.id === 'string' ? root.id : undefined,
        subject: typeof root.subject === 'string' ? root.subject : undefined,
        receivedAt:
          typeof root.receivedAt === 'string'
            ? root.receivedAt
            : typeof root.receivedDateTime === 'string'
              ? root.receivedDateTime
              : typeof root.sentAt === 'string'
                ? root.sentAt
                : undefined,
        body: bodyContent,
        from: extractFrom(root),
        claimNumber: typeof root.claimNumber === 'string' ? root.claimNumber : undefined,
      },
    ];
  }

  if (Array.isArray(root.value)) return normalizeOutlookPayload(root.value);
  if (Array.isArray(root.messages)) return normalizeOutlookPayload(root.messages);
  return [];
}

function extractBodyContent(root: Record<string, unknown>): string | null {
  if (typeof root.body === 'string') return root.body;
  if (typeof root.content === 'string') return root.content;
  if (root.body && typeof root.body === 'object') {
    const content = (root.body as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  return null;
}

function extractFrom(root: Record<string, unknown>): string | undefined {
  if (typeof root.from === 'string') return root.from;
  if (root.from && typeof root.from === 'object') {
    const address = (root.from as { emailAddress?: { address?: string } }).emailAddress?.address;
    if (typeof address === 'string') return address;
  }
  return undefined;
}

function normalizeBody(body: string): string {
  let text = body;
  if (/<html|<body|<div|<br/i.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function looksLikeDryingReport(subject: string, body: string): boolean {
  const hay = `${subject}\n${body}`;
  return /drying\s*report|moisture|psychrometr|air\s*mover|dehumidifier|dry\s*standard|gpp|%?\s*rh\b/i.test(
    hay,
  );
}

function extractClaim(text: string): string | undefined {
  const match = text.match(
    /\b(?:claim(?:\s*(?:#|no\.?|number))?|file)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-_/]{4,})\b/i,
  );
  if (match) return match[1];
  const dashed = text.match(/\b([A-Z]{2}-\d{4}-\d{5,})\b/);
  return dashed?.[1];
}

function extractDate(text: string): string | undefined {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/);
  if (iso) return toIso(iso[1]);
  const us = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return toIso(`${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}T12:00:00Z`);
  }
  return undefined;
}

function extractMoisture(
  text: string,
  takenAt: string,
  warnings: string[],
): MoistureReading[] {
  const readings: MoistureReading[] = [];
  // Kitchen drywall 11% (goal 12)
  // Hall engineered wood: 8 vs dry std 9
  // Dining carpet 9 / 10
  const patterns = [
    /([A-Za-z][A-Za-z0-9 \-/]{0,40}?)\s+([A-Za-z][A-Za-z0-9 \-/]{1,30}?)\s+(\d+(?:\.\d+)?)\s*%?\s*(?:\((?:goal|dry\s*std|standard|vs)?\s*)?(?:vs|against|goal|dry\s*std|standard|:)?\s*(\d+(?:\.\d+)?)/gi,
    /([A-Za-z][A-Za-z0-9 \-/]{0,40}?):\s*([A-Za-z][A-Za-z0-9 \-/]{1,30}?)\s+(\d+(?:\.\d+)?)\s*(?:%|mc)?\s*(?:\/|vs|,)\s*(\d+(?:\.\d+)?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const room = match[1].trim();
      const materialRaw = match[2].trim();
      if (/affected|unaffected|outside|equipment|claim/i.test(room)) continue;
      const material = normalizeMaterial(materialRaw);
      if (!material) {
        warnings.push(`Unrecognised material "${materialRaw}" in Outlook moisture line.`);
        continue;
      }
      readings.push({
        roomId: room.toLowerCase().replace(/\s+/g, '_'),
        material,
        value: Number(match[3]),
        dryStandard: Number(match[4]),
        takenAt: toIso(takenAt),
        location: room,
      });
    }
  }
  return readings;
}

function extractPsychro(text: string, takenAt: string): PsychrometricReading[] {
  const readings: PsychrometricReading[] = [];
  const patterns = [
    /(affected|unaffected|outside|dehu(?:midifier)?\s*outlet)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*°?\s*F\s*[\/,]\s*(\d+(?:\.\d+)?)\s*%?\s*RH(?:\s*[\/,]\s*(\d+(?:\.\d+)?)\s*GPP)?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const zoneRaw = match[1].toLowerCase();
      const zone =
        zoneRaw.startsWith('dehu')
          ? 'dehu_outlet'
          : (zoneRaw as 'affected' | 'unaffected' | 'outside');
      readings.push(
        withDerivedGpp({
          takenAt: toIso(takenAt),
          zone,
          temperatureF: Number(match[2]),
          relativeHumidity: Number(match[3]),
          gpp: match[4] ? Number(match[4]) : undefined,
        }),
      );
    }
  }
  return readings;
}

function extractEquipment(text: string, takenAt: string): EquipmentPlacement[] {
  const placements: EquipmentPlacement[] = [];
  const pattern =
    /(\d+)\s*[x×]?\s*(air\s*movers?|movers?|lgrs?|dehumidifiers?|dehus?|scrubbers?|air\s*scrubbers?|injectidry)/gi;
  for (const match of text.matchAll(pattern)) {
    const kind = normalizeEquipment(match[2]);
    if (!kind) continue;
    placements.push({
      kind,
      quantity: Math.max(1, Math.round(Number(match[1]))),
      placedAt: toIso(takenAt),
    });
  }
  return placements;
}

function extractRoomStatus(text: string): { dry: string[]; wet: string[] } {
  const dry: string[] = [];
  const wet: string[] = [];
  const dryMatch = text.match(
    /(?:at\s*(?:dry\s*)?(?:standard|goal|std)|dry(?:ing)?\s*complete|rooms?\s*dry)\s*[:\-]?\s*([^\n.]+)/i,
  );
  const wetMatch = text.match(
    /(?:still\s*wet|above\s*(?:dry\s*)?(?:standard|goal)|rooms?\s*wet)\s*[:\-]?\s*([^\n.]+)/i,
  );
  if (dryMatch) dry.push(...splitRooms(dryMatch[1]));
  if (wetMatch) wet.push(...splitRooms(wetMatch[1]));
  return { dry, wet };
}

function splitRooms(value: string): string[] {
  return value
    .split(/[,;&]| and /i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60);
}

function firstLine(text: string): string | undefined {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  return line?.slice(0, 200);
}

function toIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}
