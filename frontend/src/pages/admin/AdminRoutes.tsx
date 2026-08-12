/**
 * Route guards for the internal admin portal.
 *
 * These decide what to RENDER; the API re-checks platform_staff on every call.
 */

import { Navigate, Route, Routes } from 'react-router-dom';
import { usePlatformAdminAccess } from '../../hooks/usePlatformAdmin';
import { scopeAtLeast } from '../../lib/adminApi';
import { AdminLoading, AdminShell } from './AdminShell';
import { AccountsTab } from './AccountsTab';
import { UsersTab } from './UsersTab';
import { InfrastructureTab } from './InfrastructureTab';
import { DatabaseTab } from './DatabaseTab';
import { AuditTab } from './AuditTab';

export function AdminPortalRoute() {
  const { access, loading } = usePlatformAdminAccess();

  if (loading) return <AdminLoading />;
  if (!access?.scope) return <NoAccess />;

  const scope = access.scope;

  return (
    <Routes>
      <Route
        index
        element={
          <AdminShell
            scope={scope}
            title="Accounts"
            strapline="Every Atmosphere customer organization — membership, billing, and activity at a glance."
          >
            <AccountsTab />
          </AdminShell>
        }
      />
      <Route
        path="users"
        element={
          <AdminShell
            scope={scope}
            title="Users"
            strapline="Look up any account holder, reset passwords, and manage access for support."
          >
            <UsersTab scope={scope} />
          </AdminShell>
        }
      />
      <Route
        path="infrastructure"
        element={
          scopeAtLeast(scope, 'ops') ? (
            <AdminShell
              scope={scope}
              title="Infrastructure"
              strapline="Backend health, dependency checks, and high-level table counts."
            >
              <InfrastructureTab />
            </AdminShell>
          ) : (
            <Navigate to="/admin" replace />
          )
        }
      />
      <Route
        path="database"
        element={
          scopeAtLeast(scope, 'ops') ? (
            <AdminShell
              scope={scope}
              title="Database"
              strapline="Curated read-only browser for support-safe tables. Filter by org when needed."
            >
              <DatabaseTab />
            </AdminShell>
          ) : (
            <Navigate to="/admin" replace />
          )
        }
      />
      <Route
        path="audit"
        element={
          <AdminShell
            scope={scope}
            title="Audit log"
            strapline="Every mutating support action taken in this portal."
          >
            <AuditTab />
          </AdminShell>
        }
      />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

function NoAccess() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-900 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-white">Internal portal is restricted</h1>
        <p className="mt-2 text-sm text-gray-400">
          Global customer support tools are limited to Atmosphere staff who have been granted
          platform access. Ask an ops administrator if you need it.
        </p>
        <a
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Back to Atmosphere
        </a>
      </div>
    </div>
  );
}
