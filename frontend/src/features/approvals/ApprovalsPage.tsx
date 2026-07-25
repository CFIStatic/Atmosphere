import { useMemo, useState } from 'react';
import { CheckCircle2, Inbox } from 'lucide-react';
import { EmptyState, SegmentedControl, Skeleton } from '../../design';
import { ActionProposal, PageBody, PageHeader } from '../../patterns';
import { useApprovals, useApproveRequest, useRejectRequest } from '../../data/hooks';
import { compareUrgency } from '../../domain/approvals';
import { money } from '../../domain/format';
import { useViewer } from '../../shell/ViewerContext';
import type { ApprovalStatus } from '../../domain/types';

type Filter = 'pending' | 'in_flight' | 'resolved' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Needs approval' },
  { value: 'in_flight', label: 'Executing' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const MATCHES: Record<Filter, (s: ApprovalStatus) => boolean> = {
  pending: (s) => s === 'proposed',
  in_flight: (s) => s === 'approved' || s === 'executing',
  resolved: (s) => s === 'completed' || s === 'rejected' || s === 'failed' || s === 'expired',
  all: () => true,
};

/**
 * "What needs attention?" — one queue for every agent-proposed action.
 *
 * Unified deliberately: an operator should never have to remember that
 * collections approvals live somewhere different from scheduling ones. Ordering
 * is `compareUrgency` — expiry first, then risk, then money — so the top of the
 * list is always the thing that costs most to ignore.
 */
export function ApprovalsPage() {
  const { role } = useViewer();
  const [filter, setFilter] = useState<Filter>('pending');

  const { data: approvals = [], isLoading } = useApprovals();
  const approve = useApproveRequest();
  const reject = useRejectRequest();

  const visible = useMemo(
    () => approvals.filter((a) => MATCHES[filter](a.status)).sort(compareUrgency),
    [approvals, filter],
  );

  const pendingCount = approvals.filter((a) => a.status === 'proposed').length;
  const valuePending = approvals
    .filter((a) => a.status === 'proposed')
    .reduce((sum, a) => sum + (a.valueAtStake ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          pendingCount > 0
            ? `${pendingCount} action${pendingCount === 1 ? '' : 's'} awaiting sign-off · ${money(valuePending)} at stake`
            : 'Nothing is waiting on you'
        }
      >
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={FILTERS}
          aria-label="Filter approvals"
        />
      </PageHeader>

      <PageBody>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={
              filter === 'pending' ? (
                <CheckCircle2 className="h-7 w-7" />
              ) : (
                <Inbox className="h-7 w-7" />
              )
            }
            title={filter === 'pending' ? 'Approval queue is clear' : 'Nothing here'}
            description={
              filter === 'pending'
                ? 'Every proposed action has been reviewed. Atmosphere will surface new ones as they come up.'
                : 'Try a different filter to see other requests.'
            }
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {visible.map((request) => (
              <ActionProposal
                key={request.id}
                request={request}
                role={role}
                onApprove={(id) => approve.mutate(id)}
                onReject={(id) => reject.mutate(id)}
                busy={
                  (approve.isPending && approve.variables === request.id) ||
                  (reject.isPending && reject.variables === request.id)
                }
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
