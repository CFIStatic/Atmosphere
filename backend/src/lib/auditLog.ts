/**
 * Payload sanitizer kept for the sold-path legal store.
 *
 * The agent_runs / agent_run_steps audit ledger was dropped (non-sold-path).
 * startRun / recordStep / finishRun soft-fails are gone with it; only
 * preparePayload remains for redacting activity detail written through legal.
 */

/** Column ceilings formerly from db/audit_ledger.sql. */
const LIMITS = {
  payloadBytes: 16_000,
  payloadString: 2000,
  payloadArray: 50,
  payloadDepth: 6,
} as const;

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Key names whose values are never safe to keep in a readable-forever table. */
const SECRET_KEY =
  /pass|secret|token|credential|authorization|auth[_-]?key|api[_-]?key|\bpin\b|ssn|cvv|card[_-]?number|private[_-]?key/i;

/** Key names that carry pixels rather than facts. */
const BINARY_KEY =
  /^(image|screenshot|screen|thumbnail|photo|frame|data_?url|base64|bytes|buffer)$/i;

const DATA_URL = /^data:[^;,]*;base64,/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    if (DATA_URL.test(value)) return `[binary omitted · ${value.length} chars]`;
    return clip(value, LIMITS.payloadString);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);

  if (depth >= LIMITS.payloadDepth) return '[nested too deeply]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, LIMITS.payloadArray).map((item) => sanitize(item, depth + 1));
    if (value.length > LIMITS.payloadArray) {
      kept.push(`[${value.length - LIMITS.payloadArray} more items omitted]`);
    }
    return kept;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]';
    } else if (BINARY_KEY.test(key) && typeof item === 'string') {
      out[key] = `[binary omitted · ${item.length} chars]`;
    } else {
      out[key] = sanitize(item, depth + 1);
    }
  }
  return out;
}

/** Sanitizes, then drops the payload entirely if it is still too large. */
export function preparePayload(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const cleaned = sanitize(value);
  try {
    const encoded = JSON.stringify(cleaned);
    if (encoded && encoded.length > LIMITS.payloadBytes) {
      return { omitted: `payload of ${encoded.length} chars exceeded the audit size limit` };
    }
    return cleaned;
  } catch {
    return { omitted: 'payload could not be serialized' };
  }
}
