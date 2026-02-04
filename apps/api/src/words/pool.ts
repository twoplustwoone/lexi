import { DateTime } from 'luxon';
import type { WordDetailsStatus, EnrichmentStats } from '@word-of-the-day/shared';
import type { Env } from '../env';
import type { WordPoolRow, WordDetailsRow } from '../enrichment/service';
import { getCurrentCycle } from './selection';

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
  } = {}
): Promise<{
  words: Array<WordPoolRow & { details_status: WordDetailsStatus | null }>;
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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}`
  )
    .bind(...params)
    .first();

  const listResult = await env.DB.prepare(
    `SELECT wp.*, wd.status as details_status FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     ${whereClause}
     ORDER BY wp.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return {
    words: listResult.results as unknown as Array<
      WordPoolRow & { details_status: WordDetailsStatus | null }
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
  source: string = 'import'
): Promise<{ created: number; skipped: number }> {
  const now = DateTime.utc().toISO();
  const tier = parseTierFromSource(source);
  let created = 0;
  let skipped = 0;

  // Process in batches of 100 to avoid hitting limits
  const batchSize = 100;
  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const statements = batch.map((word) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO word_pool (word, enabled, tier, source, created_at)
         VALUES (?, 1, ?, ?, ?)`
      ).bind(word.toLowerCase().trim(), tier, source, now)
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
