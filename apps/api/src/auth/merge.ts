import { DEFAULT_PREFERENCES, normalizePreferences } from '@word-of-the-day/shared';

import { Env } from '../env';

export async function mergeAnonymousIntoUser(
  env: Env,
  anonId: string,
  userId: string
): Promise<void> {
  if (anonId === userId) {
    return;
  }
  const anon = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_anonymous = 1')
    .bind(anonId)
    .first();
  if (!anon) {
    return;
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_words (user_id, word_id, delivered_at, delivered_on, viewed_at)
     SELECT ?, word_id, delivered_at, delivered_on, viewed_at FROM user_words WHERE user_id = ?`
  )
    .bind(userId, anonId)
    .run();

  const targetUser = await env.DB.prepare('SELECT preferences_json FROM users WHERE id = ?')
    .bind(userId)
    .first();
  if (targetUser?.preferences_json) {
    try {
      const parsed = JSON.parse(targetUser.preferences_json as string);
      const normalized = normalizePreferences(parsed);
      const isDefault = JSON.stringify(normalized) === JSON.stringify(DEFAULT_PREFERENCES);
      if (isDefault) {
        await env.DB.prepare('UPDATE users SET preferences_json = ? WHERE id = ?')
          .bind(anon.preferences_json, userId)
          .run();
      }
    } catch {
      await env.DB.prepare('UPDATE users SET preferences_json = ? WHERE id = ?')
        .bind(anon.preferences_json, userId)
        .run();
    }
  }

  const targetSchedule = await env.DB.prepare(
    'SELECT user_id FROM notification_schedules WHERE user_id = ?'
  )
    .bind(userId)
    .first();

  if (!targetSchedule) {
    await env.DB.prepare(
      `INSERT INTO notification_schedules (user_id, delivery_time, timezone, enabled, next_delivery_at, updated_at)
       SELECT ?, delivery_time, timezone, enabled, next_delivery_at, updated_at
       FROM notification_schedules WHERE user_id = ?`
    )
      .bind(userId, anonId)
      .run();
  }

  await env.DB.prepare('UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?')
    .bind(userId, anonId)
    .run();

  await env.DB.prepare('UPDATE users SET merged_into_user_id = ? WHERE id = ?')
    .bind(userId, anonId)
    .run();
}
