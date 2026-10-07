import { PageHeader } from '../components/report';
import { EmptyState } from '../components/ui';

/**
 * Hidden from the sidebar (analytics audit 2026-10-07): the experiment tables
 * were removed and nothing is instrumented. Old links land on this honest
 * empty state instead of a table of zeros.
 */
export function ExperimentsPage() {
  return (
    <div>
      <PageHeader eyebrow="Growth & revenue" title="Experiments" />
      <EmptyState
        title="No experiments are running"
        body="Nothing is instrumented: the experiment tables were removed, so there are no assignments, exposures or conversions to report. This page returns when an experiment is wired up."
      />
    </div>
  );
}
