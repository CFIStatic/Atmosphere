import { useCallback, useEffect, useState } from 'react';
import {
  attachChatDocument,
  listChatDocuments,
  uploadChatDocument,
  type AskAttachment,
  type ChatDocumentCard,
  type UploadPhase,
} from '../../lib/chatDocuments';

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3.5h7l5 5V20a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V5A1.5 1.5 0 017 3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M14 3.5V9h5.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function chipType(label: string | null | undefined): string | null {
  const value = (label ?? '').trim();
  if (!value) return null;
  if (/^(document|file|other)$/i.test(value)) return null;
  return value;
}

/** Compact file chip. Composer chips include remove; message chips include the type. */
export function AskAttachmentChip({
  file,
  onRemove,
  onDark = false,
}: {
  file: AskAttachment;
  onRemove?: () => void;
  onDark?: boolean;
}) {
  const typeLabel = onRemove ? null : chipType(file.typeLabel);
  return (
    <span
      data-testid="ask-attachment-chip"
      data-filename={file.filename}
      className={
        onDark
          ? 'inline-flex max-w-full items-center gap-1.5 rounded-2xl border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-paper-0'
          : 'inline-flex max-w-full items-center gap-1.5 rounded-2xl border border-line bg-paper-0 px-2.5 py-1 text-xs text-ink-800 shadow-sm'
      }
    >
      <FileIcon />
      <span className="max-w-[12rem] truncate font-medium">{file.filename}</span>
      {typeLabel ? (
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-70">{typeLabel}</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${file.filename}`}
          onClick={onRemove}
          className={
            onDark
              ? 'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[13px] leading-none text-paper-0/80 hover:bg-white/15'
              : 'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[13px] leading-none text-ink-500 hover:bg-paper-100 hover:text-ink-800'
          }
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function uploadPhaseLabel(phase: UploadPhase): string {
  if (phase === 'reading') return 'Reading the file…';
  return 'Uploading…';
}

export function useJobDocuments(jobId: string | null) {
  const [documents, setDocuments] = useState<ChatDocumentCard[]>([]);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    if (!jobId) {
      setDocuments([]);
      return;
    }
    try {
      setDocuments(await listChatDocuments(jobId));
    } catch {
      setDocuments([]);
    }
  }, [jobId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(files: File[], proofId?: string | null): Promise<ChatDocumentCard[]> {
    const created: ChatDocumentCard[] = [];
    for (const file of files) {
      try {
        setError(null);
        const card = await uploadChatDocument(file, { jobId, proofId, onPhase: setPhase });
        created.push(card);
        setDocuments((prev) => [card, ...prev.filter((row) => row.id !== card.id)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      } finally {
        setPhase(null);
      }
    }
    return created;
  }

  async function confirm(doc: ChatDocumentCard) {
    const target = doc.suggestedJobId || jobId;
    if (!target) return;
    try {
      setError(null);
      const next = await attachChatDocument(doc.id, target);
      setDocuments((prev) => prev.map((row) => (row.id === doc.id ? next : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach that document.');
    }
  }

  function dismiss(doc: ChatDocumentCard) {
    setHidden((prev) => ({ ...prev, [doc.id]: true }));
  }

  return {
    documents: documents.filter((doc) => !hidden[doc.id]),
    phase,
    error,
    upload,
    confirm,
    dismiss,
  };
}
