import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import worker from '../src/index';
import { createTestEnv } from './helpers';

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as ExecutionContext;
}

describe('push allowlist', () => {
  it('rejects non-allowlisted endpoints', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();
    const createdAt = nowIso();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, createdAt, 1, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request('http://localhost/api/notifications/subscribe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-anon-id': userId,
          },
          body: JSON.stringify({
            endpoint: 'http://evil.example.com/push',
            keys: { p256dh: 'test', auth: 'test' },
          }),
        }),
        env,
        ctx
      );

      expect(response.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it('accepts allowlisted endpoints', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();
    const createdAt = nowIso();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, createdAt, 1, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request('http://localhost/api/notifications/subscribe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-anon-id': userId,
          },
          body: JSON.stringify({
            endpoint: 'https://fcm.googleapis.com/fcm/send/test',
            keys: { p256dh: 'test', auth: 'test' },
          }),
        }),
        env,
        ctx
      );

      expect(response.status).toBe(200);
    } finally {
      await cleanup();
    }
  });
});
