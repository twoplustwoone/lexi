import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import worker from '../src/index';
import { createCodeHash } from '../src/auth/otp';
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

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

describe('email code verification', () => {
  it('locks out after repeated invalid attempts', async () => {
    const { env, cleanup } = await createTestEnv();
    const email = 'otp@example.com';
    const recordId = crypto.randomUUID();
    const { hash, salt } = createCodeHash('123456');
    const expiresAt = DateTime.utc().plus({ minutes: 10 }).toISO() ?? nowIso();

    try {
      await env.DB.prepare(
        'INSERT INTO auth_codes (id, target, code_hash, salt, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(recordId, email, hash, salt, 'email_code', expiresAt, nowIso())
        .run();

      const ctx = createExecutionContext();
      const ip = '203.0.113.20';
      const emailKey = normalizeKeyPart(email);
      const ipKey = normalizeKeyPart(ip);

      const makeRequest = () =>
        worker.fetch(
          new Request('http://localhost/api/auth/email/code/verify', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'CF-Connecting-IP': ip,
            },
            body: JSON.stringify({ email, code: '000000' }),
          }),
          env,
          ctx
        );

      for (let i = 0; i < 5; i += 1) {
        const response = await makeRequest();
        expect(response.status).toBe(401);
        await env.KV.delete(`rl:auth:email-code:verify:email:${emailKey}`);
        await env.KV.delete(`rl:auth:email-code:verify:ip:${ipKey}`);
      }

      const rateLimited = await makeRequest();
      expect(rateLimited.status).toBe(429);

      const record = await env.DB.prepare('SELECT consumed_at FROM auth_codes WHERE id = ?')
        .bind(recordId)
        .first();
      expect(record?.consumed_at).not.toBeNull();
    } finally {
      await cleanup();
    }
  });
});
