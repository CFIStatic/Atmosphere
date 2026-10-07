import type { LucideIcon } from 'lucide-react';
import {
  BadgeDollarSign,
  BarChart3,
  Bot,
  Building2,
  Clapperboard,
  Coins,
  Contact,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  Scale,
  Server,
  ShieldCheck,
  Star,
  UploadCloud,
  Wallet,
  Receipt,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  internal?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Grouped like a report's table of contents. Internal-only rows hide for
 * investors, and a group with nothing left to show disappears.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Summary',
    items: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/north-star', label: 'North star', icon: Star },
    ],
  },
  {
    title: 'Growth & revenue',
    items: [
      { to: '/growth', label: 'Revenue & customers', icon: BadgeDollarSign },
      { to: '/accounts', label: 'Organizations', icon: Building2, internal: true },
      { to: '/experiments', label: 'Experiments', icon: FlaskConical, internal: true },
    ],
  },
  {
    title: 'Product',
    items: [
      { to: '/usage', label: 'Feature usage', icon: BarChart3 },
      { to: '/capture', label: 'Capture pipeline', icon: UploadCloud },
      { to: '/ai', label: 'Ask quality', icon: MessageSquareText },
      { to: '/motion-clips', label: 'Motion clips', icon: Clapperboard, internal: true },
    ],
  },
  {
    title: 'AI cost & usage',
    items: [
      { to: '/token-usage', label: 'Token usage', icon: Coins, internal: true },
      { to: '/ai-reconciliation', label: 'Cost reconciliation', icon: Receipt, internal: true },
      { to: '/ai-budgets', label: 'AI budgets', icon: Wallet, internal: true },
      { to: '/metering', label: 'Metering', icon: Gauge, internal: true },
      { to: '/computer-practice', label: 'Computer practice', icon: Bot, internal: true },
    ],
  },
  {
    title: 'Contacts & campaigns',
    items: [
      { to: '/contacts', label: 'Contacts', icon: Contact, internal: true },
      { to: '/campaigns', label: 'Campaigns', icon: Mail, internal: true },
    ],
  },
  {
    title: 'System & access',
    items: [
      { to: '/access', label: 'Access', icon: ShieldCheck, internal: true },
      { to: '/legal', label: 'Legal holds', icon: Scale, internal: true },
      { to: '/system', label: 'System status', icon: Server },
    ],
  },
];
