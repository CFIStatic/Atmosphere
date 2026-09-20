import { cn } from '../../design/cn';

/**
 * Horizontal section bar for the office job file.
 * Active tab: lighter surface + brand (orange) underline. Inactive: muted.
 * Content for each section lives in the parent — this only switches.
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
      <div className="flex min-w-max">
        {tabs.map((tab, index) => {
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
                'relative px-3.5 py-2.5 text-sm font-medium transition sm:px-4',
                index > 0 && 'border-l border-line',
                selected
                  ? 'bg-paper-200/70 text-ink-900'
                  : 'text-ink-500 hover:bg-paper-50 hover:text-ink-700',
              )}
            >
              {tab.label}
              {selected ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
