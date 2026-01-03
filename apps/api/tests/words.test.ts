import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import type { Env } from '../src/env';
import { ensureDailyWordForUser } from '../src/words';
import { createTestEnv } from './helpers';

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

async function seedUser(env: Env, userId: string, timezone: string) {
  await env.DB.prepare(
    'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(userId, nowIso(), 0, timezone, JSON.stringify(DEFAULT_PREFERENCES))
    .run();
}

async function seedWords(env: Env) {
  const createdAt = nowIso();
  const words = [
    {
      id: 1,
      word: 'luminary',
      definition: 'A person who inspires or influences others.',
      etymology: 'From Latin lumen, meaning light.',
      pronunciation: 'LOO-muh-nair-ee',
      examples: JSON.stringify(['She is a luminary in the design world.']),
    },
    {
      id: 2,
      word: 'sonder',
      definition: 'The realization that each passerby has a life as vivid as your own.',
      etymology: 'Coined in the Dictionary of Obscure Sorrows.',
      pronunciation: 'SON-der',
      examples: JSON.stringify(['Traveling brought on a sudden sense of sonder.']),
    },
  ];

  for (const entry of words) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO words (id, word, definition, etymology, pronunciation, examples_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        entry.id,
        entry.word,
        entry.definition,
        entry.etymology,
        entry.pronunciation,
        entry.examples,
        createdAt
      )
      .run();
  }
}

describe('ensureDailyWordForUser', () => {
  it('delivers a single immutable word per local day', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();

    try {
      await seedUser(env, userId, 'UTC');
      await seedWords(env);

      const first = await ensureDailyWordForUser(env, {
        userId,
        timezone: 'UTC',
        now: new Date('2024-01-02T08:00:00Z'),
      });
      const second = await ensureDailyWordForUser(env, {
        userId,
        timezone: 'UTC',
        now: new Date('2024-01-02T18:00:00Z'),
      });

      expect(first.delivered).toBe(true);
      expect(second.delivered).toBe(false);
      expect(second.word.id).toBe(first.word.id);

      const count = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM user_words WHERE user_id = ? AND delivered_on = ?'
      )
        .bind(userId, first.dateKey)
        .first();

      expect(Number((count as { count: number }).count)).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('uses the user timezone for the delivery date key', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();

    try {
      await seedUser(env, userId, 'America/Los_Angeles');
      await seedWords(env);

      const result = await ensureDailyWordForUser(env, {
        userId,
        timezone: 'America/Los_Angeles',
        now: new Date('2024-01-02T07:30:00Z'),
      });

      expect(result.dateKey).toBe('2024-01-01');
    } finally {
      await cleanup();
    }
  });
});
