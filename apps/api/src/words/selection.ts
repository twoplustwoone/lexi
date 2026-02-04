import { DateTime } from 'luxon';
import type { WordDifficulty } from '@word-of-the-day/shared';
import type { Env } from '../env';

const MAX_INT = 2147483647;
const EASY_MAX_TIER = 35;
const BALANCED_MAX_TIER = 60;

const DIFFICULTY_FALLBACK_ORDER: Record<WordDifficulty, WordDifficulty[]> = {
  easy: ['easy', 'balanced'],
  balanced: ['balanced', 'easy', 'advanced'],
  advanced: ['advanced', 'balanced'],
};

export interface UserDailyWordResult {
  wordPoolId: number;
  created: boolean;
  requestedDifficulty: WordDifficulty | null;
  effectiveDifficulty: WordDifficulty | null;
  usedFallback: boolean;
}

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

function isWordDifficulty(value: unknown): value is WordDifficulty {
  return value === 'easy' || value === 'balanced' || value === 'advanced';
}

function parseDifficultyFromDb(value: unknown): WordDifficulty | null {
  return isWordDifficulty(value) ? value : null;
}

function getDifficultySqlFilter(band: WordDifficulty): string {
  if (band === 'easy') {
    return `wp.tier IS NOT NULL AND wp.tier <= ${EASY_MAX_TIER}`;
  }
  if (band === 'balanced') {
    return `wp.tier IS NULL OR (wp.tier > ${EASY_MAX_TIER} AND wp.tier <= ${BALANCED_MAX_TIER})`;
  }
  return `wp.tier > ${BALANCED_MAX_TIER}`;
}

function getUserDifficultySeed(
  dateKey: string,
  userId: string,
  difficulty: WordDifficulty
): number {
  return hashDateToSeed(`${dateKey}:${userId}:${difficulty}`);
}

async function getUserDifficultyCycle(
  env: Env,
  userId: string,
  difficulty: WordDifficulty
): Promise<number> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_word_cycle_state (user_id, difficulty_band, current_cycle)
     VALUES (?, ?, 1)`
  )
    .bind(userId, difficulty)
    .run();

  const row = await env.DB.prepare(
    `SELECT current_cycle FROM user_word_cycle_state
     WHERE user_id = ? AND difficulty_band = ?`
  )
    .bind(userId, difficulty)
    .first();

  return Number((row as { current_cycle: number } | null)?.current_cycle ?? 1);
}

async function incrementUserDifficultyCycle(
  env: Env,
  userId: string,
  difficulty: WordDifficulty
): Promise<number> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_word_cycle_state (user_id, difficulty_band, current_cycle)
     VALUES (?, ?, 1)`
  )
    .bind(userId, difficulty)
    .run();

  await env.DB.prepare(
    `UPDATE user_word_cycle_state
     SET current_cycle = current_cycle + 1
     WHERE user_id = ? AND difficulty_band = ?`
  )
    .bind(userId, difficulty)
    .run();

  return getUserDifficultyCycle(env, userId, difficulty);
}

async function selectWordForUserDifficulty(
  env: Env,
  params: {
    userId: string;
    dateKey: string;
    difficulty: WordDifficulty;
    cycle: number;
  }
): Promise<{ wordPoolId: number } | null> {
  const seed = getUserDifficultySeed(params.dateKey, params.userId, params.difficulty);
  const result = await env.DB.prepare(
    `SELECT wp.id FROM word_pool wp
     LEFT JOIN user_word_usage_log uwul
       ON wp.id = uwul.word_pool_id
      AND uwul.user_id = ?
      AND uwul.difficulty_band = ?
      AND uwul.cycle = ?
     LEFT JOIN word_details wd ON wp.id = wd.word_pool_id
     WHERE wp.enabled = 1
       AND uwul.id IS NULL
       AND (wd.status IS NULL OR wd.status IN ('ready', 'pending'))
       AND (${getDifficultySqlFilter(params.difficulty)})
     ORDER BY (wp.id * ?) % ?
     LIMIT 1`
  )
    .bind(params.userId, params.difficulty, params.cycle, seed, MAX_INT)
    .first();

  if (!result) {
    return null;
  }

  return { wordPoolId: Number((result as { id: number }).id) };
}

async function recordUserDifficultyUsage(
  env: Env,
  params: {
    userId: string;
    wordPoolId: number;
    difficulty: WordDifficulty;
    cycle: number;
    dateKey: string;
  }
): Promise<void> {
  const nowIso = DateTime.utc().toISO();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_word_usage_log
     (user_id, word_pool_id, difficulty_band, cycle, used_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(params.userId, params.wordPoolId, params.difficulty, params.cycle, params.dateKey, nowIso)
    .run();
}

async function getExistingUserWord(
  env: Env,
  userId: string,
  dateKey: string
): Promise<{
  wordPoolId: number;
  requestedDifficulty: WordDifficulty | null;
  effectiveDifficulty: WordDifficulty | null;
} | null> {
  const row = await env.DB.prepare(
    `SELECT word_id, requested_difficulty, effective_difficulty
     FROM user_words
     WHERE user_id = ? AND delivered_on = ?
     LIMIT 1`
  )
    .bind(userId, dateKey)
    .first();

  if (!row) {
    return null;
  }

  return {
    wordPoolId: Number((row as { word_id: number }).word_id),
    requestedDifficulty: parseDifficultyFromDb(
      (row as { requested_difficulty?: unknown }).requested_difficulty
    ),
    effectiveDifficulty: parseDifficultyFromDb(
      (row as { effective_difficulty?: unknown }).effective_difficulty
    ),
  };
}

export async function getDailyWordForUser(
  env: Env,
  params: {
    userId: string;
    dateKey: string;
    requestedDifficulty: WordDifficulty | null;
  }
): Promise<UserDailyWordResult> {
  const existing = await getExistingUserWord(env, params.userId, params.dateKey);
  if (existing) {
    return {
      wordPoolId: existing.wordPoolId,
      created: false,
      requestedDifficulty: existing.requestedDifficulty,
      effectiveDifficulty: existing.effectiveDifficulty,
      usedFallback:
        existing.requestedDifficulty !== null &&
        existing.effectiveDifficulty !== null &&
        existing.requestedDifficulty !== existing.effectiveDifficulty,
    };
  }

  const nowIso = DateTime.utc().toISO();

  if (!params.requestedDifficulty) {
    const globalSelection = await getDailyWord(env, params.dateKey);
    const insertResult = await env.DB.prepare(
      `INSERT OR IGNORE INTO user_words
       (user_id, word_id, delivered_at, delivered_on, requested_difficulty, effective_difficulty)
       VALUES (?, ?, ?, ?, NULL, NULL)`
    )
      .bind(params.userId, globalSelection.wordPoolId, nowIso, params.dateKey)
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      const reloaded = await getExistingUserWord(env, params.userId, params.dateKey);
      if (reloaded) {
        return {
          wordPoolId: reloaded.wordPoolId,
          created: false,
          requestedDifficulty: reloaded.requestedDifficulty,
          effectiveDifficulty: reloaded.effectiveDifficulty,
          usedFallback:
            reloaded.requestedDifficulty !== null &&
            reloaded.effectiveDifficulty !== null &&
            reloaded.requestedDifficulty !== reloaded.effectiveDifficulty,
        };
      }
    }

    return {
      wordPoolId: globalSelection.wordPoolId,
      created: true,
      requestedDifficulty: null,
      effectiveDifficulty: null,
      usedFallback: false,
    };
  }

  const requestedDifficulty = params.requestedDifficulty;
  const difficultyOrder = DIFFICULTY_FALLBACK_ORDER[requestedDifficulty];

  const attemptSelection = async (): Promise<{
    wordPoolId: number;
    effectiveDifficulty: WordDifficulty;
    cycle: number;
  } | null> => {
    for (const difficulty of difficultyOrder) {
      const cycle = await getUserDifficultyCycle(env, params.userId, difficulty);
      const selection = await selectWordForUserDifficulty(env, {
        userId: params.userId,
        dateKey: params.dateKey,
        difficulty,
        cycle,
      });
      if (selection) {
        return {
          wordPoolId: selection.wordPoolId,
          effectiveDifficulty: difficulty,
          cycle,
        };
      }
    }
    return null;
  };

  let selected = await attemptSelection();

  if (!selected) {
    await incrementUserDifficultyCycle(env, params.userId, requestedDifficulty);
    selected = await attemptSelection();
  }

  if (!selected) {
    for (const difficulty of difficultyOrder.slice(1)) {
      await incrementUserDifficultyCycle(env, params.userId, difficulty);
    }
    selected = await attemptSelection();
  }

  if (!selected) {
    throw new Error('No words available for selected preferences');
  }

  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO user_words
     (user_id, word_id, delivered_at, delivered_on, requested_difficulty, effective_difficulty)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      params.userId,
      selected.wordPoolId,
      nowIso,
      params.dateKey,
      requestedDifficulty,
      selected.effectiveDifficulty
    )
    .run();

  if ((insertResult.meta?.changes ?? 0) === 0) {
    const reloaded = await getExistingUserWord(env, params.userId, params.dateKey);
    if (reloaded) {
      return {
        wordPoolId: reloaded.wordPoolId,
        created: false,
        requestedDifficulty: reloaded.requestedDifficulty,
        effectiveDifficulty: reloaded.effectiveDifficulty,
        usedFallback:
          reloaded.requestedDifficulty !== null &&
          reloaded.effectiveDifficulty !== null &&
          reloaded.requestedDifficulty !== reloaded.effectiveDifficulty,
      };
    }
  }

  await recordUserDifficultyUsage(env, {
    userId: params.userId,
    wordPoolId: selected.wordPoolId,
    difficulty: selected.effectiveDifficulty,
    cycle: selected.cycle,
    dateKey: params.dateKey,
  });

  return {
    wordPoolId: selected.wordPoolId,
    created: true,
    requestedDifficulty,
    effectiveDifficulty: selected.effectiveDifficulty,
    usedFallback: selected.effectiveDifficulty !== requestedDifficulty,
  };
}
