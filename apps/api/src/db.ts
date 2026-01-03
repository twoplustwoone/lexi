import { DateTime } from 'luxon';

import { DEFAULT_PREFERENCES, PreferencesV1 } from '@word-of-the-day/shared';

import { Env } from './env';

export interface UserRecord {
  id: string;
  created_at: string;
  is_anonymous: number;
  is_admin?: number;
  timezone: string;
  preferences_json: string;
  merged_into_user_id: string | null;
  username?: string | null;
}

export interface NotificationScheduleRecord {
  user_id: string;
  delivery_time: string;
  timezone: string;
  enabled: number;
  next_delivery_at: string;
  updated_at: string;
}

export async function getUserById(env: Env, id: string): Promise<UserRecord | null> {
  const result = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return (result as unknown as UserRecord) ?? null;
}

export async function createAnonymousUser(
  env: Env,
  id: string,
  timezone: string,
  preferences: PreferencesV1 = DEFAULT_PREFERENCES
): Promise<void> {
  const now = DateTime.utc().toISO();
  await env.DB.prepare(
    'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, now, 1, timezone, JSON.stringify(preferences))
    .run();
}

export async function updateUserPreferences(
  env: Env,
  userId: string,
  preferences: PreferencesV1
): Promise<void> {
  await env.DB.prepare('UPDATE users SET preferences_json = ? WHERE id = ?')
    .bind(JSON.stringify(preferences), userId)
    .run();
}

export async function updateUserTimezone(
  env: Env,
  userId: string,
  timezone: string
): Promise<void> {
  await env.DB.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(timezone, userId).run();
}

export async function getNotificationSchedule(
  env: Env,
  userId: string
): Promise<NotificationScheduleRecord | null> {
  const result = await env.DB.prepare('SELECT * FROM notification_schedules WHERE user_id = ?')
    .bind(userId)
    .first();
  return (result as unknown as NotificationScheduleRecord) ?? null;
}

export async function upsertNotificationSchedule(
  env: Env,
  data: {
    userId: string;
    deliveryTime: string;
    timezone: string;
    enabled: boolean;
    nextDeliveryAt: string;
  }
): Promise<void> {
  const now = DateTime.utc().toISO();
  await env.DB.prepare(
    `INSERT INTO notification_schedules (user_id, delivery_time, timezone, enabled, next_delivery_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       delivery_time = excluded.delivery_time,
       timezone = excluded.timezone,
       enabled = excluded.enabled,
       next_delivery_at = excluded.next_delivery_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      data.userId,
      data.deliveryTime,
      data.timezone,
      data.enabled ? 1 : 0,
      data.nextDeliveryAt,
      now
    )
    .run();
}
