import { DateTime } from 'luxon';

import { getLocalDateKey } from '@word-of-the-day/shared';

import { buildServerEvent, recordEvent } from '../analytics';
import { Env } from '../env';
import { getDailyWordId } from '../words';
import { logError, logInfo, logWarn } from './logger';
import { sendWebPushNotification } from './push';

const BATCH_SIZE = 50;

export interface CronStats {
  schedulesProcessed: number;
  pushSent: number;
  pushFailed: number;
  durationMs: number;
}

export async function processDueSchedules(env: Env): Promise<CronStats> {
  const startTime = Date.now();
  const nowIso = DateTime.utc().toISO();
  if (!nowIso) {
    throw new Error('Failed to get current UTC time');
  }

  await logInfo(env, 'cron', 'Cron job started', { nowIso });

  let totalProcessed = 0;
  let totalPushSent = 0;
  let totalPushFailed = 0;
  let hasMore = true;

  try {
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

      await logInfo(env, 'cron', `Processing batch of ${schedules.length} schedules`);

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
        } else {
          await logInfo(
            env,
            'cron',
            'Word already delivered for schedule; sending notification anyway',
            { userId: schedule.user_id, wordId, dateKey },
            schedule.user_id
          );
        }
        const pushResult = await sendPushNotificationsForUser(env, schedule.user_id);
        totalPushSent += pushResult.sent;
        totalPushFailed += pushResult.failed;

        const nextDelivery = computeNextDelivery(schedule.timezone, schedule.delivery_time);
        const updateTime = DateTime.utc().toISO();
        await env.DB.prepare(
          'UPDATE notification_schedules SET next_delivery_at = ?, updated_at = ? WHERE user_id = ?'
        )
          .bind(nextDelivery, updateTime, schedule.user_id)
          .run();

        totalProcessed++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logInfo(env, 'cron', 'Cron job completed', {
      durationMs,
      schedulesProcessed: totalProcessed,
      pushSent: totalPushSent,
      pushFailed: totalPushFailed,
    });

    return {
      schedulesProcessed: totalProcessed,
      pushSent: totalPushSent,
      pushFailed: totalPushFailed,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await logError(env, 'cron', 'Cron job failed with exception', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs,
      schedulesProcessed: totalProcessed,
    });
    throw error;
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

export interface PushResult {
  sent: number;
  failed: number;
}

/**
 * Send push notifications directly to all subscriptions for a user.
 * Cleans up dead subscriptions (404/410 responses).
 * Returns statistics about sent/failed notifications.
 */
async function sendPushNotificationsForUser(env: Env, userId: string): Promise<PushResult> {
  const subscriptions = await env.DB.prepare(
    'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
  )
    .bind(userId)
    .all();

  const results = subscriptions.results as Array<{ endpoint: string }>;

  if (results.length === 0) {
    await logWarn(env, 'push', 'No push subscriptions found for user', { userId }, userId);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Send to all subscriptions in parallel
  await Promise.all(
    results.map(async (sub) => {
      const endpointDomain = new URL(sub.endpoint).host;
      try {
        const response = await sendWebPushNotification({
          endpoint: sub.endpoint,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        });

        if (response.status === 201) {
          sent++;
          await logInfo(
            env,
            'push',
            'Push notification sent successfully',
            { status: response.status, endpointDomain },
            userId
          );
        } else if (response.status === 404 || response.status === 410) {
          // Subscription expired/invalid - clean up
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
            .bind(sub.endpoint)
            .run();
          failed++;
          await logWarn(
            env,
            'push',
            'Subscription expired, removed from database',
            { status: response.status, endpointDomain },
            userId
          );
        } else {
          // Other error response
          failed++;
          const body = await response.text().catch(() => 'unable to read body');
          await logError(
            env,
            'push',
            'Push failed with unexpected status',
            {
              status: response.status,
              statusText: response.statusText,
              body: body.slice(0, 500),
              endpointDomain,
            },
            userId
          );
        }
      } catch (error) {
        failed++;
        await logError(
          env,
          'push',
          'Push request threw exception',
          {
            error: error instanceof Error ? error.message : String(error),
            endpointDomain,
          },
          userId
        );
      }
    })
  );

  return { sent, failed };
}
