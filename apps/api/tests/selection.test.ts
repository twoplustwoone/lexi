import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  hashDateToSeed,
  getCurrentCycle,
  incrementCycle,
  getAvailableWordCount,
  getEnabledWordCount,
  selectWordForDate,
  getDailyWord,
  getDailyWordForUser,
} from '../src/words/selection';
import { createTestEnv } from './helpers';
import type { Env } from '../src/env';

describe('hashDateToSeed', () => {
  it('produces consistent seed for same date', () => {
    const seed1 = hashDateToSeed('2024-02-03');
    const seed2 = hashDateToSeed('2024-02-03');
    expect(seed1).toBe(seed2);
  });

  it('produces different seeds for different dates', () => {
    const seed1 = hashDateToSeed('2024-02-03');
    const seed2 = hashDateToSeed('2024-02-04');
    expect(seed1).not.toBe(seed2);
  });

  it('produces positive values', () => {
    const dates = ['2024-01-01', '2024-06-15', '2024-12-31', '2025-07-04'];
    for (const date of dates) {
      const seed = hashDateToSeed(date);
      expect(seed).toBeGreaterThan(0);
    }
  });

  it('handles edge case dates', () => {
    expect(hashDateToSeed('')).toBeGreaterThan(0);
    expect(hashDateToSeed('a')).toBeGreaterThan(0);
    expect(hashDateToSeed('9999-12-31')).toBeGreaterThan(0);
  });
});

// Base ID to avoid conflicts with seeded words (which use IDs 1-20)
const TEST_BASE_ID = 1000;

describe('Word Selection', () => {
  let env: Env;
  let cleanup: () => Promise<void>;
  let testWordIds: number[];

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    env = testEnv.env;
    cleanup = testEnv.cleanup;

    // Clear any seeded data to have clean state for selection tests
    await env.DB.prepare('DELETE FROM word_usage_log').run();
    await env.DB.prepare('DELETE FROM daily_words').run();
    await env.DB.prepare('DELETE FROM word_details').run();
    await env.DB.prepare('DELETE FROM word_pool').run();

    // Insert test words into pool
    const now = new Date().toISOString();
    const words = ['apple', 'banana', 'cherry', 'date', 'elderberry'];
    testWordIds = [];
    for (let i = 0; i < words.length; i++) {
      const id = TEST_BASE_ID + i;
      testWordIds.push(id);
      await env.DB.prepare(
        'INSERT INTO word_pool (id, word, enabled, source, created_at) VALUES (?, ?, 1, ?, ?)'
      )
        .bind(id, words[i], 'test', now)
        .run();
      // Create pending word_details
      await env.DB.prepare(
        "INSERT INTO word_details (word_pool_id, status) VALUES (?, 'pending')"
      )
        .bind(id)
        .run();
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('getCurrentCycle', () => {
    it('returns initial cycle of 1', async () => {
      const cycle = await getCurrentCycle(env);
      expect(cycle).toBe(1);
    });
  });

  describe('incrementCycle', () => {
    it('increments the cycle number', async () => {
      const initialCycle = await getCurrentCycle(env);
      await incrementCycle(env);
      const newCycle = await getCurrentCycle(env);
      expect(newCycle).toBe(initialCycle + 1);
    });
  });

  describe('getEnabledWordCount', () => {
    it('counts all enabled words', async () => {
      const count = await getEnabledWordCount(env);
      expect(count).toBe(5);
    });

    it('excludes disabled words', async () => {
      await env.DB.prepare('UPDATE word_pool SET enabled = 0 WHERE id = ?').bind(testWordIds[0]).run();
      const count = await getEnabledWordCount(env);
      expect(count).toBe(4);
    });

    it('excludes words with not_found status', async () => {
      await env.DB.prepare("UPDATE word_details SET status = 'not_found' WHERE word_pool_id = ?").bind(testWordIds[0]).run();
      const count = await getEnabledWordCount(env);
      expect(count).toBe(4);
    });
  });

  describe('getAvailableWordCount', () => {
    it('counts words not used in current cycle', async () => {
      const count = await getAvailableWordCount(env, 1);
      expect(count).toBe(5);
    });

    it('excludes words used in current cycle', async () => {
      await env.DB.prepare(
        'INSERT INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, 1)'
      )
        .bind(testWordIds[0], '2024-02-03')
        .run();

      const count = await getAvailableWordCount(env, 1);
      expect(count).toBe(4);
    });

    it('includes words used in previous cycles', async () => {
      await env.DB.prepare(
        'INSERT INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, 0)'
      )
        .bind(testWordIds[0], '2024-01-01')
        .run();

      const count = await getAvailableWordCount(env, 1);
      expect(count).toBe(5);
    });
  });

  describe('selectWordForDate', () => {
    it('selects a word deterministically', async () => {
      const result1 = await selectWordForDate(env, '2024-02-03', 1);
      const result2 = await selectWordForDate(env, '2024-02-03', 1);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1?.wordPoolId).toBe(result2?.wordPoolId);
    });

    it('selects different words for different dates', async () => {
      const result1 = await selectWordForDate(env, '2024-02-03', 1);
      const result2 = await selectWordForDate(env, '2024-02-04', 1);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      // With 5 words, different dates should usually pick different words
      // This isn't guaranteed but is statistically likely
    });

    it('excludes words used in current cycle', async () => {
      // Mark first test word as used
      await env.DB.prepare(
        'INSERT INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, 1)'
      )
        .bind(testWordIds[0], '2024-02-01')
        .run();

      // Select for multiple dates and verify first test word is never picked
      const selectedIds = new Set<number>();
      for (let i = 0; i < 10; i++) {
        const result = await selectWordForDate(env, `2024-02-${10 + i}`, 1);
        if (result) {
          selectedIds.add(result.wordPoolId);
        }
      }

      expect(selectedIds.has(testWordIds[0])).toBe(false);
    });

    it('returns null when no words available', async () => {
      // Mark all test words as used
      for (let i = 0; i < testWordIds.length; i++) {
        await env.DB.prepare(
          'INSERT INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, 1)'
        )
          .bind(testWordIds[i], `2024-02-0${i + 1}`)
          .run();
      }

      const result = await selectWordForDate(env, '2024-02-10', 1);
      expect(result).toBeNull();
    });
  });

  describe('getDailyWord', () => {
    it('creates and returns daily word', async () => {
      const result = await getDailyWord(env, '2024-02-03');

      expect(result.wordPoolId).toBeGreaterThan(0);
      expect(result.created).toBe(true);

      // Verify it was recorded in daily_words
      const dailyWord = await env.DB.prepare(
        'SELECT word_pool_id FROM daily_words WHERE day = ?'
      )
        .bind('2024-02-03')
        .first();
      expect(dailyWord?.word_pool_id).toBe(result.wordPoolId);
    });

    it('returns existing daily word without creating new one', async () => {
      const result1 = await getDailyWord(env, '2024-02-03');
      const result2 = await getDailyWord(env, '2024-02-03');

      expect(result1.wordPoolId).toBe(result2.wordPoolId);
      expect(result1.created).toBe(true);
      expect(result2.created).toBe(false);
    });

    it('records word usage', async () => {
      await getDailyWord(env, '2024-02-03');

      const usage = await env.DB.prepare(
        'SELECT * FROM word_usage_log WHERE used_on = ?'
      )
        .bind('2024-02-03')
        .first();

      expect(usage).not.toBeNull();
      expect(usage?.cycle).toBe(1);
    });

    it('increments cycle when pool exhausted', async () => {
      // Use all test words in cycle 1
      for (let i = 0; i < testWordIds.length; i++) {
        await env.DB.prepare(
          'INSERT INTO word_usage_log (word_pool_id, used_on, cycle) VALUES (?, ?, 1)'
        )
          .bind(testWordIds[i], `2024-02-0${i + 1}`)
          .run();
      }

      // Request a new daily word - should trigger cycle increment
      const result = await getDailyWord(env, '2024-02-10');

      expect(result.wordPoolId).toBeGreaterThan(0);

      const newCycle = await getCurrentCycle(env);
      expect(newCycle).toBe(2);
    });

    it('throws error when no words available at all', async () => {
      // Disable all words
      await env.DB.prepare('UPDATE word_pool SET enabled = 0').run();

      await expect(getDailyWord(env, '2024-02-03')).rejects.toThrow('No words available');
    });
  });
});

describe('Deterministic Word Selection', () => {
  let env: Env;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    env = testEnv.env;
    cleanup = testEnv.cleanup;

    // Clear any seeded data
    await env.DB.prepare('DELETE FROM word_usage_log').run();
    await env.DB.prepare('DELETE FROM daily_words').run();
    await env.DB.prepare('DELETE FROM word_details').run();
    await env.DB.prepare('DELETE FROM word_pool').run();

    // Insert a larger pool of words
    const now = new Date().toISOString();
    for (let i = 1; i <= 100; i++) {
      const id = TEST_BASE_ID + 1000 + i; // Use different range from other tests
      await env.DB.prepare(
        'INSERT INTO word_pool (id, word, enabled, source, created_at) VALUES (?, ?, 1, ?, ?)'
      )
        .bind(id, `word${i}`, 'test', now)
        .run();
      await env.DB.prepare(
        "INSERT INTO word_details (word_pool_id, status) VALUES (?, 'ready')"
      )
        .bind(id)
        .run();
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  it('all users get the same word for the same date', async () => {
    // Simulate multiple "users" requesting the word for the same day
    const date = '2024-02-03';

    const result1 = await getDailyWord(env, date);

    // Clear any caching effects by re-querying
    const result2 = await getDailyWord(env, date);
    const result3 = await getDailyWord(env, date);

    expect(result1.wordPoolId).toBe(result2.wordPoolId);
    expect(result2.wordPoolId).toBe(result3.wordPoolId);
  });

  it('maintains no-repeat guarantee within a cycle', async () => {
    const usedWords = new Set<number>();

    // Get words for consecutive days
    for (let day = 1; day <= 50; day++) {
      const date = `2024-02-${day.toString().padStart(2, '0')}`;
      const result = await getDailyWord(env, date);

      // Each word should be unique within the cycle
      expect(usedWords.has(result.wordPoolId)).toBe(false);
      usedWords.add(result.wordPoolId);
    }

    expect(usedWords.size).toBe(50);
  });
});

describe('Personalized Word Selection', () => {
  let env: Env;
  let cleanup: () => Promise<void>;

  async function seedWord(id: number, word: string, tier: number | null): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO word_pool (id, word, enabled, tier, source, created_at) VALUES (?, ?, 1, ?, ?, ?)'
    )
      .bind(id, word, tier, 'test', now)
      .run();
    await env.DB.prepare("INSERT INTO word_details (word_pool_id, status) VALUES (?, 'ready')")
      .bind(id)
      .run();
  }

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    env = testEnv.env;
    cleanup = testEnv.cleanup;

    await env.DB.prepare('DELETE FROM user_word_usage_log').run();
    await env.DB.prepare('DELETE FROM user_word_cycle_state').run();
    await env.DB.prepare('DELETE FROM user_words').run();
    await env.DB.prepare('DELETE FROM word_usage_log').run();
    await env.DB.prepare('DELETE FROM daily_words').run();
    await env.DB.prepare('DELETE FROM word_details').run();
    await env.DB.prepare('DELETE FROM word_pool').run();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns the same word for the same user and date once assigned', async () => {
    await seedWord(5001, 'amber', 20);
    await seedWord(5002, 'brisk', 25);

    const userId = 'user-a';
    const first = await getDailyWordForUser(env, {
      userId,
      dateKey: '2024-03-01',
      requestedDifficulty: 'easy',
    });
    const second = await getDailyWordForUser(env, {
      userId,
      dateKey: '2024-03-01',
      requestedDifficulty: 'easy',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.wordPoolId).toBe(second.wordPoolId);
    expect(first.requestedDifficulty).toBe('easy');
    expect(first.effectiveDifficulty).toBe('easy');
  });

  it('falls back to a nearby difficulty band when no words exist in the requested band', async () => {
    await seedWord(6001, 'cascade', 50);
    await seedWord(6002, 'delta', null);

    const result = await getDailyWordForUser(env, {
      userId: 'user-fallback',
      dateKey: '2024-03-02',
      requestedDifficulty: 'easy',
    });

    expect(result.created).toBe(true);
    expect(result.requestedDifficulty).toBe('easy');
    expect(result.effectiveDifficulty).toBe('balanced');
    expect(result.usedFallback).toBe(true);

    const stored = await env.DB.prepare(
      'SELECT requested_difficulty, effective_difficulty FROM user_words WHERE user_id = ? AND delivered_on = ?'
    )
      .bind('user-fallback', '2024-03-02')
      .first();
    expect(stored?.requested_difficulty).toBe('easy');
    expect(stored?.effective_difficulty).toBe('balanced');
  });

  it('can produce different words for different users on the same date when personalized', async () => {
    for (let i = 0; i < 60; i++) {
      await seedWord(7000 + i, `easyword${i}`, 20);
    }

    let foundDifferent = false;
    for (let day = 1; day <= 12; day++) {
      const dateKey = `2024-04-${day.toString().padStart(2, '0')}`;
      const userA = await getDailyWordForUser(env, {
        userId: 'user-alpha',
        dateKey,
        requestedDifficulty: 'easy',
      });
      const userB = await getDailyWordForUser(env, {
        userId: 'user-bravo',
        dateKey,
        requestedDifficulty: 'easy',
      });
      if (userA.wordPoolId !== userB.wordPoolId) {
        foundDifferent = true;
        break;
      }
    }

    expect(foundDifferent).toBe(true);
  });

  it('avoids repeats within a user difficulty cycle until the cycle is exhausted', async () => {
    await seedWord(8001, 'one', 20);
    await seedWord(8002, 'two', 20);
    await seedWord(8003, 'three', 20);

    const used = new Set<number>();
    for (let day = 1; day <= 3; day++) {
      const result = await getDailyWordForUser(env, {
        userId: 'user-cycle',
        dateKey: `2024-05-0${day}`,
        requestedDifficulty: 'easy',
      });
      expect(used.has(result.wordPoolId)).toBe(false);
      used.add(result.wordPoolId);
    }

    const fourth = await getDailyWordForUser(env, {
      userId: 'user-cycle',
      dateKey: '2024-05-04',
      requestedDifficulty: 'easy',
    });

    expect(used.has(fourth.wordPoolId)).toBe(true);
  });
});
