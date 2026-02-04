import type { Env } from '../env';
import { EnrichmentService } from './service';

const MAX_WORDS_PER_RUN = 10;
const TIME_BUDGET_MS = 25000; // 25 seconds to stay within 30s worker limit

/**
 * Process pending enrichments from the queue
 * Called by the cron handler
 */
export async function processEnrichmentQueue(env: Env): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const startTime = Date.now();
  const service = new EnrichmentService();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const pending = await service.getPendingEnrichment(env, MAX_WORDS_PER_RUN);

  for (const word of pending) {
    // Check time budget
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Enrichment cron: time budget exceeded after ${processed} words`);
      break;
    }

    try {
      const success = await service.enrichWord(env, word.id);
      processed++;
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`Enrichment cron: error processing word ${word.id}:`, err);
      failed++;
      processed++;
    }
  }

  console.log(`Enrichment cron: processed=${processed}, succeeded=${succeeded}, failed=${failed}`);

  return { processed, succeeded, failed };
}

/**
 * Trigger enrichment for a single word (used by waitUntil in API routes)
 */
export async function triggerSingleEnrichment(env: Env, wordPoolId: number): Promise<boolean> {
  const service = new EnrichmentService();
  return service.enrichWord(env, wordPoolId);
}
