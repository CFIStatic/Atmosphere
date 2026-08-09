import { useNavigate } from 'react-router-dom';
import { Check, Eye, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { Badge, Button, Popover, cn } from '../design';
import { useAuth } from '../context/AuthContext';
import { labelForRole } from '../domain/approvals';
import type { Role } from '../domain/types';
import { themeLabel } from '../lib/theme';
import { useTheme } from './ThemeContext';
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
  const { preference, theme, toggle } = useTheme();
  const navigate = useNavigate();

  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();
  const ThemeIcon = preference === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;

  return (
    <Popover
      align="end"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          // brand-400 rather than a fixed light shade: the token darkens on the
          // off-white ground, so the initials stay legible in both themes.
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500/15 text-2xs font-semibold text-brand-400 transition hover:bg-brand-500/25"
        >
          {initials}
          {isOverridden && (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-canvas bg-state-warn">
              <Eye className="h-2 w-2 text-on-accent" />
            </span>
          )}
        </button>
      }
    >
      <div className="border-b border-line/10 px-2.5 pb-2.5 pt-1.5">
        <p className="truncate text-xs font-medium text-fg">{user?.email}</p>
        <p className="mt-0.5 text-2xs text-fg-3">{labelForRole(actualRole)}</p>
      </div>

      <div className="border-b border-line/10 py-1.5">
        <p className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-fg-4">
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
              r === role ? 'text-fg' : 'text-fg-3 hover:bg-line/5 hover:text-fg-2',
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
          leadingIcon={<ThemeIcon className="h-3.5 w-3.5" />}
          onClick={toggle}
        >
          Appearance: {themeLabel(preference)}
        </Button>
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
          className="w-full justify-start text-fg-3"
          leadingIcon={<LogOut className="h-3.5 w-3.5" />}
          onClick={() => logout()}
        >
          Sign out
        </Button>
      </div>
    </Popover>
  );
}
