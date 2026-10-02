import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { canSeeAccounts } from '../lib/access';

/** Internal-scope pages (contacts, campaigns). The API enforces the same rule. */
export function RequireInternal({ children }: { children: ReactNode }) {
  const { access } = useAuth();
  if (!canSeeAccounts(access?.scope)) {
    return (
      <div className="mt-10 max-w-lg border-t-2 border-rule pt-4">
        <h1 className="text-[22px]">Atmosphere staff only</h1>
        <p className="mt-2 text-[13px] text-ink-600">
          Customer contacts and campaigns are limited to internal staff. Investor access covers the summary reports.
        </p>
      </div>
    );
  }
  return children;
}
