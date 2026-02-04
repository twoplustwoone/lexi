import { DateTime } from 'luxon';
import type { Env } from '../env';

const MAX_INT = 2147483647;

/**
 * Generate a deterministic seed from a date string
 * Same date always produces same seed
 */
export function hashDateToSeed(dateKey: string): number {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    const char = dateKey.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Force 32-bit integer
  }
  // Ensure positive value
  return Math.abs(hash) || 1;
}

/**
 * Get current cycle number from DB
 */
export async function getCurrentCycle(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    'SELECT current_cycle FROM word_cycle_state WHERE id = 1'
  ).first();
  return result ? Number((result as { current_cycle: number }).current_cycle) : 1;
}

/**
 * Increment cycle number when pool is exhausted
 */
export async function incrementCycle(env: Env): Promise<number> {
  await env.DB.prepare(
    'UPDATE word_cycle_state SET current_cycle = current_cycle + 1 WHERE id = 1'
  ).run();
  return getCurrentCycle(env);
}

/**
 * Get count of enabled words not yet used in current cycle
 */
export async function getAvailableWordCount(env: Env, cycle: number): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM word_pool wp
     LEFT JOIN word_usage_log wul ON wp.id = wul.word_pool_id AND wul.cycle = ?
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     WHERE wp.enabled = 1
       AND wul.id IS NULL
       AND (wd.status IS NULL OR wd.status IN ('ready', 'pending'))`
  )
    .bind(cycle)
    .first();
  return Number((result as { count: number })?.count ?? 0);
}

/**
 * Get total count of enabled words
 */
export async function getEnabledWordCount(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM word_pool wp
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     WHERE wp.enabled = 1
       AND (wd.status IS NULL OR wd.status IN ('ready', 'pending'))`
  ).first();
  return Number((result as { count: number })?.count ?? 0);
}

/**
 * Select a word for a given date using deterministic algorithm
 * Returns null if no words available
 */
export async function selectWordForDate(
  env: Env,
  dateKey: string,
  cycle: number
): Promise<{ wordPoolId: number } | null> {
  const seed = hashDateToSeed(dateKey);

  // Select word not used in current cycle, ordered deterministically by seed
  const result = await env.DB.prepare(
    `SELECT wp.id FROM word_pool wp
     LEFT JOIN word_usage_log wul ON wp.id = wul.word_pool_id AND wul.cycle = ?
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     WHERE wp.enabled = 1
       AND wul.id IS NULL
       AND (wd.status IS NULL OR wd.status IN ('ready', 'pending'))
     ORDER BY (wp.id * ?) % ?
     LIMIT 1`
  )
    .bind(cycle, seed, MAX_INT)
    .first();

  if (!result) {
    return null;
  }

  return { wordPoolId: Number((result as { id: number }).id) };
}

/**
 * Record word usage for a date
 */
export async function recordWordUsage(
  env: Env,
  wordPoolId: number,
  dateKey: string,
  cycle: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO word_usage_log (word_pool_id, used_on, cycle)
     VALUES (?, ?, ?)`
  )
    .bind(wordPoolId, dateKey, cycle)
    .run();
}

/**
 * Get daily word assignment - create if doesn't exist
 * This is the main entry point for getting today's word
 */
export async function getDailyWord(
  env: Env,
  dateKey: string
): Promise<{ wordPoolId: number; created: boolean }> {
  // Check if we already have a word for this day
  const existing = await env.DB.prepare('SELECT word_pool_id FROM daily_words WHERE day = ?')
    .bind(dateKey)
    .first();

  if (existing) {
    return {
      wordPoolId: Number((existing as { word_pool_id: number }).word_pool_id),
      created: false,
    };
  }

  // Get current cycle
  let cycle = await getCurrentCycle(env);

  // Try to select a word
  let selection = await selectWordForDate(env, dateKey, cycle);

  // If no words available in current cycle, start new cycle
  if (!selection) {
    const totalEnabled = await getEnabledWordCount(env);
    if (totalEnabled === 0) {
      throw new Error('No words available in pool');
    }

    // Start new cycle
    cycle = await incrementCycle(env);
    selection = await selectWordForDate(env, dateKey, cycle);

    if (!selection) {
      throw new Error('Unable to select word after cycle increment');
    }
  }

  const now = DateTime.utc().toISO();

  // Use batch to atomically create daily_words and word_usage_log entries
  await env.DB.batch([
    env.DB.prepare('INSERT INTO daily_words (day, word_pool_id, created_at) VALUES (?, ?, ?)').bind(
      dateKey,
      selection.wordPoolId,
      now
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, ?)'
    ).bind(selection.wordPoolId, dateKey, cycle),
  ]);

  return {
    wordPoolId: selection.wordPoolId,
    created: true,
  };
}
