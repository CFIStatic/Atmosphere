import {
  Bot,
  Building2,
  CalendarDays,
  CheckSquare,
  FileText,
  Gauge,
  Layers,
  ListTodo,
  Cable,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavKey } from '../domain/permissions';

/**
 * Navigation definition.
 *
 * Twelve flat entries read as a dump, so they are banded by how the work
 * actually flows: what you operate today, what you deliver, what you get paid
 * for, what runs itself, and what you configure once.
 */

export interface NavItem {
  key: NavKey;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Query key whose count is surfaced as a badge, when relevant. */
  badge?: 'approvals' | 'my-work';
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { key: 'overview', label: 'Overview', to: '/overview', icon: Gauge },
      { key: 'my-work', label: 'My Work', to: '/my-work', icon: ListTodo, badge: 'my-work' },
      {
        key: 'approvals',
        label: 'Approvals',
        to: '/approvals',
        icon: CheckSquare,
        badge: 'approvals',
      },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    items: [
      { key: 'jobs', label: 'Jobs', to: '/jobs', icon: Building2 },
      { key: 'schedule', label: 'Schedule', to: '/schedule', icon: CalendarDays },
      { key: 'estimates', label: 'Estimates', to: '/estimates', icon: FileText },
      { key: 'customers', label: 'Customers', to: '/customers', icon: Users },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [{ key: 'financials', label: 'Financials', to: '/financials', icon: Wallet }],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { key: 'agents', label: 'Agents', to: '/agents', icon: Bot },
      { key: 'workflows', label: 'Workflows', to: '/workflows', icon: Layers },
    ],
  },
  {
    id: 'connected',
    label: 'Connected Systems',
    items: [{ key: 'connections', label: 'Connections', to: '/connections', icon: Cable }],
  },
  {
    id: 'system',
    label: 'System',
    items: [{ key: 'settings', label: 'Settings', to: '/settings', icon: Settings }],
  },
];

/** Flattened lookup for breadcrumbs and page titles. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function navItemFor(pathname: string): NavItem | undefined {
  // Longest match wins so /jobs/:id resolves to Jobs rather than a false prefix.
  return [...NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}
