import { useCallback, useEffect, useState } from 'react';
import {
  attachChatDocument,
  listChatDocuments,
  uploadChatDocument,
  type ChatDocumentCard,
  type UploadPhase,
} from '../../lib/chatDocuments';

export function verdictLabel(doc: ChatDocumentCard): string {
  if (doc.relevance === 'related') return 'Related to this job';
  if (doc.relevance === 'pending_confirm') return 'Confirm before attaching';
  return 'Not related';
}

export function AskDocumentCard({
  doc,
  onAttach,
  onDismiss,
}: {
  doc: ChatDocumentCard;
  onAttach?: (doc: ChatDocumentCard) => void;
  onDismiss?: (doc: ChatDocumentCard) => void;
}) {
  const tone =
    doc.relevance === 'related'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : doc.relevance === 'pending_confirm'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-line bg-paper-0 text-ink-800';
  return (
    <article data-testid="ask-document-card" className={`rounded-xl border px-3 py-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{doc.filename}</p>
        <p className="text-[11px] uppercase tracking-wide">{doc.kindLabel}</p>
      </div>
      <p className="mt-1 text-xs font-medium">{verdictLabel(doc)}</p>
      {doc.summary ? <p className="mt-1 text-xs leading-relaxed">{doc.summary}</p> : null}
      {doc.relevanceReason ? <p className="mt-1 text-xs leading-relaxed opacity-80">{doc.relevanceReason}</p> : null}
      {doc.macrosIgnored ? <p className="mt-1 text-xs">Macros in this file were not opened.</p> : null}
      {doc.relevance === 'pending_confirm' && doc.suggestedJobId && onAttach ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAttach(doc)}
            className="rounded-full bg-ink-900 px-2.5 py-1 text-[11px] font-medium text-white"
          >
            Attach to {doc.suggestedJobTitle || 'this job'}
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(doc)}
              className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] font-medium text-ink-600"
            >
              Don't attach
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function JobDocumentsList({ jobId }: { jobId: string }) {
  const [documents, setDocuments] = useState<ChatDocumentCard[]>([]);
  useEffect(() => {
    let cancelled = false;
    listChatDocuments(jobId)
      .then((rows) => {
        if (!cancelled) setDocuments(rows.filter((row) => row.attached));
      })
      .catch(() => {
        if (!cancelled) setDocuments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  return (
    <section data-testid="job-documents-list" className="shrink-0 rounded-xl border border-line bg-paper-0 px-4 py-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Documents</h3>
      {documents.length === 0 ? (
        <p className="mt-1 text-xs text-ink-500">No documents on this job yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <AskDocumentCard doc={doc} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function uploadPhaseLabel(phase: UploadPhase): string {
  if (phase === 'reading') return 'Reading the file…';
  if (phase === 'uploading') return 'Uploading…';
  return 'Checking whether it belongs on this job…';
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

  async function upload(files: File[], proofId?: string | null) {
    for (const file of files) {
      try {
        setError(null);
        const card = await uploadChatDocument(file, { jobId, proofId, onPhase: setPhase });
        setDocuments((prev) => [card, ...prev.filter((row) => row.id !== card.id)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      } finally {
        setPhase(null);
      }
    }
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
