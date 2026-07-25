import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Optional count shown after the label, e.g. open task count. */
  count?: number;
}

export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List className="flex gap-1 overflow-x-auto border-b border-white/10">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'relative whitespace-nowrap px-3 py-2.5 text-sm font-medium text-gray-400 transition',
              'hover:text-gray-200 focus-visible:outline-none focus-visible:text-white',
              'data-[state=active]:text-white',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              'data-[state=active]:after:bg-brand-400',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-2xs text-gray-400">
                {item.count}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const TabPanel = TabsPrimitive.Content;
