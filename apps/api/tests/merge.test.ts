import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import { mergeAnonymousIntoUser } from '../src/auth/merge';
import { createTestEnv } from './helpers';

function nowIso() {
  return DateTime.utc().toISO();
}

describe('mergeAnonymousIntoUser', () => {
  it('moves history, schedule, and subscriptions without duplicates', async () => {
    const { env, cleanup } = await createTestEnv();
    const anonId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(anonId, nowIso(), 1, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, nowIso(), 0, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      await env.DB.prepare(
        'INSERT INTO notification_schedules (user_id, delivery_time, timezone, enabled, next_delivery_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(anonId, '09:00', 'UTC', 1, nowIso(), nowIso())
        .run();

      await env.DB.prepare(
        'INSERT INTO user_words (user_id, word_id, delivered_at, delivered_on) VALUES (?, ?, ?, ?)'
      )
        .bind(anonId, 1, nowIso(), '2024-01-01')
        .run();

      await env.DB.prepare(
        'INSERT INTO user_words (user_id, word_id, delivered_at, delivered_on) VALUES (?, ?, ?, ?)'
      )
        .bind(userId, 2, nowIso(), '2024-01-02')
        .run();

      await env.DB.prepare(
        'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(crypto.randomUUID(), anonId, 'https://example.com/push/1', 'p256', 'auth', nowIso())
        .run();

      await mergeAnonymousIntoUser(env, anonId, userId);

      const mergedHistory = await env.DB.prepare(
        'SELECT word_id FROM user_words WHERE user_id = ? ORDER BY word_id'
      )
        .bind(userId)
        .all();

      expect(mergedHistory.results.map((row: any) => row.word_id)).toEqual([1, 2]);

      const schedule = await env.DB.prepare(
        'SELECT user_id FROM notification_schedules WHERE user_id = ?'
      )
        .bind(userId)
        .first();

      expect(schedule).not.toBeNull();

      const subscription = await env.DB.prepare(
        'SELECT user_id FROM push_subscriptions WHERE endpoint = ?'
      )
        .bind('https://example.com/push/1')
        .first();

      expect(subscription?.user_id).toBe(userId);

      const anon = await env.DB.prepare('SELECT merged_into_user_id FROM users WHERE id = ?')
        .bind(anonId)
        .first();
      expect(anon?.merged_into_user_id).toBe(userId);
    } finally {
      await cleanup();
    }
  });
});
