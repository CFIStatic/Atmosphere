import { cn } from '../../design/cn';

/**
 * Horizontal section bar for the office job file.
 * Matches design Tabs: no vertical cell dividers (those washed out against
 * the selected surface and looked inconsistent), even horizontal padding,
 * and a full-width brand underline on the active tab. Scrolls horizontally
 * on narrow viewports.
 */

export type JobFileSectionId =
  | 'chat'
  | 'happening'
  | 'access'
  | 'videos'
  | 'packet'
  | 'evidence'
  | 'history';

export type JobFileSectionTab = {
  id: JobFileSectionId;
  label: string;
};

export function JobFileSectionBar({
  tabs,
  active,
  onChange,
}: {
  tabs: JobFileSectionTab[];
  active: JobFileSectionId;
  onChange: (id: JobFileSectionId) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border border-line bg-paper-100/80"
      data-testid="job-file-section-bar"
      role="tablist"
      aria-label="Job file sections"
    >
      <div className="flex min-w-max items-stretch px-1">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              id={`job-file-section-${tab.id}`}
              data-testid={`job-file-section-tab-${tab.id}`}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition sm:px-5',
                selected
                  ? 'bg-paper-200/50 text-ink-900'
                  : 'text-ink-500 hover:bg-paper-50/60 hover:text-ink-700',
              )}
            >
              {tab.label}
              {selected ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-sm bg-brand-500"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
