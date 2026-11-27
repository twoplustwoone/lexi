import { describe, expect, it } from 'vitest';

import worker from '../src/index';
import { createTestEnv } from './helpers';

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe('anonymous identity cookies', () => {
  it('sets anon_id cookie and accepts it on /api/me', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request('http://localhost/api/identity/anonymous', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ timezone: 'UTC' }),
        }),
        env,
        ctx
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as { user_id: string };
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain(`anon_id=${payload.user_id}`);

      const cookiePair = setCookie?.split(';')[0] ?? '';
      const meResponse = await worker.fetch(
        new Request('http://localhost/api/me', {
          method: 'GET',
          headers: {
            Cookie: cookiePair,
          },
        }),
        env,
        ctx
      );

      expect(meResponse.status).toBe(200);
      const mePayload = (await meResponse.json()) as { user_id: string | null };
      expect(mePayload.user_id).toBe(payload.user_id);
    } finally {
      await cleanup();
    }
  });
});
