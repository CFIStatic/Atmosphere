import { useEffect, useState } from 'react';
import {
  api,
  humanize,
  LEAD_SOURCES,
  type CrmAccount,
  type LeadSource,
  type LossType,
  type WorkType,
} from '../../lib/api';
import { CloseIcon, SpinnerIcon } from '../icons';

const LOSS_TYPES: LossType[] = ['water', 'fire', 'mold', 'storm', 'biohazard', 'contents', 'other'];

/** Take a lead in the way it usually arrives: a name, a number, and a hunch. */
export function NewLeadDialog({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: CrmAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<LeadSource>('phone');
  const [workType, setWorkType] = useState<WorkType>('mitigation');
  const [lossType, setLossType] = useState<LossType>('water');
  const [value, setValue] = useState('');
  const [accountId, setAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createLead({
        title: title.trim(),
        source,
        workType,
        lossType,
        estimatedValue: value ? Number(value) : null,
        accountId: accountId || null,
        description: description.trim() || null,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that lead.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div role="dialog" aria-label="New lead" className="glass-panel relative w-full max-w-lg rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink-900">New lead</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-ink-500 hover:text-ink-900">
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <div className="space-y-3.5 px-5 py-4">
          {error && (
            <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {error}
            </p>
          )}

          <Field label="What is it?">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Delgado residence — kitchen supply line"
              className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Came from">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              >
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </select>
            </Field>
            <Field label="Estimated value">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="12400"
                className="glass-field w-full rounded-lg px-3 py-2 text-sm tabular-nums text-ink-900 placeholder-ink-500 outline-none"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind of work">
              <select
                value={workType}
                onChange={(e) => setWorkType(e.target.value as WorkType)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              >
                <option value="mitigation">Mitigation</option>
                <option value="construction">Construction</option>
              </select>
            </Field>
            <Field label="Loss type">
              <select
                value={lossType}
                onChange={(e) => setLossType(e.target.value as LossType)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              >
                {LOSS_TYPES.map((l) => (
                  <option key={l} value={l}>{humanize(l)}</option>
                ))}
              </select>
            </Field>
          </div>

          {accounts.length > 0 && (
            <Field label="Account (optional)">
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              >
                <option value="">No account yet</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Anything else (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Second floor, carpet and pad affected, homeowner home after 4pm."
              className="glass-field w-full resize-none rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
            />
          </Field>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-600 transition hover:text-ink-900"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            Add lead
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-700">{label}</span>
      {children}
    </label>
  );
}
