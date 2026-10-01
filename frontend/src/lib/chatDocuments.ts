/**
 * Chat document upload. The bytes go to the operations API as base64 JSON.
 * Demo mode intercepts fetch, so this stays on fetch rather than XHR.
 */

export type ChatDocumentCard = {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  kind: string;
  kindLabel: string;
  relevance: 'related' | 'not_related' | 'pending_confirm' | string;
  relevanceReason: string | null;
  summary: string | null;
  attached: boolean;
  jobId: string | null;
  contextJobId: string | null;
  suggestedJobId: string | null;
  suggestedJobTitle: string | null;
  macrosIgnored: boolean;
  createdAt: string;
};

export const CHAT_DOCUMENT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.markdown,.rtf,.jpg,.jpeg,.png,.heic,.heif,.webp';

const MAX_BYTES = 25 * 1024 * 1024;

export type UploadPhase = 'reading' | 'uploading' | 'checking';

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  if (res.status === 413) return 'That file is too large.';
  return 'Could not read that file.';
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadChatDocument(
  file: File,
  opts: {
    jobId?: string | null;
    proofId?: string | null;
    onPhase?: (phase: UploadPhase) => void;
  } = {},
): Promise<ChatDocumentCard> {
  if (!file.size) throw new Error('The document is empty.');
  if (file.size > MAX_BYTES) throw new Error('Documents are capped at 25 MB.');
  opts.onPhase?.('reading');
  const contentBase64 = await readBase64(file);
  opts.onPhase?.('uploading');
  const res = await fetch('/api/operations/documents', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name || 'document',
      contentBase64,
      jobId: opts.jobId ?? null,
      proofId: opts.proofId ?? null,
    }),
  });
  opts.onPhase?.('checking');
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { document?: ChatDocumentCard };
  if (!body.document) throw new Error('Could not read that file.');
  return body.document;
}

export async function listChatDocuments(jobId: string): Promise<ChatDocumentCard[]> {
  const res = await fetch(`/api/operations/shared/${encodeURIComponent(jobId)}/documents`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { documents?: ChatDocumentCard[] } | null;
  return body?.documents ?? [];
}

export async function attachChatDocument(id: string, jobId: string): Promise<ChatDocumentCard> {
  const res = await fetch(`/api/operations/documents/${encodeURIComponent(id)}/attach`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { document?: ChatDocumentCard };
  if (!body.document) throw new Error('Could not attach that document.');
  return body.document;
}

export async function askChatDocuments(question: string, documentIds: string[]): Promise<string> {
  const res = await fetch('/api/operations/documents/ask', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, documentIds }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { answer?: string };
  return String(body.answer ?? '').trim() || 'This document does not show that.';
}
