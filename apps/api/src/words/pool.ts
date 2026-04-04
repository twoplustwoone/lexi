import { DateTime } from 'luxon';
import type {
  EnrichmentStats,
  WordCard,
  WordDetailsStatus,
  WordDifficulty,
  WordPoolHealth,
  WordReviewStatus,
} from '@word-of-the-day/shared';
import type { Env } from '../env';
import type { WordPoolRow, WordDetailsRow } from '../enrichment/service';
import { getCurrentCycle, getDifficultyOrderPreview, getDifficultySqlFilter } from './selection';

const MINIMUM_ADVANCED_READY_WORDS = 100;
const DIFFICULTY_CATEGORIES: WordDifficulty[] = ['easy', 'balanced', 'advanced'];

function parseTierFromSource(source: string): number | null {
  const match = source.match(/\.([0-9]{1,3})$/);
  if (!match) {
    return null;
  }
  const tier = Number(match[1]);
  if (!Number.isFinite(tier)) {
    return null;
  }
  return tier;
}

function parseDifficultyCategoryFromSource(source: string): WordDifficulty | null {
  const normalized = source.toLowerCase();
  if (normalized.includes('advanced') || normalized.includes('gre') || normalized.includes('sat')) {
    return 'advanced';
  }
  if (normalized.includes('balanced')) {
    return 'balanced';
  }
  if (normalized.includes('easy') || normalized.includes('seed')) {
    return 'easy';
  }
  return null;
}

function inferDifficultyCategory(source: string, tier: number | null): WordDifficulty {
  const explicitCategory = parseDifficultyCategoryFromSource(source);
  if (explicitCategory) {
    return explicitCategory;
  }
  if (tier !== null && tier > 60) {
    return 'advanced';
  }
  if (tier !== null && tier > 35) {
    return 'balanced';
  }
  return 'easy';
}

/**
 * Get a word from the pool by ID
 */
export async function getWordPoolById(env: Env, id: number): Promise<WordPoolRow | null> {
  const result = await env.DB.prepare('SELECT * FROM word_pool WHERE id = ?').bind(id).first();
  return result as WordPoolRow | null;
}

/**
 * Get word details by word pool ID
 */
export async function getWordDetails(env: Env, wordPoolId: number): Promise<WordDetailsRow | null> {
  const result = await env.DB.prepare('SELECT * FROM word_details WHERE word_pool_id = ?')
    .bind(wordPoolId)
    .first();
  return result as WordDetailsRow | null;
}

/**
 * Ban/disable a word
 */
export async function banWord(env: Env, wordPoolId: number): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE word_pool SET enabled = 0 WHERE id = ?')
    .bind(wordPoolId)
    .run();
  return result.meta.changes > 0;
}

/**
 * Unban/enable a word
 */
export async function unbanWord(env: Env, wordPoolId: number): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE word_pool SET enabled = 1 WHERE id = ?')
    .bind(wordPoolId)
    .run();
  return result.meta.changes > 0;
}

/**
 * List words from the pool with filters
 */
export async function listWordPool(
  env: Env,
  options: {
    limit?: number;
    offset?: number;
    status?: WordDetailsStatus;
    enabled?: boolean;
    search?: string;
    difficultyCategory?: WordDifficulty;
  } = {}
): Promise<{
  words: Array<
    WordPoolRow & {
      details_status: WordDetailsStatus | null;
      review_status: WordReviewStatus | null;
      reviewed_at: string | null;
      reviewed_by: string | null;
      review_note: string | null;
    }
  >;
  total: number;
}> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.enabled !== undefined) {
    conditions.push('wp.enabled = ?');
    params.push(options.enabled ? 1 : 0);
  }

  if (options.status) {
    conditions.push('wd.status = ?');
    params.push(options.status);
  }

  if (options.search) {
    conditions.push('wp.word LIKE ?');
    params.push(`%${options.search}%`);
  }

  if (options.difficultyCategory) {
    conditions.push('wp.difficulty_category = ?');
    params.push(options.difficultyCategory);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}`
  )
    .bind(...params)
    .first();

  const listResult = await env.DB.prepare(
    `SELECT
       wp.*,
       wd.status as details_status,
       wd.review_status as review_status,
       wd.reviewed_at as reviewed_at,
       wd.reviewed_by as reviewed_by,
       wd.review_note as review_note
     FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}
     ORDER BY wp.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return {
    words: listResult.results as unknown as Array<
      WordPoolRow & {
        details_status: WordDetailsStatus | null;
        review_status: WordReviewStatus | null;
        reviewed_at: string | null;
        reviewed_by: string | null;
        review_note: string | null;
      }
    >,
    total: Number((countResult as { count: number })?.count ?? 0),
  };
}

/**
 * Import words into the pool
 * Returns count of newly created words
 */
export async function importWords(
  env: Env,
  words: string[],
  source: string = 'import',
  difficultyCategory?: WordDifficulty
): Promise<{ created: number; skipped: number }> {
  const now = DateTime.utc().toISO();
  const tier = parseTierFromSource(source);
  const category = difficultyCategory ?? inferDifficultyCategory(source, tier);
  let created = 0;
  let skipped = 0;

  // Process in batches of 100 to avoid hitting limits
  const batchSize = 100;
  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const statements = batch.map((word) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO word_pool
           (word, enabled, tier, difficulty_category, source, created_at)
         VALUES (?, 1, ?, ?, ?, ?)`
      ).bind(word.toLowerCase().trim(), tier, category, source, now)
    );

    const results = await env.DB.batch(statements);

    for (const result of results) {
      if (result.meta.changes > 0) {
        created++;
      } else {
        skipped++;
      }
    }
  }

  // Create pending word_details entries for new words
  await env.DB.prepare(
    `INSERT OR IGNORE INTO word_details (word_pool_id, status)
     SELECT id, 'pending' FROM word_pool WHERE source = ? AND created_at = ?`
  )
    .bind(source, now)
    .run();

  return { created, skipped };
}

/**
 * Get enrichment statistics
 */
export async function getEnrichmentStats(env: Env): Promise<EnrichmentStats> {
  const cycle = await getCurrentCycle(env);

  const [totalResult, statusResults, enabledResult, usedResult] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM word_pool').first(),
    env.DB.prepare(`SELECT status, COUNT(*) as count FROM word_details GROUP BY status`).all(),
    env.DB.prepare('SELECT COUNT(*) as count FROM word_pool WHERE enabled = 1').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM word_usage_log WHERE cycle = ?')
      .bind(cycle)
      .first(),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of statusResults.results as Array<{ status: string; count: number }>) {
    statusCounts[row.status] = row.count;
  }

  const total = Number((totalResult as { count: number })?.count ?? 0);
  const enabled = Number((enabledResult as { count: number })?.count ?? 0);

  return {
    total,
    pending: statusCounts['pending'] ?? 0,
    ready: statusCounts['ready'] ?? 0,
    failed: statusCounts['failed'] ?? 0,
    notFound: statusCounts['not_found'] ?? 0,
    enabledWords: enabled,
    disabledWords: total - enabled,
    currentCycle: cycle,
    wordsUsedThisCycle: Number((usedResult as { count: number })?.count ?? 0),
  };
}

export async function getWordPoolHealth(env: Env): Promise<WordPoolHealth> {
  const byDifficulty: WordPoolHealth['byDifficulty'] = {
    easy: { total: 0, enabled: 0, ready: 0, pending: 0, failed: 0, notFound: 0 },
    balanced: { total: 0, enabled: 0, ready: 0, pending: 0, failed: 0, notFound: 0 },
    advanced: { total: 0, enabled: 0, ready: 0, pending: 0, failed: 0, notFound: 0 },
  };

  const [difficultyRows, sourceRows] = await Promise.all([
    env.DB.prepare(
      `SELECT
       wp.difficulty_category as difficulty_category,
       COUNT(*) as total,
       SUM(CASE WHEN wp.enabled = 1 THEN 1 ELSE 0 END) as enabled,
         SUM(CASE WHEN wd.status = 'ready' AND wd.review_status = 'approved' THEN 1 ELSE 0 END)
           as ready,
         SUM(
           CASE
             WHEN wd.status = 'pending'
               OR wd.status IS NULL
               OR (wd.status = 'ready' AND wd.review_status = 'pending_review')
             THEN 1
             ELSE 0
           END
         ) as pending,
         SUM(CASE WHEN wd.status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN wd.status = 'not_found' THEN 1 ELSE 0 END) as not_found
       FROM word_pool wp
       LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
       GROUP BY wp.difficulty_category`
    ).all(),
    env.DB.prepare(
      `SELECT
         wp.source as source,
         wp.difficulty_category as difficulty_category,
         COUNT(*) as total,
         SUM(CASE WHEN wd.status = 'ready' AND wd.review_status = 'approved' THEN 1 ELSE 0 END)
           as ready
       FROM word_pool wp
       LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
       GROUP BY wp.source, wp.difficulty_category
       ORDER BY ready DESC, total DESC, source ASC`
    ).all(),
  ]);

  for (const row of difficultyRows.results as Array<{
    difficulty_category: WordDifficulty;
    total: number;
    enabled: number;
    ready: number;
    pending: number;
    failed: number;
    not_found: number;
  }>) {
    byDifficulty[row.difficulty_category] = {
      total: Number(row.total ?? 0),
      enabled: Number(row.enabled ?? 0),
      ready: Number(row.ready ?? 0),
      pending: Number(row.pending ?? 0),
      failed: Number(row.failed ?? 0),
      notFound: Number(row.not_found ?? 0),
    };
  }

  const previewEntries = await Promise.all(
    DIFFICULTY_CATEGORIES.map(async (difficultyCategory) => ({
      difficultyCategory,
      words: await getDifficultyOrderPreview(env, difficultyCategory, 7),
    }))
  );

  return {
    minimumAdvancedReadyWords: MINIMUM_ADVANCED_READY_WORDS,
    advancedHealthy: (byDifficulty.advanced?.ready ?? 0) >= MINIMUM_ADVANCED_READY_WORDS,
    byDifficulty,
    bySource: (
      sourceRows.results as Array<{
        source: string;
        difficulty_category: WordDifficulty;
        total: number;
        ready: number;
      }>
    ).map((row) => ({
      source: row.source,
      difficultyCategory: row.difficulty_category,
      total: Number(row.total ?? 0),
      ready: Number(row.ready ?? 0),
    })),
    upcomingPreview: Object.fromEntries(
      previewEntries.map(({ difficultyCategory, words }) => [difficultyCategory, words])
    ) as WordPoolHealth['upcomingPreview'],
  };
}

export async function getDifficultyReadyWordCount(
  env: Env,
  difficultyCategory: WordDifficulty
): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count
     FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     WHERE wp.enabled = 1
       AND wd.status = 'ready'
       AND wd.review_status = 'approved'
       AND (${getDifficultySqlFilter(difficultyCategory)})`
  ).first();

  return Number((result as { count: number } | null)?.count ?? 0);
}

export async function listWordReviewQueue(
  env: Env,
  options: {
    limit?: number;
    offset?: number;
    reviewStatus?: WordReviewStatus;
    difficultyCategory?: WordDifficulty;
  } = {}
): Promise<{
  words: Array<
    WordPoolRow & {
      details_status: WordDetailsStatus;
      review_status: WordReviewStatus;
      reviewed_at: string | null;
      reviewed_by: string | null;
      review_note: string | null;
      payload_json: string | null;
      normalized_json: string | null;
      error: string | null;
      fetched_at: string | null;
    }
  >;
  total: number;
}> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const reviewStatus = options.reviewStatus ?? 'pending_review';
  const conditions = ['wd.review_status = ?'];
  const params: Array<string | number> = [reviewStatus];

  if (options.difficultyCategory) {
    conditions.push('wp.difficulty_category = ?');
    params.push(options.difficultyCategory);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count
     FROM word_pool wp
     JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}`
  )
    .bind(...params)
    .first();

  const listResult = await env.DB.prepare(
    `SELECT
       wp.*,
       wd.status as details_status,
       wd.review_status as review_status,
       wd.reviewed_at as reviewed_at,
       wd.reviewed_by as reviewed_by,
       wd.review_note as review_note,
       wd.payload_json as payload_json,
       wd.normalized_json as normalized_json,
       wd.error as error,
       wd.fetched_at as fetched_at
     FROM word_pool wp
     JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}
     ORDER BY COALESCE(wd.fetched_at, wp.created_at) DESC, wp.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return {
    words: listResult.results as unknown as Array<
      WordPoolRow & {
        details_status: WordDetailsStatus;
        review_status: WordReviewStatus;
        reviewed_at: string | null;
        reviewed_by: string | null;
        review_note: string | null;
        payload_json: string | null;
        normalized_json: string | null;
        error: string | null;
        fetched_at: string | null;
      }
    >,
    total: Number((countResult as { count: number } | null)?.count ?? 0),
  };
}

export async function approveWordReview(
  env: Env,
  wordPoolId: number,
  reviewerId: string,
  options: {
    reviewNote?: string;
    normalizedDetails?: WordCard;
  } = {}
): Promise<boolean> {
  const now = DateTime.utc().toISO();
  const result = await env.DB.prepare(
    `UPDATE word_details
     SET status = 'ready',
         review_status = 'approved',
         reviewed_at = ?,
         reviewed_by = ?,
         review_note = ?,
         normalized_json = COALESCE(?, normalized_json),
         next_retry_at = NULL,
         error = NULL
     WHERE word_pool_id = ?`
  )
    .bind(
      now,
      reviewerId,
      options.reviewNote ?? null,
      options.normalizedDetails ? JSON.stringify(options.normalizedDetails) : null,
      wordPoolId
    )
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function rejectWordReview(
  env: Env,
  wordPoolId: number,
  reviewerId: string,
  reviewNote: string
): Promise<boolean> {
  const now = DateTime.utc().toISO();
  const results = await env.DB.batch([
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

  return results.some((result) => (result.meta?.changes ?? 0) > 0);
}
