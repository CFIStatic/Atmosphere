/**
 * Chat document upload: what a file is, what we read out of it, and whether
 * it belongs on the job the office has open.
 *
 * Figures, line items, rooms, and dimensions in here are copied from the
 * extracted text. Nothing in this module invents them.
 */

export const DOCUMENT_KINDS = [
  'estimate',
  'invoice',
  'contract',
  'change_order',
  'insurance_claim',
  'scope',
  'sketch',
  'floor_plan',
  'permit',
  'photo',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const KIND_LABEL: Record<DocumentKind, string> = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  contract: 'Contract',
  change_order: 'Change order',
  insurance_claim: 'Insurance claim',
  scope: 'Scope',
  sketch: 'Sketch',
  floor_plan: 'Floor plan',
  permit: 'Permit',
  photo: 'Photo',
  other: 'Document',
};

export type RelevanceVerdict = 'related' | 'not_related' | 'pending_confirm';

export type DocumentFormat =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'pptx'
  | 'txt'
  | 'md'
  | 'rtf'
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic';

export type SniffedFile = {
  format: DocumentFormat;
  mediaType: string;
  /** Office or PDF encryption. The file is not opened. */
  encrypted: boolean;
  /** A macro part is present. It is never executed. */
  macrosPresent: boolean;
};

export type ExtractedChunk = {
  seq: number;
  /** Human location: "page 2", "Estimate!B4", "slide 1", "image". */
  location: string;
  text: string;
};

export type QuotedFact = {
  label: string;
  value: string;
  /** Exact substring of the extracted text. */
  quote: string;
  location: string;
};

export type RoomFact = {
  name: string;
  dimensions: string | null;
  notes: string | null;
  /** Exact substring that named the room, when one was found. */
  quote: string;
  sourceLocation: string;
};

export type DocumentFacts = {
  totals: QuotedFact[];
  lineItems: QuotedFact[];
  dates: QuotedFact[];
  addresses: QuotedFact[];
  parties: QuotedFact[];
  claimNumbers: QuotedFact[];
  rooms: RoomFact[];
};

export type ExtractionResult = {
  text: string;
  chunks: ExtractedChunk[];
  warnings: string[];
  /** A page or the whole file had no text layer and was sent to vision. */
  scanned: boolean;
};

export type JobMatchProfile = {
  id: string;
  title: string | null;
  address: string | null;
  claimNumber: string | null;
  customerName: string | null;
  description: string | null;
  scopeText: string | null;
};

export type RelevanceDecision = {
  verdict: RelevanceVerdict;
  score: number;
  reason: string;
  /** Set when the file was uploaded outside a job and a file looks like a match. */
  suggestedJobId: string | null;
  /** True only when the document should become part of the job file. */
  attach: boolean;
};

export type IngestedDocument = {
  filename: string;
  mediaType: string;
  format: DocumentFormat;
  byteSize: number;
  contentHash: string;
  kind: DocumentKind;
  summary: string;
  facts: DocumentFacts;
  extraction: ExtractionResult;
  relevance: RelevanceDecision;
  macrosIgnored: boolean;
};

export type ImageVisionRead = {
  /** Text the vision pass read off the image. Quoted later only from this list. */
  visibleText: string[];
  /** Short description of what is visible. Not treated as printed text. */
  description: string;
  roomType: string | null;
};

export type ImageReader = (input: {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}) => Promise<ImageVisionRead>;

export class DocumentReadError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DocumentReadError';
    this.code = code;
  }
}
