import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, Pencil, ShieldOff, X, AlertTriangle, Clock } from 'lucide-react';
import { api, ApiError, type AskApproval } from '../../lib/api';
import { displayPhone } from '../../lib/displayPhone';

function timeOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-[13px] font-semibold text-paper-0 transition hover:bg-ink-800 disabled:opacity-40';
const SECONDARY =
  'inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-[13px] font-medium text-ink-700 transition hover:border-brand-200 hover:text-ink-900 disabled:opacity-40';

/**
 * Permission card for something Chat wants to do (send a text, remove
 * someone's access). Nothing happens until the person presses the primary
 * button; the server runs the action from that click alone. After a decision
 * the card becomes a one-line receipt.
 */
export function AskApprovalCard({ jobId, approvalId }: { jobId: string; approvalId: string }) {
  const [approval, setApproval] = useState<AskApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .askApproval(jobId, approvalId)
      .then((res) => {
        if (!alive) return;
        setApproval(res.approval);
        setDraft(res.approval.payload.body ?? '');
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Could not load this request.'));
    return () => {
      alive = false;
    };
  }, [jobId, approvalId]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const decide = async (approve: boolean) => {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      const edited = approve && approval.editable && draft.trim() !== (approval.payload.body ?? '').trim() ? draft : null;
      const res = approve ? await api.approveAskApproval(jobId, approval.id, edited) : await api.denyAskApproval(jobId, approval.id);
      setApproval(res.approval);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!approval) {
    return (
      <div className="rounded-xl border border-line bg-paper-50 px-3 py-2 text-[13px] text-ink-500" data-testid="ask-approval-loading">
        {error ?? 'Loading the request…'}
      </div>
    );
  }

  const sms = approval.kind === 'send_job_sms';
  if (approval.status !== 'pending') {
    // Receipt: one line, like a finished tool call.
    const tone =
      approval.status === 'approved'
        ? 'text-success-600'
        : approval.status === 'failed'
          ? 'text-danger-700'
          : 'text-ink-500';
    const Icon = approval.status === 'approved' ? Check : approval.status === 'failed' ? AlertTriangle : approval.status === 'expired' ? Clock : X;
    return (
      <p className={`flex items-center gap-1.5 text-[13px] ${tone}`} data-testid="ask-approval-receipt" data-status={approval.status}>
        <Icon size={14} aria-hidden />
        <span>
          {approval.result ?? (approval.status === 'denied' ? (sms ? 'Not sent.' : 'Access kept.') : approval.title)}
          {approval.decidedAt ? <span className="text-ink-400"> · {timeOf(approval.decidedAt)}</span> : null}
        </span>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-paper-0 p-3 shadow-sm" data-testid="ask-approval-card" role="group" aria-label={approval.title}>
      <p className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
        {sms ? <MessageSquare size={15} aria-hidden /> : <ShieldOff size={15} aria-hidden />}
        {approval.title}
      </p>
      {sms ? (
        <>
          <p className="mt-1 text-[12px] text-ink-500">To {displayPhone(approval.payload.to)}</p>
          {editing ? (
            <textarea
              ref={editRef}
              aria-label="Edit the text"
              value={draft}
              maxLength={1600}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 60)))}
              className="mt-2 w-full resize-none rounded-lg border border-line bg-paper-0 px-2.5 py-2 text-[14px] text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
          ) : (
            <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-paper-50 px-2.5 py-2 text-[14px] text-ink-800" data-testid="ask-approval-body">
              {draft}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[13px] text-ink-600">
          {approval.payload.email ? `${approval.payload.email}. ` : ''}They will lose the link and anything shared with them on this job.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="ask-approval-approve" disabled={busy || (sms && !draft.trim())} onClick={() => void decide(true)} className={PRIMARY}>
          <Check size={14} aria-hidden />
          {sms ? 'Send' : 'Remove access'}
        </button>
        {approval.editable && !editing ? (
          <button type="button" data-testid="ask-approval-edit" disabled={busy} onClick={() => setEditing(true)} className={SECONDARY}>
            <Pencil size={13} aria-hidden />
            Edit
          </button>
        ) : null}
        <button type="button" data-testid="ask-approval-deny" disabled={busy} onClick={() => void decide(false)} className={SECONDARY}>
          <X size={14} aria-hidden />
          {sms ? "Don't send" : 'Keep access'}
        </button>
        <span className="text-[11px] text-ink-400">{sms ? 'Nothing is sent until you press Send.' : 'Nothing changes until you confirm.'}</span>
      </div>
      {error ? <p className="mt-2 text-[12px] text-danger-700">{error}</p> : null}
    </div>
  );
}
