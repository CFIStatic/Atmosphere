import { createApp } from './app.js';
import { listenHost, resolveWorkerRole, shouldRunSoldPathWorkers } from './bootFlags.js';
import { config } from './config.js';
import { scheduleClipRoomBackfill, stopClipRoomBackfill } from './lib/backfillClipRooms.js';
import { schedulePlayableProofBackfill, stopPlayableProofBackfill } from './lib/backfillPlayableProofs.js';
import { scheduleTimedTranscriptBackfill, stopTimedTranscriptBackfill } from './lib/backfillTimedTranscripts.js';
import { startProofAnalysisSweep, stopProofAnalysisSweep } from './shared/proofAnalysisSweep.js';
import { startProofPurgeSweep, stopProofPurgeSweep } from './shared/proofPurgeSweep.js';
import { startSoldPathOutboxWorkers, stopSoldPathOutboxWorkers } from './shared/soldPathOutbox.js';
import { assertProductionReady } from './lib/productionGuards.js';
import { initSentry } from './lib/sentry.js';
import { startVerificationLeaseSweep, stopVerificationLeaseSweep } from './verification/reclaim.js';
import { startDailyJobReportSweep, stopDailyJobReportSweep } from './dailyReport/index.js';
import { computerConfigured } from './computer/providers/index.js';
import { startComputerTaskSweep, stopComputerTaskSweep } from './computer/worker.js';
import { startPracticeScheduler, stopPracticeScheduler } from './computer/iq/practice/scheduler.js';
import { askProviderLabel } from './lib/askModel.js';
import { visionProviderLabel } from './lib/visionProvider.js';
import { logger } from './lib/logger.js';
import { liveSignalHub } from './live/liveSignalHub.js';

try {
  assertProductionReady();
} catch (err) {
  logger.error('boot_aborted', {
    detail: err instanceof Error ? err.message : String(err),
  });
  throw err;
}

initSentry();

const workerRole = resolveWorkerRole();
const runSoldPathWorkers = shouldRunSoldPathWorkers(workerRole);
const app = createApp();

const host = listenHost();
const server = app.listen(config.port, host, () => {
  liveSignalHub.attach(server);
  logger.info('listening', {
    host,
    port: config.port,
    supabaseUrl: config.supabase.url,
    origins: config.frontendOrigins,
    mediaBackend: config.media.backend,
    ask: askProviderLabel(),
    vision: visionProviderLabel(),
    workerRole,
    mode: config.isProduction ? 'production' : 'development',
    liveSignal: '/api/live/signal',
  });

  // Sold-path outbox. Default (WORKER_ROLE=all) runs in this process.
  // WORKER_ROLE=http skips claiming so a dedicated queue replica can drain.
  if (runSoldPathWorkers) {
    startProofAnalysisSweep();
    // One-shot .play.mp4 backfill ~60s after listen. PROOF_PLAYABLE_BACKFILL_ON_BOOT=0 turns it off.
    schedulePlayableProofBackfill();
    // One-shot word-timing re-transcription ~60s after listen. PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT=0 turns it off.
    scheduleTimedTranscriptBackfill();
    // One-shot room segments for clips analyzed before room rows existed. PROOF_ROOM_BACKFILL_ON_BOOT=0 turns it off.
    scheduleClipRoomBackfill();
    startProofPurgeSweep();
    startVerificationLeaseSweep();
    startSoldPathOutboxWorkers();
    startDailyJobReportSweep();
    // Chat's browser agent. Off until BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are set.
    if (computerConfigured()) {
      startComputerTaskSweep();
      // Daily practice runs on the practice org (off unless COMPUTER_PRACTICE_ENABLED=1).
      startPracticeScheduler();
    }
    else logger.info('computer_not_set_up', { detail: 'Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to turn on Computer.' });
  }
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    // Subsystems that hold resources the process should not simply drop.
    stopVerificationLeaseSweep();
    stopProofAnalysisSweep();
    stopPlayableProofBackfill();
    stopTimedTranscriptBackfill();
    stopClipRoomBackfill();
    stopProofPurgeSweep();
    stopSoldPathOutboxWorkers();
    stopDailyJobReportSweep();
    stopComputerTaskSweep();
    stopPracticeScheduler();
    liveSignalHub.close();
    server.close(() => process.exit(0));
  });
}
