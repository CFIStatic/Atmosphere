import { useNavigate } from 'react-router-dom';
import { Check, Eye, LogOut, User } from 'lucide-react';
import { Badge, Button, Popover, cn } from '../design';
import { useAuth } from '../context/AuthContext';
import { labelForRole } from '../domain/approvals';
import type { Role } from '../domain/types';
import { useViewer } from './ViewerContext';

const ROLES: Role[] = [
  'field_technician',
  'sales',
  'accountant',
  'project_manager',
  'office_manager',
  'executive',
];

export function UserMenu() {
  const { user, logout } = useAuth();
  const { role, actualRole, isOverridden, viewAs } = useViewer();
  const navigate = useNavigate();

  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <Popover
      align="end"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600/30 text-2xs font-semibold text-brand-200 transition hover:bg-brand-600/50"
        >
          {initials}
          {isOverridden && (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-ink-900 bg-state-warn">
              <Eye className="h-2 w-2 text-ink-900" />
            </span>
          )}
        </button>
      }
    >
      <div className="border-b border-white/10 px-2.5 pb-2.5 pt-1.5">
        <p className="truncate text-xs font-medium text-white">{user?.email}</p>
        <p className="mt-0.5 text-2xs text-gray-500">{labelForRole(actualRole)}</p>
      </div>

      <div className="border-b border-white/10 py-1.5">
        <p className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-gray-600">
          View as
        </p>
        {/* Presentation-only. The server still authorises by the real role, so
            this cannot be used to reach data the user is not entitled to. */}
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => viewAs(r === actualRole ? null : r)}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition',
              r === role ? 'text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
            )}
          >
            <span>{labelForRole(r)}</span>
            {r === role && <Check className="h-3.5 w-3.5 text-brand-400" />}
          </button>
        ))}
        {isOverridden && (
          <div className="px-2.5 pt-1.5">
            <Badge tone="warn">Viewing as {labelForRole(role)}</Badge>
          </div>
        )}
      </div>

      <div className="pt-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          leadingIcon={<User className="h-3.5 w-3.5" />}
          onClick={() => navigate('/settings')}
        >
          Settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-400"
          leadingIcon={<LogOut className="h-3.5 w-3.5" />}
          onClick={() => logout()}
        >
          Sign out
        </Button>
      </div>
    </Popover>
  );
}
