import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import { processDueSchedules } from '../src/notifications/scheduler';
import { createTestEnv } from './helpers';

describe('processDueSchedules', () => {
  it('delivers due words and enqueues notifications', async () => {
    const { env, queueMessages, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, DateTime.utc().toISO(), 0, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      await env.DB.prepare(
        'INSERT INTO notification_schedules (user_id, delivery_time, timezone, enabled, next_delivery_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(
          userId,
          '09:00',
          'UTC',
          1,
          DateTime.utc().minus({ minutes: 1 }).toISO(),
          DateTime.utc().toISO()
        )
        .run();

      await processDueSchedules(env);

      const delivered = await env.DB.prepare('SELECT word_id FROM user_words WHERE user_id = ?')
        .bind(userId)
        .first();

      expect(delivered).not.toBeNull();
      expect(queueMessages.length).toBe(1);

      const schedule = await env.DB.prepare(
        'SELECT next_delivery_at FROM notification_schedules WHERE user_id = ?'
      )
        .bind(userId)
        .first();

      expect(schedule?.next_delivery_at).toBeTruthy();

      const event = await env.DB.prepare(
        'SELECT event_name FROM analytics_events WHERE user_id = ?'
      )
        .bind(userId)
        .first();

      expect(event?.event_name).toBe('word_delivered');
    } finally {
      await cleanup();
    }
  });
});
