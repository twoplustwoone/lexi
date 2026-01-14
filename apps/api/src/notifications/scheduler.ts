import { DateTime } from 'luxon';

import { getLocalDateKey } from '@word-of-the-day/shared';

import { buildServerEvent, recordEvent } from '../analytics';
import { Env } from '../env';
import { getDailyWordId } from '../words';
import { sendWebPushNotification } from './push';

const BATCH_SIZE = 50;

export async function processDueSchedules(env: Env): Promise<void> {
  const nowIso = DateTime.utc().toISO();
  let hasMore = true;

  while (hasMore) {
    const result = await env.DB.prepare(
      'SELECT * FROM notification_schedules WHERE enabled = 1 AND next_delivery_at <= ? LIMIT ?'
    )
      .bind(nowIso, BATCH_SIZE)
      .all();

    const schedules = result.results as Array<{
      user_id: string;
      delivery_time: string;
      timezone: string;
      next_delivery_at: string;
    }>;

    if (!schedules.length) {
      hasMore = false;
      break;
    }

    for (const schedule of schedules) {
      const scheduledAt = DateTime.fromISO(schedule.next_delivery_at, { zone: 'utc' }).toJSDate();
      const dateKey = getLocalDateKey(scheduledAt, schedule.timezone);
      const wordId = await getDailyWordId(env, dateKey);
      const delivered = await ensureUserWordDelivered(env, schedule.user_id, wordId, dateKey);

      if (delivered) {
        await recordEvent(
          env,
          buildServerEvent({
            name: 'word_delivered',
            userId: schedule.user_id,
            metadata: { source: 'scheduled' },
          })
        );
        // Send push notifications directly (no queue needed)
        await sendPushNotificationsForUser(env, schedule.user_id);
      }

      const nextDelivery = computeNextDelivery(schedule.timezone, schedule.delivery_time);
      await env.DB.prepare(
        'UPDATE notification_schedules SET next_delivery_at = ?, updated_at = ? WHERE user_id = ?'
      )
        .bind(nextDelivery, DateTime.utc().toISO(), schedule.user_id)
        .run();
    }
  }
}

async function ensureUserWordDelivered(
  env: Env,
  userId: string,
  wordId: number,
  dateKey: string
): Promise<boolean> {
  const nowIso = DateTime.utc().toISO();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO user_words (user_id, word_id, delivered_at, delivered_on) VALUES (?, ?, ?, ?)'
  )
    .bind(userId, wordId, nowIso, dateKey)
    .run();

  const changes = result.meta?.changes ?? 0;
  return changes > 0;
}

function computeNextDelivery(timezone: string, deliveryTime: string): string {
  const [hour, minute] = deliveryTime.split(':').map(Number);
  const nowLocal = DateTime.now().setZone(timezone);
  const nextLocal = nowLocal.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  const iso = nextLocal.toUTC().toISO();
  if (!iso) {
    throw new Error('Invalid delivery time');
  }
  return iso;
}

/**
 * Send push notifications directly to all subscriptions for a user.
 * Cleans up dead subscriptions (404/410 responses).
 */
async function sendPushNotificationsForUser(env: Env, userId: string): Promise<void> {
  const subscriptions = await env.DB.prepare(
    'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
  )
    .bind(userId)
    .all();

  const results = subscriptions.results as Array<{ endpoint: string }>;

  // Send to all subscriptions in parallel
  await Promise.all(
    results.map(async (sub) => {
      try {
        const response = await sendWebPushNotification({
          endpoint: sub.endpoint,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        });
        // Clean up dead subscriptions
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
            .bind(sub.endpoint)
            .run();
        }
      } catch {
        // Skip failures silently; user can still open the app to see the word
      }
    })
  );
}
