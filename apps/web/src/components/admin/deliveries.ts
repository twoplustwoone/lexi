import { AdminLogEntry } from '../../api';

/**
 * One scheduler run's delivery result.
 *
 * The scheduler emits several informational `cron` rows per run — job started,
 * batch processing, job completed — so counting log rows badly overstates
 * deliveries and reports sends for a run that pushed nothing. The
 * "Cron job completed" row carries the authoritative tally in its metadata;
 * that is the only row worth counting.
 */
export interface DeliveryRun {
  timestamp: string;
  sent: number;
  failed: number;
}

const COMPLETION_MESSAGE = 'Cron job completed';

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Scheduler runs that actually reported a push tally, newest first. */
export function deliveryRuns(logs: AdminLogEntry[]): DeliveryRun[] {
  return logs
    .filter((entry) => entry.category === 'cron' && entry.message === COMPLETION_MESSAGE)
    .map((entry) => ({
      timestamp: entry.timestamp,
      sent: readCount(entry.metadata?.pushSent),
      failed: readCount(entry.metadata?.pushFailed),
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Total notifications actually delivered across the given runs. */
export function totalDelivered(runs: DeliveryRun[]): number {
  return runs.reduce((sum, run) => sum + run.sent, 0);
}
