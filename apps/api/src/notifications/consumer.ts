import { Env, NotificationJob } from '../env';
import { sendWebPushNotification } from './push';

export async function processNotificationQueue(
  env: Env,
  batch: MessageBatch<NotificationJob>
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    const subscriptions = await env.DB.prepare(
      'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
    )
      .bind(job.userId)
      .all();

    for (const sub of subscriptions.results as Array<{ endpoint: string }>) {
      try {
        const response = await sendWebPushNotification({
          endpoint: sub.endpoint,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        });
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
            .bind(sub.endpoint)
            .run();
        }
      } catch {
        // Skip failures; next scheduled run will retry.
      }
    }

    message.ack();
  }
}
