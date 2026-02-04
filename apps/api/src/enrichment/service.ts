import { DateTime } from 'luxon';
import type { WordCard, WordDetailsStatus } from '@word-of-the-day/shared';
import type { Env } from '../env';
import type { EnrichmentProvider, EnrichmentResult } from './provider';
import { DictionaryApiProvider } from './dictionaryapi';

/**
 * Calculate backoff delay for retry
 * Formula: min(5 * 3^(retry-1), 1440) minutes
 */
export function calculateBackoffMinutes(retryCount: number): number {
  if (retryCount <= 0) return 5;
  const minutes = 5 * Math.pow(3, retryCount - 1);
  return Math.min(minutes, 1440); // max 24 hours
}

/**
 * Word details row from DB
 */
export interface WordDetailsRow {
  word_pool_id: number;
  status: WordDetailsStatus;
  provider: string | null;
  payload_json: string | null;
  normalized_json: string | null;
  fetched_at: string | null;
  next_retry_at: string | null;
  retry_count: number;
  error: string | null;
}

/**
 * Word pool row from DB
 */
export interface WordPoolRow {
  id: number;
  word: string;
  enabled: number;
  tier: number | null;
  source: string;
  created_at: string;
}

/**
 * Enrichment service handles fetching definitions and managing retry state
 */
export class EnrichmentService {
  private provider: EnrichmentProvider;

  constructor(provider?: EnrichmentProvider) {
    this.provider = provider ?? new DictionaryApiProvider();
  }

  /**
   * Get details for a word pool entry
   */
  async getWordDetails(env: Env, wordPoolId: number): Promise<WordDetailsRow | null> {
    const result = await env.DB.prepare('SELECT * FROM word_details WHERE word_pool_id = ?')
      .bind(wordPoolId)
      .first();
    return result as WordDetailsRow | null;
  }

  /**
   * Get word from pool by ID
   */
  async getWordPoolEntry(env: Env, wordPoolId: number): Promise<WordPoolRow | null> {
    const result = await env.DB.prepare('SELECT * FROM word_pool WHERE id = ?')
      .bind(wordPoolId)
      .first();
    return result as WordPoolRow | null;
  }

  /**
   * Create pending word_details entry if it doesn't exist
   */
  async ensureWordDetails(env: Env, wordPoolId: number): Promise<void> {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO word_details (word_pool_id, status)
       VALUES (?, 'pending')`
    )
      .bind(wordPoolId)
      .run();
  }

  /**
   * Enrich a single word
   * Returns true if enrichment was successful
   */
  async enrichWord(env: Env, wordPoolId: number): Promise<boolean> {
    const wordPool = await this.getWordPoolEntry(env, wordPoolId);
    if (!wordPool) {
      console.error(`Word pool entry not found: ${wordPoolId}`);
      return false;
    }

    // Ensure word_details row exists
    await this.ensureWordDetails(env, wordPoolId);

    const details = await this.getWordDetails(env, wordPoolId);
    if (!details) {
      console.error(`Word details not found after ensure: ${wordPoolId}`);
      return false;
    }

    // Skip if already enriched
    if (details.status === 'ready') {
      return true;
    }

    // Fetch from provider
    const result = await this.provider.fetchDefinition(wordPool.word);
    const now = DateTime.utc().toISO();

    if (result.success && result.normalized) {
      // Success - update to ready
      await this.updateDetailsSuccess(env, wordPoolId, result, now);
      return true;
    }

    if (result.notFound) {
      // Word not found - disable and mark as not_found
      await this.updateDetailsNotFound(env, wordPoolId, result.error ?? 'Not found', now);
      return false;
    }

    // Transient failure - schedule retry
    await this.updateDetailsRetry(
      env,
      wordPoolId,
      details.retry_count,
      result.error ?? 'Unknown error'
    );
    return false;
  }

  /**
   * Update word_details on successful enrichment
   */
  private async updateDetailsSuccess(
    env: Env,
    wordPoolId: number,
    result: EnrichmentResult,
    now: string
  ): Promise<void> {
    await env.DB.prepare(
      `UPDATE word_details
       SET status = 'ready',
           provider = ?,
           payload_json = ?,
           normalized_json = ?,
           fetched_at = ?,
           next_retry_at = NULL,
           error = NULL
       WHERE word_pool_id = ?`
    )
      .bind(
        this.provider.name,
        JSON.stringify(result.rawPayload),
        JSON.stringify(result.normalized),
        now,
        wordPoolId
      )
      .run();
  }

  /**
   * Update word_details when word is not found in dictionary
   */
  private async updateDetailsNotFound(
    env: Env,
    wordPoolId: number,
    error: string,
    now: string
  ): Promise<void> {
    // Mark word as not found and disable it
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE word_details
         SET status = 'not_found',
             provider = ?,
             fetched_at = ?,
             error = ?
         WHERE word_pool_id = ?`
      ).bind(this.provider.name, now, error, wordPoolId),
      env.DB.prepare('UPDATE word_pool SET enabled = 0 WHERE id = ?').bind(wordPoolId),
    ]);
  }

  /**
   * Update word_details for retry on transient failure
   */
  private async updateDetailsRetry(
    env: Env,
    wordPoolId: number,
    currentRetryCount: number,
    error: string
  ): Promise<void> {
    const newRetryCount = currentRetryCount + 1;
    const backoffMinutes = calculateBackoffMinutes(newRetryCount);
    const nextRetryAt = DateTime.utc().plus({ minutes: backoffMinutes }).toISO();

    // After 6 retries, mark as failed
    const status = newRetryCount >= 6 ? 'failed' : 'pending';

    await env.DB.prepare(
      `UPDATE word_details
       SET status = ?,
           retry_count = ?,
           next_retry_at = ?,
           error = ?
       WHERE word_pool_id = ?`
    )
      .bind(status, newRetryCount, nextRetryAt, error, wordPoolId)
      .run();
  }

  /**
   * Reset a word for re-enrichment (admin action)
   */
  async resetForRetry(env: Env, wordPoolId: number): Promise<void> {
    await env.DB.prepare(
      `UPDATE word_details
       SET status = 'pending',
           retry_count = 0,
           next_retry_at = NULL,
           error = NULL
       WHERE word_pool_id = ?`
    )
      .bind(wordPoolId)
      .run();
  }

  /**
   * Get words pending enrichment that are ready to retry
   */
  async getPendingEnrichment(env: Env, limit: number): Promise<WordPoolRow[]> {
    const now = DateTime.utc().toISO();
    const result = await env.DB.prepare(
      `SELECT wp.* FROM word_pool wp
       JOIN word_details wd ON wp.id = wd.word_pool_id
       WHERE wp.enabled = 1
         AND wd.status = 'pending'
         AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= ?)
       ORDER BY wd.retry_count ASC, wp.id ASC
       LIMIT ?`
    )
      .bind(now, limit)
      .all();
    return result.results as unknown as WordPoolRow[];
  }

  /**
   * Get normalized WordCard from word_details
   */
  parseNormalizedJson(details: WordDetailsRow | null): WordCard | null {
    if (!details?.normalized_json) return null;
    try {
      return JSON.parse(details.normalized_json) as WordCard;
    } catch {
      return null;
    }
  }
}
