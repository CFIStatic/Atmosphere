import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Bot, Building2, CheckSquare, Gauge, ListTodo } from 'lucide-react';
import { cn } from '../design';
import { canSee, type NavKey } from '../domain/permissions';
import type { Role } from '../domain/types';
import { LeftNav } from './LeftNav';

interface Counts {
  approvals: number;
  'my-work': number;
}

/**
 * Navigation below `lg`.
 *
 * Two surfaces, not one: a bottom bar carrying the handful of destinations
 * someone in the field actually taps, and a full drawer for everything else.
 * A hamburger alone would bury My Work behind two taps for the role that lives
 * in it all day.
 */
export function MobileNav({
  open,
  onOpenChange,
  role,
  counts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  counts: Counts;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className="fixed inset-0 z-50 lg:hidden"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-scrim/70 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[min(17rem,80vw)] animate-slide-in-right">
            <LeftNav
              role={role}
              counts={counts}
              variant="mobile"
              onNavigate={() => onOpenChange(false)}
            />
          </div>
        </div>
      )}

      <BottomBar role={role} counts={counts} />
    </>
  );
}

const BOTTOM_ITEMS: { key: NavKey; label: string; to: string; icon: typeof Gauge }[] = [
  { key: 'overview', label: 'Overview', to: '/overview', icon: Gauge },
  { key: 'my-work', label: 'My Work', to: '/my-work', icon: ListTodo },
  { key: 'jobs', label: 'Jobs', to: '/jobs', icon: Building2 },
  { key: 'approvals', label: 'Approve', to: '/approvals', icon: CheckSquare },
  { key: 'agents', label: 'Agents', to: '/agents', icon: Bot },
];

function BottomBar({ role, counts }: { role: Role; counts: Counts }) {
  const items = BOTTOM_ITEMS.filter((item) => canSee(role, item.key)).slice(0, 5);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line/10 bg-sunken/95 backdrop-blur-xl sm:hidden"
      // Keeps the bar clear of the iOS home indicator.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const count =
          item.key === 'approvals'
            ? counts.approvals
            : item.key === 'my-work'
              ? counts['my-work']
              : 0;

        return (
          <NavLink
            key={item.key}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs font-medium transition',
                isActive ? 'text-brand-300' : 'text-fg-3',
              )
            }
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1 min-w-[1rem] rounded-full bg-state-warn px-1 text-center text-[9px] font-bold leading-4 text-on-accent">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </span>
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
