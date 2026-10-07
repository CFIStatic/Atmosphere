import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { canManageAccess } from '../lib/access';
import type { AccessRequest } from '../lib/types';
import { EmptyState, StatusPill } from '../components/ui';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';

function requestsSheet(name: string, rows: AccessRequest[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'Employee' },
      { header: 'Email' },
      { header: 'Status' },
      { header: 'Last requested', type: 'datetime' },
    ],
    rows: rows.map((row) => [fullName(row), row.email, row.status, row.lastRequestedAt]),
  };
}

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
    return <Loading label="Loading access requests" />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="System & access"
        title="Access"
        subtitle="Employees who asked to join Atmosphere Analytics. Approve them here; they then sign in with the same email and password as their Atmosphere Platform account."
        actions={
          pending.length > 0 ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run('all', async () => {
                  await api.approveAllAccessRequests();
                })
              }
              className="btn-primary"
            >
              {busy === 'all' ? 'Approving…' : `Approve all (${pending.length})`}
            </button>
          ) : undefined
        }
      />

      {error && <ErrorLine message={error} />}

      <Section
        title="Waiting for approval"
        note={pending.length === 1 ? '1 employee' : `${pending.length} employees`}
        actions={
          <DownloadButton
            table="access-requests-pending"
            label="pending access requests"
            disabled={pending.length === 0}
            sheets={() => [requestsSheet('Waiting for approval', pending)]}
          />
        }
      >
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

      </Section>

      {reviewed.length > 0 && (
        <Section
          title="Reviewed"
          note={`${reviewed.length} recent`}
          actions={
            <DownloadButton
              table="access-requests-reviewed"
              label="reviewed access requests"
              sheets={() => [requestsSheet('Reviewed', reviewed)]}
            />
          }
        >
          <RequestTable rows={reviewed} busy={busy} />
        </Section>
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
    <div className="overflow-x-auto">
      <table className="report-table min-w-[640px]">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Email</th>
            <th>Requested</th>
            <th>Status</th>
            {onApprove && <th className="num">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="font-medium text-ink-900">{fullName(row)}</td>
              <td className="text-ink-600">{row.email}</td>
              <td className="whitespace-nowrap text-ink-600">{requestedLabel(row.lastRequestedAt)}</td>
              <td>
                <StatusPill status={row.status} />
              </td>
              {onApprove && (
                <td className="num">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onApprove(row.id)}
                      className="btn-primary px-2.5 py-1 text-[12px]"
                    >
                      {busy === row.id ? 'Saving…' : 'Approve'}
                    </button>
                    {onDeny && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onDeny(row.id)}
                        className="btn px-2.5 py-1 text-[12px]"
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
