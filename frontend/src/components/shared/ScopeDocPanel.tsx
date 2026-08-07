import { useEffect, useRef, useState } from 'react';
import { api, type ProposedScopeLine, type ScopeDocument } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * The scope arrives as a document.
 *
 * Upload the work order or carrier estimate the job actually has; the model
 * reads it into proposed lines; a person keeps, prunes, and confirms. The
 * panel's whole design enforces the one rule: the extraction is a proposal.
 * Every line renders with a checkbox because the person is choosing, not
 * acknowledging — and the confirm button says how many lines it is about to
 * make real.
 */
export function ScopeDocPanel({ jobId, onChanged }: { jobId: string; onChanged: () => void }) {
  const [doc, setDoc] = useState<ScopeDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);

  async function load() {
    try {
      const res = await api.scopeDocument(jobId);
      setDoc(res.doc);
      if (res.doc?.extracted) setKeep(res.doc.extracted.lines.map(() => true));
      setLoaded(true);
      return res.doc;
    } catch {
      setLoaded(true);
      return null;
    }
  }

  useEffect(() => {
    setDoc(null);
    setLoaded(false);
    void load();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // While the model reads, poll until it lands somewhere terminal.
  useEffect(() => {
    if (doc && (doc.status === 'uploaded' || doc.status === 'extracting')) {
      pollRef.current = window.setInterval(() => {
        void load().then((fresh) => {
          if (fresh && fresh.status !== 'uploaded' && fresh.status !== 'extracting' && pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        });
      }, 1500);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.status]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const res = await api.uploadScopeDocument(jobId, {
        filename: file.name,
        mediaType: file.type === 'application/pdf' ? 'application/pdf' : 'text/plain',
        contentBase64: btoa(binary),
      });
      setDoc(res.doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!doc?.extracted) return;
    const lines = doc.extracted.lines
      .filter((_, i) => keep[i])
      .map((line) => ({ title: line.title, state: line.state, reason: line.reason, amount: line.amount }));
    if (!lines.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmScopeDocument(jobId, doc.id, { lines });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the scope.');
    } finally {
      setBusy(false);
    }
  }

  const keptCount = keep.filter(Boolean).length;

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Scope from a document</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Upload the work order or estimate this job actually has. The assistant reads it into
            scope lines; nothing becomes scope until you confirm it.
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          Upload a document
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {!loaded ? (
        <p className="mt-3 text-xs text-ink-500">Loading…</p>
      ) : !doc ? (
        <p className="mt-3 text-xs text-ink-500">
          No document yet. PDF or plain text, up to 10 MB — the signed version beats the pretty one.
        </p>
      ) : doc.status === 'uploaded' || doc.status === 'extracting' ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-600">
          <SpinnerIcon className="animate-spin" width={13} height={13} />
          Reading “{doc.filename}” — extracting the work lines a video can be checked against…
        </p>
      ) : doc.status === 'failed' ? (
        <p className="mt-3 text-xs text-danger-600">
          Could not read “{doc.filename}”: {doc.extractionError ?? 'extraction failed.'} Upload it
          again, or type the lines by hand below.
        </p>
      ) : doc.status === 'confirmed' ? (
        <p className="mt-3 text-xs text-success-600">
          Scope set from “{doc.filename}”
          {doc.confirmedAt ? ` on ${new Date(doc.confirmedAt).toLocaleDateString()}` : ''} — every
          line carries the document as its source. Footage is judged against these lines.
        </p>
      ) : doc.extracted ? (
        <div className="mt-3">
          <p className="text-xs text-ink-600">
            Read from “{doc.filename}”. Keep what is right, untick what is not — this is a
            proposal, and only what you confirm becomes the scope.
          </p>
          <ul className="mt-2 space-y-1.5">
            {doc.extracted.lines.map((line: ProposedScopeLine, i: number) => (
              <li key={i} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                <input
                  type="checkbox"
                  checked={keep[i] ?? true}
                  onChange={() => setKeep((k) => k.map((v, j) => (j === i ? !v : v)))}
                  className="mt-0.5"
                  aria-label={`Keep "${line.title}"`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800">
                    {line.title}
                    {line.amount !== null && (
                      <span className="ml-2 text-xs tabular-nums text-ink-500">
                        ${line.amount.toLocaleString()}
                      </span>
                    )}
                  </p>
                  {line.reason && <p className="text-[11px] text-ink-500">{line.reason}</p>}
                  {line.note && <p className="text-[11px] text-caution-600">{line.note}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    line.state === 'excluded'
                      ? 'bg-danger-50 text-danger-600'
                      : 'bg-paper-200/60 text-ink-700'
                  }`}
                >
                  {line.state === 'excluded' ? 'DO NOT' : 'in scope'}
                </span>
              </li>
            ))}
          </ul>
          {doc.extracted.couldNotRead.length > 0 && (
            <div className="mt-2 rounded-lg border border-caution-200 bg-caution-50/60 px-3 py-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-caution-600">
                What it could not read
              </p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-ink-700">
                {doc.extracted.couldNotRead.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => void confirm()}
            disabled={busy || keptCount === 0}
            className="mt-3 flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            Confirm {keptCount} line{keptCount === 1 ? '' : 's'} as the scope
          </button>
        </div>
      ) : null}
    </section>
  );
}
