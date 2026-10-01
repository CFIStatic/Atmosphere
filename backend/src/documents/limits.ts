/** Upload caps. Enforced before a file is stored or parsed. */
export const DOCUMENT_LIMITS = {
  /** PDF, Word, Excel, PowerPoint. */
  maxBytes: 25 * 1024 * 1024,
  /** Photos and scans. */
  maxImageBytes: 15 * 1024 * 1024,
  /** Plain text, markdown, CSV, RTF. */
  maxTextBytes: 5 * 1024 * 1024,
  maxPages: 40,
  maxSheets: 20,
  maxSlides: 40,
  maxChunks: 200,
  chunkChars: 1200,
} as const;

export function limitForFormat(format: string): number {
  if (format === 'jpeg' || format === 'png' || format === 'webp' || format === 'heic') {
    return DOCUMENT_LIMITS.maxImageBytes;
  }
  if (format === 'txt' || format === 'md' || format === 'csv' || format === 'rtf') {
    return DOCUMENT_LIMITS.maxTextBytes;
  }
  return DOCUMENT_LIMITS.maxBytes;
}
