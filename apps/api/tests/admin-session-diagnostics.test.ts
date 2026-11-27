import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { createSession } from '../src/auth/sessions';
import type { Env } from '../src/env';
import worker from '../src/index';
import { logWarn } from '../src/notifications/logger';
import { hashToken } from '../src/utils/crypto';
import { createTestEnv } from './helpers';

/**
 * The contract the Sessions screen reads.
 *
 * This endpoint exists because the screen used to page the raw log into the
 * browser and aggregate there, which put a row cap between it and the window
 * it claimed to show. Everything it now believes comes from this shape, so the
 * shape is worth pinning: a field quietly renamed here does not fail a build,
 * it just empties a panel that then looks like good news.
 */

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function nowIso(): string {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

async function seedUser(env: Env, options: { admin: boolean }): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users
       (id, created_at, is_anonymous, is_admin, timezone, preferences_json)
     VALUES (?, ?, 0, ?, 'UTC', ?)`
  )
    .bind(id, nowIso(), options.admin ? 1 : 0, JSON.stringify(DEFAULT_PREFERENCES))
    .run();
  return id;
}

async function seedSessionCookie(env: Env, options: { admin: boolean }): Promise<string> {
  const userId = await seedUser(env, options);
  const session = await createSession(env, userId);
  return `session=${session.token}`;
}

async function get(env: Env, path: string, cookie?: string): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined),
    env,
    createExecutionContext()
  );
}

describe('GET /api/admin/session-diagnostics', () => {
  it('is closed to anyone who is not an admin', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      expect((await get(env, '/api/admin/session-diagnostics')).status).toBe(401);

      const reader = await seedSessionCookie(env, { admin: false });
      expect((await get(env, '/api/admin/session-diagnostics', reader)).status).toBe(403);
    } finally {
      await cleanup();
    }
  });

  it('returns the losses and the quiet sessions the screen reads', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const admin = await seedSessionCookie(env, { admin: true });

      await logWarn(env, 'auth', 'Session found past its expiry', {
        outcome: 'expired',
        ageDays: 2,
        termDays: 30,
        secFetchSite: 'same-site',
        configuredPolicy: { sameSite: 'Lax', secure: true, ttlDays: 30 },
      });

      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          'quiet-one',
          'someone',
          hashToken('quiet-one', env.SESSION_SECRET),
          DateTime.utc().minus({ days: 10 }).toISO(),
          DateTime.utc().plus({ days: 20 }).toISO(),
          DateTime.utc().minus({ days: 6 }).toISO()
        )
        .run();

      const response = await get(env, '/api/admin/session-diagnostics?days=30', admin);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        days: number;
        quietDays: number;
        losses: Array<{ timestamp: string; metadata: Record<string, unknown> }>;
        quiet: Array<{ sessionId: string; daysLeftWhenLastSeen: number }>;
      };

      expect(body.days).toBe(30);
      expect(body.quietDays).toBe(3);

      // The loss carries the evidence `diagnoseSession` reads. Without these
      // exact keys the screen still renders, but every reading silently
      // degrades to its least specific branch.
      expect(body.losses).toHaveLength(1);
      expect(body.losses[0].metadata).toMatchObject({
        outcome: 'expired',
        ageDays: 2,
        termDays: 30,
        secFetchSite: 'same-site',
        configuredPolicy: { sameSite: 'Lax' },
      });

      expect(body.quiet.map((session) => session.sessionId)).toEqual(['quiet-one']);
      expect(body.quiet[0].daysLeftWhenLastSeen).toBeGreaterThan(20);
    } finally {
      await cleanup();
    }
  });

  it('reports only losses, never the routine records', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const admin = await seedSessionCookie(env, { admin: true });

      // Signing in is recorded at info. It is context, not a loss, and
      // counting it would put an ordinary event into the tally that decides
      // what the screen concludes.
      const response = await get(env, '/api/admin/session-diagnostics', admin);
      const body = (await response.json()) as { losses: unknown[] };

      // The admin's own sign-in above wrote a session row but no warn record.
      expect(body.losses).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('does not reach outside the window it was asked for', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const admin = await seedSessionCookie(env, { admin: true });

      await logWarn(env, 'auth', 'Session found past its expiry', { outcome: 'expired' });
      await env.DB.prepare("UPDATE notification_logs SET timestamp = ? WHERE category = 'auth'")
        .bind(DateTime.utc().minus({ days: 40 }).toISO())
        .run();

      // Windowing happens in SQL. Filtering after a capped fetch is what let a
      // busy week push older losses out of a month-long view unnoticed.
      const inWindow = (await (
        await get(env, '/api/admin/session-diagnostics?days=7', admin)
      ).json()) as {
        losses: unknown[];
      };
      expect(inWindow.losses).toHaveLength(0);

      const wider = (await (
        await get(env, '/api/admin/session-diagnostics?days=90', admin)
      ).json()) as {
        losses: unknown[];
      };
      expect(wider.losses).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
});
