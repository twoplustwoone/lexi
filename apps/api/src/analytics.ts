import { DateTime } from 'luxon';

import { eventSchema } from '@word-of-the-day/shared';

import { Env } from './env';

export async function recordEvent(env: Env, event: unknown): Promise<void> {
  const parsed = eventSchema.parse(event);
  await env.DB.prepare(
    'INSERT INTO analytics_events (id, event_name, timestamp, user_id, client, metadata_json) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      parsed.event_name,
      parsed.timestamp,
      parsed.user_id,
      parsed.client,
      parsed.metadata ? JSON.stringify(parsed.metadata) : null
    )
    .run();
}

export function buildServerEvent(params: {
  name: string;
  userId: string;
  client?: 'web' | 'pwa';
  metadata?: Record<string, string | number | boolean>;
}): {
  event_name: string;
  timestamp: string;
  user_id: string;
  client: 'web' | 'pwa';
  metadata?: Record<string, string | number | boolean>;
} {
  return {
    event_name: params.name,
    timestamp: DateTime.utc().toISO(),
    user_id: params.userId,
    client: params.client ?? 'web',
    metadata: params.metadata,
  };
}
