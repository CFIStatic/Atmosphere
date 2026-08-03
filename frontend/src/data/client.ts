import type {
  Agent,
  AgentRun,
  ApprovalRequest,
  Communication,
  Customer,
  Estimate,
  Connection,
  Invoice,
  Job,
  JobDocument,
  MetricTile,
  Recommendation,
  ScheduleEvent,
  Task,
  TimelineEvent,
  Workflow,
} from '../domain/types';
import { canTransition } from '../domain/approvals';
import * as seed from './fixtures';

/**
 * The data seam.
 *
 * Every screen reads through this module and nothing else. Today it resolves
 * from in-memory fixtures; when DASH, Xactimate, and QuickBooks are wired, the
 * function bodies become fetches to the BFF and not one component changes.
 *
 * The deliberate constraint: everything is async and nothing returns a mutable
 * reference into the store, so no component can accidentally depend on
 * synchronous access or mutate shared state.
 */

/** Simulated network latency, so loading states are exercised in development. */
const LATENCY_MS = 140;

function resolve<T>(value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(structuredClone(value)), LATENCY_MS));
}

// Mutable session state. Approving something actually changes it, which is what
// makes the execution and evidence states demonstrable rather than static art.
let approvals: ApprovalRequest[] = structuredClone(seed.APPROVALS);
let tasks: Task[] = structuredClone(seed.TASKS);
let connections: Connection[] = structuredClone(seed.CONNECTIONS);
const agentRuns: AgentRun[] = structuredClone(seed.AGENT_RUNS);

// ── Reads ───────────────────────────────────────────────────────────────────

export const dataClient = {
  jobs: {
    list: (): Promise<Job[]> => resolve(seed.JOBS),
    get: (id: string): Promise<Job | null> => resolve(seed.JOBS.find((j) => j.id === id) ?? null),
    timeline: (jobId: string): Promise<TimelineEvent[]> =>
      resolve(
        seed.TIMELINE.filter((t) => t.jobId === jobId).sort(
          (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
        ),
      ),
    documents: (jobId: string): Promise<JobDocument[]> =>
      resolve(seed.DOCUMENTS.filter((d) => d.jobId === jobId)),
    communications: (jobId: string): Promise<Communication[]> =>
      resolve(
        seed.COMMUNICATIONS.filter((c) => c.jobId === jobId).sort(
          (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
        ),
      ),
  },

  tasks: {
    list: (): Promise<Task[]> => resolve(tasks),
    forJob: (jobId: string): Promise<Task[]> => resolve(tasks.filter((t) => t.jobId === jobId)),
    forAssignee: (userId: string): Promise<Task[]> =>
      resolve(tasks.filter((t) => t.assigneeId === userId)),
    setStatus: async (id: string, status: Task['status']): Promise<Task | null> => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status } : t));
      return resolve(tasks.find((t) => t.id === id) ?? null);
    },
  },

  approvals: {
    list: (): Promise<ApprovalRequest[]> => resolve(approvals),
    get: (id: string): Promise<ApprovalRequest | null> =>
      resolve(approvals.find((a) => a.id === id) ?? null),
    approve: (id: string): Promise<ApprovalRequest | null> => {
      transition(id, 'approved');
      // Execution begins immediately; steps advance on a timer below.
      beginExecution(id);
      return resolve(approvals.find((a) => a.id === id) ?? null);
    },
    reject: (id: string): Promise<ApprovalRequest | null> => {
      transition(id, 'rejected');
      return resolve(approvals.find((a) => a.id === id) ?? null);
    },
  },

  agents: {
    list: (): Promise<Agent[]> => resolve(seed.AGENTS),
    get: (id: string): Promise<Agent | null> =>
      resolve(seed.AGENTS.find((a) => a.id === id) ?? null),
    runs: (agentId?: string): Promise<AgentRun[]> =>
      resolve(
        (agentId ? agentRuns.filter((r) => r.agentId === agentId) : agentRuns).sort(
          (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
        ),
      ),
  },

  recommendations: {
    list: (): Promise<Recommendation[]> => resolve(seed.RECOMMENDATIONS),
  },

  customers: {
    list: (): Promise<Customer[]> => resolve(seed.CUSTOMERS),
    get: (id: string): Promise<Customer | null> =>
      resolve(seed.CUSTOMERS.find((c) => c.id === id) ?? null),
  },

  estimates: {
    list: (): Promise<Estimate[]> => resolve(seed.ESTIMATES),
  },

  invoices: {
    list: (): Promise<Invoice[]> => resolve(seed.INVOICES),
  },

  schedule: {
    list: (): Promise<ScheduleEvent[]> =>
      resolve(
        [...seed.SCHEDULE].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
        ),
      ),
  },

  workflows: {
    list: (): Promise<Workflow[]> => resolve(seed.WORKFLOWS),
  },

  connections: {
    list: (): Promise<Connection[]> => resolve(connections),
    get: (id: string): Promise<Connection | null> =>
      resolve(connections.find((c) => c.id === id) ?? null),

    /**
     * Real providers need an OAuth round-trip, an agent install, or a human at
     * a carrier to approve the request. Until those exist this flips the record
     * so the surrounding UI — dependent agents, sync state, the health banner —
     * can be exercised against something that actually changes.
     */
    connect: async (id: string): Promise<Connection | null> => {
      connections = connections.map((c) =>
        c.id === id
          ? {
              ...c,
              status: 'connected',
              lastSyncAt: new Date().toISOString(),
              recordsSynced: c.recordsSynced ?? 0,
              issue: null,
              accountLabel: c.accountLabel ?? 'Lone Star Restoration',
            }
          : c,
      );
      return resolve(connections.find((c) => c.id === id) ?? null);
    },

    disconnect: async (id: string): Promise<Connection | null> => {
      connections = connections.map((c) =>
        c.id === id
          ? { ...c, status: 'disconnected', issue: null, lastSyncAt: null, accountLabel: null }
          : c,
      );
      return resolve(connections.find((c) => c.id === id) ?? null);
    },

    /** Clears a degraded/error state the way a successful retry would. */
    resync: async (id: string): Promise<Connection | null> => {
      connections = connections.map((c) =>
        c.id === id
          ? { ...c, status: 'connected', issue: null, lastSyncAt: new Date().toISOString() }
          : c,
      );
      return resolve(connections.find((c) => c.id === id) ?? null);
    },
  },

  metrics: {
    list: (): Promise<MetricTile[]> => resolve(seed.METRICS),
  },

  people: {
    list: () => resolve(seed.PEOPLE),
  },
};

// ── Approval execution simulation ───────────────────────────────────────────

function transition(id: string, to: ApprovalRequest['status']): void {
  approvals = approvals.map((a) => {
    if (a.id !== id) return a;
    if (!canTransition(a.status, to)) return a;
    return { ...a, status: to };
  });
}

function patch(id: string, fn: (a: ApprovalRequest) => ApprovalRequest): void {
  approvals = approvals.map((a) => (a.id === id ? fn(a) : a));
}

/**
 * Walk an approved request through its steps on a timer.
 *
 * This exists so the execution-progress and evidence states are real rather
 * than mocked screenshots — when the backend lands, this whole function is
 * replaced by streamed status from the agent runtime.
 */
function beginExecution(id: string): void {
  const request = approvals.find((a) => a.id === id);
  if (!request) return;

  transition(id, 'executing');

  const stepDelay = 900;
  request.steps.forEach((_, index) => {
    // Mark running, then done, so the UI shows a genuine in-flight step.
    setTimeout(() => {
      patch(id, (a) => ({
        ...a,
        steps: a.steps.map((s, i) => (i === index ? { ...s, status: 'running' } : s)),
      }));
    }, index * stepDelay);

    setTimeout(
      () => {
        patch(id, (a) => ({
          ...a,
          steps: a.steps.map((s, i) => (i === index ? { ...s, status: 'done' } : s)),
        }));
      },
      index * stepDelay + stepDelay * 0.8,
    );
  });

  // Complete, attaching evidence of what actually happened.
  setTimeout(
    () => {
      patch(id, (a) => ({
        ...a,
        status: 'completed',
        evidence:
          a.evidence.length > 0
            ? a.evidence
            : a.changes.map((c, i) => ({
                label: `${c.entity} — ${c.field} updated`,
                kind: 'record' as const,
                reference: `${a.jobNumber ?? 'SYS'}-${String(i + 1).padStart(3, '0')}`,
              })),
      }));
    },
    request.steps.length * stepDelay + 400,
  );
}

/** True while any approval is mid-execution — drives polling in the UI. */
export function hasExecutingApprovals(list: ApprovalRequest[]): boolean {
  return list.some((a) => a.status === 'executing' || a.status === 'approved');
}
