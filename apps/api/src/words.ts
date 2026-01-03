import { DateTime } from 'luxon';

import { Env } from './env';
import { getLocalDateKey } from '@word-of-the-day/shared';

export interface WordRecord {
  id: number;
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples_json: string;
  created_at: string;
}

export async function getWordCount(env: Env): Promise<number> {
  const cached = await env.KV.get('words:count');
  if (cached) {
    return Number(cached);
  }
  const result = await env.DB.prepare('SELECT COUNT(*) as count FROM words').first();
  const count = Number((result as { count: number }).count || 0);
  await env.KV.put('words:count', String(count));
  return count;
}

export async function getDailyWordId(env: Env, dateKey: string): Promise<number> {
  const key = `daily:${dateKey}`;
  const cached = await env.KV.get(key);
  if (cached) {
    return Number(cached);
  }
  const count = await getWordCount(env);
  if (count === 0) {
    throw new Error('No words available');
  }
  const dayIndex = DateTime.fromISO(dateKey, { zone: 'utc' }).startOf('day').toSeconds() / 86400;
  const wordId = (Math.floor(dayIndex) % count) + 1;
  await env.KV.put(key, String(wordId));
  return wordId;
}

export async function getWordById(env: Env, id: number): Promise<WordRecord | null> {
  const result = await env.DB.prepare('SELECT * FROM words WHERE id = ?').bind(id).first();
  return (result as unknown as WordRecord) ?? null;
}

export async function ensureDailyWordForUser(
  env: Env,
  params: { userId: string; timezone: string; now?: Date }
): Promise<{ word: WordRecord; delivered: boolean; dateKey: string }> {
  const now = params.now ?? new Date();
  const dateKey = getLocalDateKey(now, params.timezone);
  const existing = await env.DB.prepare(
    'SELECT word_id FROM user_words WHERE user_id = ? AND delivered_on = ? LIMIT 1'
  )
    .bind(params.userId, dateKey)
    .first();

  if (existing) {
    const word = await getWordById(env, Number(existing.word_id));
    if (!word) {
      throw new Error('Word not found');
    }
    return { word, delivered: false, dateKey };
  }

  const wordId = await getDailyWordId(env, dateKey);
  const word = await getWordById(env, wordId);
  if (!word) {
    throw new Error('Word not found');
  }
  const nowIso = DateTime.utc().toISO();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user_words (user_id, word_id, delivered_at, delivered_on) VALUES (?, ?, ?, ?)'
  )
    .bind(params.userId, wordId, nowIso, dateKey)
    .run();

  return { word, delivered: true, dateKey };
}
