import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import worker from '../src/index';
import { hashPassword } from '../src/utils/crypto';
import { createTestEnv } from './helpers';

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe('auth rate limits', () => {
  it('limits login attempts per identifier', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();
    const createdAt = nowIso();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, createdAt, 0, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      const passwordHash = hashPassword('correct-password');
      await env.DB.prepare(
        'INSERT INTO auth_email_password (user_id, email, password_hash, password_set, created_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, 'user@example.com', passwordHash, 1, createdAt)
        .run();

      const ctx = createExecutionContext();
      const makeRequest = () =>
        worker.fetch(
          new Request('http://localhost/api/auth/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'CF-Connecting-IP': '203.0.113.10',
            },
            body: JSON.stringify({
              email: 'user@example.com',
              password: 'wrong-password',
            }),
          }),
          env,
          ctx
        );

      for (let i = 0; i < 5; i += 1) {
        const response = await makeRequest();
        expect(response.status).toBe(401);
      }

      const rateLimited = await makeRequest();
      expect(rateLimited.status).toBe(429);
    } finally {
      await cleanup();
    }
  });
});
