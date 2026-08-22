import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { canManageAccess } from '../lib/access';
import type { AccessRequest } from '../lib/types';
import { EmptyState, SectionHeading, StatusPill } from '../components/ui';

function fullName(row: AccessRequest): string {
  return `${row.firstName} ${row.lastName}`.replace(/\s+/g, ' ').trim();
}

function requestedLabel(value: string): string {
  return new Date(value).toLocaleString();
}

export function AccessPage() {
  const { access, loadAccess } = useAuth();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.accessRequests();
      setRequests(next.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load access requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(() => requests.filter((row) => row.status === 'pending'), [requests]);
  const reviewed = useMemo(() => requests.filter((row) => row.status !== 'pending'), [requests]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      await Promise.all([load(), loadAccess()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that request.');
    } finally {
      setBusy(null);
    }
  }

  if (!canManageAccess(access?.scope)) {
    return <Navigate to="/overview" replace />;
  }

  if (loading && requests.length === 0) {
    return <p className="text-ink-500">Loading access requests…</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access</h1>
          <p className="mt-1 text-sm text-ink-500">
            Employees who asked to join Internal Growth Metrics. Approve them here — they can
            finish Microsoft Authenticator sign-in after you grant access.
          </p>
        </div>
        {pending.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('all', async () => {
                await api.approveAllAccessRequests();
              })
            }
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
          >
            {busy === 'all' ? 'Approving…' : `Approve all (${pending.length})`}
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <SectionHeading
        title="Waiting for approval"
        hint={pending.length === 1 ? '1 employee' : `${pending.length} employees`}
      />
      {pending.length === 0 ? (
        <EmptyState
          title="No pending requests"
          body="When someone who is not yet on the staff list tries to sign in, they land here."
        />
      ) : (
        <RequestTable
          rows={pending}
          busy={busy}
          onApprove={(id) => void run(id, () => api.approveAccessRequest(id).then(() => undefined))}
          onDeny={(id) => void run(id, () => api.denyAccessRequest(id).then(() => undefined))}
        />
      )}

      {reviewed.length > 0 && (
        <>
          <SectionHeading title="Reviewed" hint={`${reviewed.length} recent`} />
          <RequestTable rows={reviewed} busy={busy} />
        </>
      )}
    </div>
  );
}

function RequestTable({
  rows,
  busy,
  onApprove,
  onDeny,
}: {
  rows: AccessRequest[];
  busy: string | null;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
      <table className="w-full text-sm">
        <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Requested</th>
            <th className="px-4 py-3">Status</th>
            {onApprove && <th className="px-4 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-4 py-3 font-medium">{fullName(row)}</td>
              <td className="px-4 py-3 font-mono text-ink-600">{row.email}</td>
              <td className="px-4 py-3 text-ink-500">{requestedLabel(row.lastRequestedAt)}</td>
              <td className="px-4 py-3">
                <StatusPill status={row.status} />
              </td>
              {onApprove && (
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onApprove(row.id)}
                      className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-60"
                    >
                      {busy === row.id ? 'Saving…' : 'Approve'}
                    </button>
                    {onDeny && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onDeny(row.id)}
                        className="rounded-md px-3 py-1 text-xs text-ink-500 hover:bg-paper-200 hover:text-ink-800 disabled:opacity-60"
                      >
                        Deny
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
