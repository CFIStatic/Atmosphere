import { useCallback, useEffect, useState } from 'react';
import { api, type SafetyIncident } from '../../lib/api';
import { SafetyAlertBanner } from './SafetyAlertBanner';

/** Live safety alerts arrive while a crew records: re-check this often. */
export const SAFETY_POLL_MS = 15_000;

/**
 * Open safety alerts on the job file, above every tab. Polls while open so a
 * live alert appears without a reload; acknowledge / dismiss-with-reason
 * refresh the list.
 */
export function JobSafetyAlerts({ jobId, onOpenLive }: { jobId: string; onOpenLive?: () => void }) {
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await api.jobSafetyIncidents(jobId, 'open');
      setIncidents(res.incidents ?? []);
    } catch {
      /* no alerts shown is the safe failure here; email / SMS still went out */
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), SAFETY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <SafetyAlertBanner
      incidents={incidents}
      onAck={(id) => api.ackSafetyIncident(id).then(load)}
      onDismiss={(id, category, note) => api.dismissSafetyIncident(id, category, note).then(load)}
      onOpenLive={onOpenLive}
    />
  );
}
