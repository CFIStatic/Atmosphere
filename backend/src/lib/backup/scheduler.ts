import { config } from '../../config.js';
import { createAdminClient } from '../supabase.js';
import { runSnapshot, applyRetention, verifySnapshot, BackupNotConfiguredError } from './runner.js';

/**
 * The in-process backup scheduler.
 *
 * A plain interval inside the API process, which is the right size for a
 * single-instance deployment and honest about its limits: run several instances
 * and they will each take their own snapshot. When that day comes, move this to
 * a dedicated worker or a cron trigger — the runner takes no dependency on
 * being called from here.
 *
 * Each cycle takes one platform-wide snapshot, verifies the archive it just
 * wrote, then applies retention. Verifying immediately is the point: an archive
 * that cannot be read back is worth knowing about now, not during an incident.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function cycle(reason: string): Promise<void> {
  // Overlap protection. A snapshot that outruns the interval would otherwise
  // stack up runs against the same tables until something gives.
  if (running) {
    console.warn('[backup] previous run still in progress, skipping this cycle');
    return;
  }
  running = true;

  try {
    console.log(`[backup] starting ${reason} snapshot…`);
    const result = await runSnapshot({ scope: 'platform', kind: 'scheduled' });

    const mb = (result.byteSize / 1024 / 1024).toFixed(2);
    console.log(
      `[backup] wrote ${result.rowCount} rows across ${result.tables.length} tables ` +
        `→ ${result.storagePath} (${mb}MB, ${result.encryption}, ${result.durationMs}ms)`,
    );

    const verdict = await verifySnapshot(result.id, 'deep');
    if (verdict.ok) {
      console.log(`[backup] verified ${result.id}: ${verdict.detail}`);
    } else {
      console.error(`[backup] VERIFICATION FAILED for ${result.id}: ${verdict.detail}`);
    }

    const retention = await applyRetention();
    if (retention.removed > 0 || retention.failed > 0) {
      console.log(`[backup] retention: removed ${retention.removed}, failed ${retention.failed}`);
    }
  } catch (err) {
    if (err instanceof BackupNotConfiguredError) {
      console.warn(`[backup] skipped: ${err.message}`);
      stopBackupScheduler();
      return;
    }
    console.error('[backup] run failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startBackupScheduler(): void {
  if (!config.backups.enabled) {
    console.log('[backup] disabled (BACKUP_ENABLED=false)');
    return;
  }

  // Backups read across every org, which only the service role can do. Say so
  // once at boot rather than failing silently every night.
  if (!createAdminClient()) {
    console.warn(
      '[backup] SUPABASE_SERVICE_ROLE_KEY is not set — automatic backups are OFF. ' +
        'Set it to enable scheduled snapshots.',
    );
    return;
  }

  if (!config.backups.encryptionKey) {
    console.warn(
      '[backup] BACKUP_ENCRYPTION_KEY is not set — archives will be written UNENCRYPTED. ' +
        'They contain every customer record; generate a key with `openssl rand -base64 32`.',
    );
  }

  const intervalMs = Math.max(5, config.backups.intervalMinutes) * 60 * 1000;

  timer = setInterval(() => void cycle('scheduled'), intervalMs);
  // Do not hold the process open for a backup — shutdown should be prompt.
  timer.unref();

  console.log(
    `[backup] scheduled every ${config.backups.intervalMinutes} min ` +
      `→ driver=${config.backups.driver}, retention=${config.backups.retentionDays}d`,
  );

  if (config.backups.runOnBoot) {
    // Deliberately delayed: a crash-looping process should not be able to spray
    // half-written archives at storage on every restart.
    setTimeout(() => void cycle('boot'), 30_000).unref();
  }
}

export function stopBackupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
