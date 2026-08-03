import { useEffect, useState } from 'react';
import {
  api,
  humanize,
  ACCOUNT_TYPES,
  CONTACT_TYPES,
  type AccountType,
  type ContactType,
  type CrmAccount,
} from '../../lib/api';
import { CloseIcon, SpinnerIcon } from '../icons';

/**
 * One dialog for both halves of the customer record: an account is the
 * company, a contact is the person. They are created the same way and belong
 * in the same place, so the tab decides which one you are adding.
 */
export function NewCustomerDialog({
  mode,
  accounts,
  onClose,
  onCreated,
}: {
  mode: 'accounts' | 'contacts';
  accounts: CrmAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const isAccount = mode === 'accounts';

  const [name, setName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('other');
  const [contactType, setContactType] = useState<ContactType>('homeowner');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const valid = isAccount ? name.trim().length > 0 : (firstName.trim() || lastName.trim()).length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isAccount) {
        await api.createAccount({
          name: name.trim(),
          type: accountType,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
        });
      } else {
        await api.createContact({
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          type: contactType,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          accountId: accountId || undefined,
        });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-label={isAccount ? 'New account' : 'New contact'}
        className="glass-panel relative w-full max-w-md rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink-900">
            {isAccount ? 'New account' : 'New contact'}
          </h2>
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

          {isAccount ? (
            <>
              <Field label="Company or household">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  placeholder="Camden Court HOA"
                  className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
                />
              </Field>
              <Field label="What kind">
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>{humanize(t)}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoFocus
                    className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
                  />
                </Field>
                <Field label="Last name">
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
                  />
                </Field>
              </div>
              <Field label="Who are they">
                <select
                  value={contactType}
                  onChange={(e) => setContactType(e.target.value as ContactType)}
                  className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
                >
                  {CONTACT_TYPES.map((t) => (
                    <option key={t} value={t}>{humanize(t)}</option>
                  ))}
                </select>
              </Field>
              {accounts.length > 0 && (
                <Field label="Account (optional)">
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
                  >
                    <option value="">Not attached</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              />
            </Field>
          </div>

          {isAccount && (
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 outline-none"
              />
            </Field>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-600 transition hover:text-ink-900">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !valid}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            {isAccount ? 'Add account' : 'Add contact'}
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
