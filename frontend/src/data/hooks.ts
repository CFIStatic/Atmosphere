import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataClient, hasExecutingApprovals } from './client';
import type { Task } from '../domain/types';

/**
 * React Query bindings over the data seam.
 *
 * Components use these rather than calling `dataClient` directly, so caching,
 * loading, and refetch policy live in one place. Query keys are namespaced by
 * entity so a mutation can invalidate precisely what it affected.
 */

const keys = {
  jobs: ['jobs'] as const,
  job: (id: string) => ['jobs', id] as const,
  jobTimeline: (id: string) => ['jobs', id, 'timeline'] as const,
  jobDocuments: (id: string) => ['jobs', id, 'documents'] as const,
  jobComms: (id: string) => ['jobs', id, 'communications'] as const,
  jobTasks: (id: string) => ['jobs', id, 'tasks'] as const,
  tasks: ['tasks'] as const,
  approvals: ['approvals'] as const,
  agents: ['agents'] as const,
  agentRuns: (id?: string) => ['agents', 'runs', id ?? 'all'] as const,
  recommendations: ['recommendations'] as const,
  customers: ['customers'] as const,
  estimates: ['estimates'] as const,
  invoices: ['invoices'] as const,
  schedule: ['schedule'] as const,
  workflows: ['workflows'] as const,
  integrations: ['integrations'] as const,
  metrics: ['metrics'] as const,
  people: ['people'] as const,
};

export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: dataClient.jobs.list });
export const useJob = (id: string) =>
  useQuery({ queryKey: keys.job(id), queryFn: () => dataClient.jobs.get(id) });
export const useJobTimeline = (id: string) =>
  useQuery({ queryKey: keys.jobTimeline(id), queryFn: () => dataClient.jobs.timeline(id) });
export const useJobDocuments = (id: string) =>
  useQuery({ queryKey: keys.jobDocuments(id), queryFn: () => dataClient.jobs.documents(id) });
export const useJobCommunications = (id: string) =>
  useQuery({ queryKey: keys.jobComms(id), queryFn: () => dataClient.jobs.communications(id) });
export const useJobTasks = (id: string) =>
  useQuery({ queryKey: keys.jobTasks(id), queryFn: () => dataClient.tasks.forJob(id) });

export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: dataClient.tasks.list });

export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Task['status'] }) =>
      dataClient.tasks.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tasks });
      qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}

/**
 * Approvals poll while anything is executing so step progress animates without
 * a websocket. Once the agent runtime streams status, `refetchInterval` goes away.
 */
export const useApprovals = () =>
  useQuery({
    queryKey: keys.approvals,
    queryFn: dataClient.approvals.list,
    refetchInterval: (query) => (hasExecutingApprovals(query.state.data ?? []) ? 600 : false),
  });

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataClient.approvals.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.approvals }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataClient.approvals.reject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.approvals }),
  });
}

export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: dataClient.agents.list });
export const useAgentRuns = (agentId?: string) =>
  useQuery({ queryKey: keys.agentRuns(agentId), queryFn: () => dataClient.agents.runs(agentId) });
export const useRecommendations = () =>
  useQuery({ queryKey: keys.recommendations, queryFn: dataClient.recommendations.list });
export const useCustomers = () =>
  useQuery({ queryKey: keys.customers, queryFn: dataClient.customers.list });
export const useEstimates = () =>
  useQuery({ queryKey: keys.estimates, queryFn: dataClient.estimates.list });
export const useInvoices = () =>
  useQuery({ queryKey: keys.invoices, queryFn: dataClient.invoices.list });
export const useSchedule = () =>
  useQuery({ queryKey: keys.schedule, queryFn: dataClient.schedule.list });
export const useWorkflows = () =>
  useQuery({ queryKey: keys.workflows, queryFn: dataClient.workflows.list });
export const useIntegrations = () =>
  useQuery({ queryKey: keys.integrations, queryFn: dataClient.integrations.list });
export const useMetrics = () =>
  useQuery({ queryKey: keys.metrics, queryFn: dataClient.metrics.list });
export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: dataClient.people.list });
