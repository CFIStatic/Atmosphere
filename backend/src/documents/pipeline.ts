/**
 * Sniff, extract, classify, and decide whether a chat upload belongs on a job.
 * Storage and database writes stay in the route. This function does not keep the bytes.
 */
import { createHash } from 'node:crypto';
import { classifyDocument, decideRelevance, extractFacts, summarizeDocument } from './classify.js';
import { extractImage, extractionFromVision, jpegPreviewFromHeic } from './extractImage.js';
import { extractOfficeAsync } from './extractOffice.js';
import { pdfToExtraction, readPdf } from './extractPdf.js';
import { sniffDocument, safeFilename } from './sniff.js';
import { extractCsv, extractMarkdown, extractPlain, extractRtf } from './text.js';
import {
  DocumentReadError,
  type DocumentFormat,
  type ExtractionResult,
  type ImageReader,
  type IngestedDocument,
  type JobMatchProfile,
} from './types.js';

export async function ingestChatDocument(input: {
  bytes: Buffer;
  filename: string;
  job: JobMatchProfile | null;
  candidates?: JobMatchProfile[];
  readImage?: ImageReader;
}): Promise<IngestedDocument> {
  const filename = safeFilename(input.filename);
  const sniffed = sniffDocument(input.bytes, filename);
  const extracted = await extractByFormat(input.bytes, sniffed.format, input.readImage);
  if (sniffed.macrosPresent) extracted.warnings.push('Macros in this file were ignored.');
  const kind = sniffed.format === 'jpeg' || sniffed.format === 'png' || sniffed.format === 'webp' || sniffed.format === 'heic'
    ? imageKind(extracted.text, filename)
    : classifyDocument(filename, extracted.text);
  const facts = extractFacts(extracted.text, extracted.chunks.map((chunk) => ({ location: chunk.location, text: chunk.text })));
  const summary = summarizeDocument(kind, facts, extracted.text);
  const relevance = decideRelevance({
    facts,
    text: extracted.text,
    filename,
    job: input.job,
    candidates: input.job ? [] : input.candidates ?? [],
  });
  return {
    filename,
    mediaType: sniffed.mediaType,
    format: sniffed.format,
    byteSize: input.bytes.length,
    contentHash: createHash('sha256').update(input.bytes).digest('hex'),
    kind,
    summary,
    facts,
    extraction: extracted,
    relevance,
    macrosIgnored: sniffed.macrosPresent || extracted.warnings.some((warning) => /macro/i.test(warning)),
  };
}

async function extractByFormat(bytes: Buffer, format: DocumentFormat, readImage?: ImageReader): Promise<ExtractionResult> {
  if (format === 'pdf') return extractPdf(bytes, readImage);
  if (format === 'docx' || format === 'doc' || format === 'xlsx' || format === 'xls' || format === 'pptx') {
    const office = await extractOfficeAsync(bytes, format);
    const result = { ...office };
    if (office.macrosIgnored) result.warnings = [...result.warnings, 'Macros in this file were ignored.'];
    return result;
  }
  if (format === 'csv') return extractCsv(bytes);
  if (format === 'md') return extractMarkdown(bytes);
  if (format === 'rtf') return extractRtf(bytes);
  if (format === 'txt') return extractPlain(bytes);
  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    return extractImage({ bytes, mimeType: mime(format), readImage });
  }
  if (format === 'heic') {
    const preview = jpegPreviewFromHeic(bytes);
    if (!preview) {
      throw new DocumentReadError(
        'This HEIC photo could not be decoded. Export it as JPEG and upload it again.',
        'unsupported',
      );
    }
    return extractImage({ bytes: preview, mimeType: 'image/jpeg', readImage, location: 'image' });
  }
  throw new DocumentReadError('This file type is not supported.', 'unsupported');
}

async function extractPdf(bytes: Buffer, readImage?: ImageReader): Promise<ExtractionResult> {
  const read = readPdf(bytes);
  const visionText: Array<{ page: number; text: string }> = [];
  const blankPages = read.pages.filter((page) => !page.text.trim());
  if (blankPages.length && read.images.length) {
    let calls = 0;
    for (const page of blankPages) {
      if (calls >= 8) break;
      const image = read.images.find((row) => row.page === page.page);
      if (!image) continue;
      calls += 1;
      try {
        const extracted = await extractImage({
          bytes: image.bytes,
          mimeType: 'image/jpeg',
          readImage,
          location: `page ${page.page}`,
        });
        visionText.push({ page: page.page, text: extracted.text });
      } catch {
        visionText.push({ page: page.page, text: '' });
      }
    }
  } else if (!read.pages.some((page) => page.text.trim()) && read.images.length) {
    const image = read.images[0]!;
    const extracted = await extractImage({
      bytes: image.bytes,
      mimeType: 'image/jpeg',
      readImage,
      location: `page ${image.page}`,
    });
    visionText.push({ page: image.page, text: extracted.text });
  }
  if (!read.pages.some((page) => page.text.trim()) && !visionText.some((row) => row.text.trim())) {
    throw new DocumentReadError(
      'This PDF has no readable text. If it is a scan, the pages could not be read.',
      'empty',
    );
  }
  return pdfToExtraction(read, visionText);
}

function mime(format: 'jpeg' | 'png' | 'webp'): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function imageKind(text: string, filename: string): IngestedDocument['kind'] {
  const kind = classifyDocument(filename, text);
  return kind === 'other' ? 'photo' : kind;
}

export { extractionFromVision };
