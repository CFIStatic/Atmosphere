import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Logo } from '../components/Logo';
import { cn, Tooltip } from '../design';
import { canSee } from '../domain/permissions';
import type { Role } from '../domain/types';
import { NAV_SECTIONS } from './navigation';

interface LeftNavProps {
  role: Role;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  counts: { approvals: number; 'my-work': number };
  /** Rendered inside a mobile drawer — hides the collapse control. */
  variant?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}

export function LeftNav({
  role,
  collapsed,
  onToggleCollapsed,
  counts,
  variant = 'desktop',
  onNavigate,
}: LeftNavProps) {
  const isMobile = variant === 'mobile';
  const showLabels = isMobile || !collapsed;

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(role, item.key)),
  })).filter((section) => section.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col border-r border-white/10 bg-ink-950/80 backdrop-blur-xl',
        isMobile ? 'w-full' : collapsed ? 'w-nav-collapsed' : 'w-nav',
        'transition-[width] duration-200',
      )}
    >
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center border-b border-white/10',
          showLabels ? 'justify-between px-4' : 'justify-center px-2',
        )}
      >
        {showLabels ? <Logo /> : <Logo className="[&_span:last-child]:hidden" />}
        {!isMobile && showLabels && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse navigation"
            className="rounded-md p-1 text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {!isMobile && collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand navigation"
          className="mx-auto mt-2 rounded-md p-1.5 text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            {showLabels && (
              <p className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-gray-600">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const count = item.badge ? counts[item.badge] : 0;

                const link = (
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition',
                        showLabels ? 'justify-start' : 'justify-center',
                        isActive
                          ? 'bg-brand-600/15 text-white'
                          : 'text-gray-400 hover:bg-white/5 hover:text-gray-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isActive ? 'text-brand-300' : 'text-gray-500 group-hover:text-gray-300',
                          )}
                        />
                        {showLabels && <span className="flex-1 truncate">{item.label}</span>}
                        {count > 0 &&
                          (showLabels ? (
                            <span className="rounded-full bg-state-warn/20 px-1.5 py-0.5 text-2xs font-semibold text-state-warn">
                              {count}
                            </span>
                          ) : (
                            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-state-warn" />
                          ))}
                      </>
                    )}
                  </NavLink>
                );

                return (
                  <li key={item.key} className="relative">
                    {showLabels ? (
                      link
                    ) : (
                      <Tooltip content={item.label} side="right">
                        <div>{link}</div>
                      </Tooltip>
                    )}
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
