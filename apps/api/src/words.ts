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

export interface WordInput {
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples: string[];
}

export async function listWords(
  env: Env,
  options: { limit?: number; offset?: number; search?: string } = {}
): Promise<{ words: WordRecord[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const search = options.search?.trim();

  let countQuery = 'SELECT COUNT(*) as count FROM words';
  let listQuery = 'SELECT * FROM words';

  if (search) {
    const whereClause = ' WHERE word LIKE ? OR definition LIKE ?';
    countQuery += whereClause;
    listQuery += whereClause;
  }

  listQuery += ' ORDER BY id DESC LIMIT ? OFFSET ?';

  let countResult;
  let listResult;

  if (search) {
    const searchPattern = `%${search}%`;
    countResult = await env.DB.prepare(countQuery).bind(searchPattern, searchPattern).first();
    listResult = await env.DB.prepare(listQuery)
      .bind(searchPattern, searchPattern, limit, offset)
      .all();
  } else {
    countResult = await env.DB.prepare(countQuery).first();
    listResult = await env.DB.prepare(listQuery).bind(limit, offset).all();
  }

  return {
    words: listResult.results as unknown as WordRecord[],
    total: Number((countResult as { count: number })?.count ?? 0),
  };
}

export async function createWord(env: Env, input: WordInput): Promise<WordRecord> {
  const result = await env.DB.prepare(
    `INSERT INTO words (word, definition, etymology, pronunciation, examples_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      input.word,
      input.definition,
      input.etymology,
      input.pronunciation,
      JSON.stringify(input.examples),
      new Date().toISOString()
    )
    .first();

  // Invalidate cached word count
  await env.KV.delete('words:count');

  return result as unknown as WordRecord;
}

export async function updateWord(
  env: Env,
  id: number,
  input: Partial<WordInput>
): Promise<WordRecord | null> {
  const existing = await getWordById(env, id);
  if (!existing) {
    return null;
  }

  const updated = {
    word: input.word ?? existing.word,
    definition: input.definition ?? existing.definition,
    etymology: input.etymology ?? existing.etymology,
    pronunciation: input.pronunciation ?? existing.pronunciation,
    examples_json: input.examples ? JSON.stringify(input.examples) : existing.examples_json,
  };

  const result = await env.DB.prepare(
    `UPDATE words
     SET word = ?, definition = ?, etymology = ?, pronunciation = ?, examples_json = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(
      updated.word,
      updated.definition,
      updated.etymology,
      updated.pronunciation,
      updated.examples_json,
      id
    )
    .first();

  return result as unknown as WordRecord;
}

export async function deleteWord(env: Env, id: number): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM words WHERE id = ?').bind(id).run();

  if (result.meta.changes > 0) {
    // Invalidate cached word count
    await env.KV.delete('words:count');
    return true;
  }

  return false;
}

export async function bulkCreateWords(
  env: Env,
  inputs: WordInput[]
): Promise<{ created: number; errors: Array<{ index: number; error: string }> }> {
  let created = 0;
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    try {
      await createWord(env, inputs[i]);
      created++;
    } catch (err) {
      errors.push({
        index: i,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { created, errors };
}
