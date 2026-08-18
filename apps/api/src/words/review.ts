import { DateTime } from 'luxon';
import type { WordCard } from '@word-of-the-day/shared';
import type { Env } from '../env';
import { evaluateWordCardQuality } from './quality';

/** Cap on how many words a single bulk review request may touch. */
export const MAX_BULK_REVIEW_IDS = 500;

/** Default batch size for one auto-approval sweep over the backlog. */
export const AUTO_APPROVE_BATCH_SIZE = 200;

export interface BulkReviewResult {
  updated: number;
  requested: number;
}

export interface AutoApproveSweepResult {
  scanned: number;
  approved: number;
  flagged: number;
}

function parseCard(normalizedJson: string | null): WordCard | null {
  if (!normalizedJson) {
    return null;
  }
  try {
    return JSON.parse(normalizedJson) as WordCard;
  } catch {
    return null;
  }
}

/**
 * Approve several reviewed words at once.
 *
 * Mirrors approveWordReview but in a single batch so the admin UI can clear a
 * page of the queue in one action instead of one request per word.
 */
export async function bulkApproveWordReviews(
  env: Env,
  wordPoolIds: number[],
  reviewerId: string,
  reviewNote?: string
): Promise<BulkReviewResult> {
  if (wordPoolIds.length === 0) {
    return { updated: 0, requested: 0 };
  }

  const now = DateTime.utc().toISO();
  const statements = wordPoolIds.map((wordPoolId) =>
    env.DB.prepare(
      `UPDATE word_details
       SET status = 'ready',
           review_status = 'approved',
           reviewed_at = ?,
           reviewed_by = ?,
           review_note = ?,
           next_retry_at = NULL,
           error = NULL
       WHERE word_pool_id = ?`
    ).bind(now, reviewerId, reviewNote ?? null, wordPoolId)
  );

  const results = await env.DB.batch(statements);
  const updated = results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);

  return { updated, requested: wordPoolIds.length };
}

/**
 * Reject several reviewed words at once, disabling each so it is never served.
 */
export async function bulkRejectWordReviews(
  env: Env,
  wordPoolIds: number[],
  reviewerId: string,
  reviewNote: string
): Promise<BulkReviewResult> {
  if (wordPoolIds.length === 0) {
    return { updated: 0, requested: 0 };
  }

  const now = DateTime.utc().toISO();
  const statements = wordPoolIds.flatMap((wordPoolId) => [
    env.DB.prepare(
      `UPDATE word_details
       SET review_status = 'rejected',
           reviewed_at = ?,
           reviewed_by = ?,
           review_note = ?
       WHERE word_pool_id = ?`
    ).bind(now, reviewerId, reviewNote, wordPoolId),
    env.DB.prepare('UPDATE word_pool SET enabled = 0 WHERE id = ?').bind(wordPoolId),
  ]);

  const results = await env.DB.batch(statements);
  const updated = results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);

  return { updated, requested: wordPoolIds.length };
}

/**
 * Run the quality gate across words already sitting in the review queue.
 *
 * Enrichment applies the same gate to new words, but anything enriched before
 * auto-approval existed is stranded at pending_review. The cron calls this so
 * that backlog drains on its own; the admin route exposes it for a manual run.
 */
export async function autoApproveReviewQueue(
  env: Env,
  limit: number = AUTO_APPROVE_BATCH_SIZE
): Promise<AutoApproveSweepResult> {
  const pending = await env.DB.prepare(
    `SELECT wd.word_pool_id, wd.normalized_json, wd.provider
     FROM word_details wd
     JOIN word_pool wp ON wp.id = wd.word_pool_id
     WHERE wd.review_status = 'pending_review'
       AND wd.status = 'ready'
       AND wp.enabled = 1
     ORDER BY wd.word_pool_id ASC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  const rows = (pending.results ?? []) as unknown as Array<{
    word_pool_id: number;
    normalized_json: string | null;
    provider: string | null;
  }>;

  if (rows.length === 0) {
    return { scanned: 0, approved: 0, flagged: 0 };
  }

  const now = DateTime.utc().toISO();
  const approvals = [];
  let flagged = 0;

  for (const row of rows) {
    const verdict = evaluateWordCardQuality(parseCard(row.normalized_json));
    if (!verdict.autoApprove) {
      flagged++;
      // Record why it is being held so the queue explains itself to a reviewer.
      approvals.push(
        env.DB.prepare(
          `UPDATE word_details SET review_note = ? WHERE word_pool_id = ? AND review_note IS NULL`
        ).bind(verdict.reason, row.word_pool_id)
      );
      continue;
    }

    approvals.push(
      env.DB.prepare(
        `UPDATE word_details
         SET review_status = 'approved',
             reviewed_at = ?,
             reviewed_by = 'auto',
             review_note = ?
         WHERE word_pool_id = ?`
      ).bind(now, `Auto-approved from ${row.provider ?? 'enrichment'}`, row.word_pool_id)
    );
  }

  await env.DB.batch(approvals);

  return {
    scanned: rows.length,
    approved: rows.length - flagged,
    flagged,
  };
}
