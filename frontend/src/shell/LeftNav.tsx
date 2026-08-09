import { NavLink } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { cn } from '../design';
import { canSee } from '../domain/permissions';
import type { Role } from '../domain/types';
import { NAV_SECTIONS } from './navigation';

interface LeftNavProps {
  role: Role;
  counts: { approvals: number; 'my-work': number };
  /** Rendered inside a mobile drawer. */
  variant?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}

export function LeftNav({
  role,
  counts,
  variant = 'desktop',
  onNavigate,
}: LeftNavProps) {
  const isMobile = variant === 'mobile';

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(role, item.key)),
  })).filter((section) => section.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col border-r border-line/10 bg-sunken/80 backdrop-blur-xl',
        isMobile ? 'w-full' : 'w-nav',
      )}
    >
      <div className="flex h-topbar shrink-0 items-center border-b border-line/10 px-4">
        <Logo />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            <p className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-4">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const count = item.badge ? counts[item.badge] : 0;

                return (
                  <li key={item.key} className="relative">
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition',
                          isActive
                            ? 'bg-brand-600/15 text-fg'
                            : 'text-fg-3 hover:bg-line/5 hover:text-fg',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isActive ? 'text-brand-300' : 'text-fg-3 group-hover:text-fg-2',
                            )}
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-state-warn/20 px-1.5 py-0.5 text-2xs font-semibold text-state-warn">
                              {count}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
