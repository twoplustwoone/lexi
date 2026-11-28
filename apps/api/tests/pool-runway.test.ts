import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { WordDifficulty } from '@lexi/shared';

import { getDailyWordForUser } from '../src/words/selection';
import { getWordPoolHealth } from '../src/words/pool';
import { createTestEnv } from './helpers';
import type { Env } from '../src/env';

describe('word pool health runway', () => {
  let env: Env;
  let cleanup: () => Promise<void>;

  async function seedWord(
    id: number,
    difficulty: WordDifficulty,
    reviewStatus: 'approved' | 'pending_review' = 'approved'
  ) {
    await env.DB.prepare(
      `INSERT INTO word_pool (id, word, enabled, tier, difficulty_category, source, created_at)
       VALUES (?, ?, 1, NULL, ?, 'test', ?)`
    )
      .bind(id, `word${id}`, difficulty, new Date().toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO word_details (word_pool_id, status, review_status) VALUES (?, 'ready', ?)`
    )
      .bind(id, reviewStatus)
      .run();
  }

  async function seedUser(id: string, difficulty: WordDifficulty | null) {
    const preferences = difficulty ? { word_filters: { difficulty } } : {};
    await env.DB.prepare(
      `INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json)
       VALUES (?, ?, 0, 'UTC', ?)`
    )
      .bind(id, new Date().toISOString(), JSON.stringify(preferences))
      .run();
  }

  async function deliver(userId: string, difficulty: WordDifficulty | null, daysAgo: number[]) {
    for (const days of daysAgo) {
      await getDailyWordForUser(env, {
        userId,
        dateKey: DateTime.utc().minus({ days }).toISODate()!,
        requestedDifficulty: difficulty,
      });
    }
  }

  beforeEach(async () => {
    ({ env, cleanup } = await createTestEnv());
    for (const table of [
      'user_word_usage_log',
      'user_word_cycle_state',
      'user_words',
      'word_usage_log',
      'daily_words',
      'word_details',
      'word_pool',
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    await seedWord(1, 'advanced');
    await seedWord(2, 'advanced');
    await seedWord(3, 'advanced');
    await seedWord(4, 'advanced', 'pending_review');
    await seedWord(5, 'balanced');
    await seedWord(6, 'balanced');
  });

  afterEach(async () => {
    await cleanup();
  });

  const none = { readers: 0, atRisk: 0, fewestLeft: null };

  it('summarises each band on its own: readers, how many are at risk, and the fewest left', async () => {
    for (let id = 100; id < 130; id++) {
      await seedWord(id, 'balanced');
    }
    await seedUser('advanced-close', 'advanced');
    await deliver('advanced-close', 'advanced', [1, 0]);
    await seedUser('advanced-newer', 'advanced');
    await deliver('advanced-newer', 'advanced', [0]);
    await seedUser('balanced-fine', 'balanced');
    await deliver('balanced-fine', 'balanced', [0]);

    const health = await getWordPoolHealth(env);

    expect(health.runway.byDifficulty).toEqual({
      advanced: { readers: 2, atRisk: 2, fewestLeft: 1 },
      balanced: { readers: 1, atRisk: 0, fewestLeft: 31 },
      easy: none,
    });
  });

  it('counts only the current cycle once a reader has wrapped around', async () => {
    await seedUser('wrapped', 'advanced');
    // Three advanced days, two balanced fallback days, then both cycles roll and
    // the sixth day is advanced again.
    await deliver('wrapped', 'advanced', [5, 4, 3, 2, 1, 0]);

    const health = await getWordPoolHealth(env);

    expect(health.runway.byDifficulty.advanced).toEqual({ readers: 1, atRisk: 1, fewestLeft: 2 });
  });

  it('reports a reader who has run out as zero', async () => {
    await seedUser('out', 'advanced');
    await deliver('out', 'advanced', [3, 2, 1, 0]);

    const health = await getWordPoolHealth(env);

    expect(health.runway.byDifficulty.advanced).toEqual({ readers: 1, atRisk: 1, fewestLeft: 0 });
  });

  it('leaves out readers with no difficulty set and readers who stopped opening the app', async () => {
    await seedUser('no-preference', null);
    await deliver('no-preference', null, [0]);

    await seedUser('lapsed', 'advanced');
    await deliver('lapsed', 'advanced', [40, 39]);

    const health = await getWordPoolHealth(env);

    expect(health.runway.byDifficulty).toEqual({ advanced: none, balanced: none, easy: none });
  });
});
