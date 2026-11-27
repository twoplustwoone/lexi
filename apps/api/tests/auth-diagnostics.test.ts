import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { describeRequest, observeSession, recordSessionCheck } from '../src/auth/diagnostics';
import {
  buildSessionCookie,
  createSession,
  findQuietSessions,
  inspectSession,
  purgeExpiredSessions,
} from '../src/auth/sessions';
import worker from '../src/index';
import { logInfo, purgeExpiredAuthLogs, queryLogs } from '../src/notifications/logger';
import { hashToken } from '../src/utils/crypto';
import { createTestEnv } from './helpers';

type TestEnv = Awaited<ReturnType<typeof createTestEnv>>['env'];

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/me', { headers });
}

/** A device that completed a sign-in and never signed out. */
function signedInBefore(extra: Record<string, string> = {}): Request {
  return request({ 'x-client-session': 'expected', ...extra });
}

function executionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const NO_TOKEN = { outcome: 'no_token' } as const;

async function createUser(env: TestEnv, id = 'user-1') {
  await env.DB.prepare(
    'INSERT INTO users (id, timezone, is_anonymous, preferences_json, created_at) VALUES (?, ?, 1, ?, ?)'
  )
    .bind(id, 'UTC', '{}', DateTime.utc().toISO())
    .run();
}

describe('describeRequest', () => {
  it('records cookie names but never the session token itself', () => {
    const fingerprint = describeRequest(
      request({ cookie: 'session=super-secret-token; anon_id=abc' })
    );

    expect(fingerprint.cookieNames).toEqual(['anon_id', 'session']);
    expect(JSON.stringify(fingerprint)).not.toContain('super-secret-token');
  });

  it('reads the browser’s own view of the request', () => {
    const fingerprint = describeRequest(
      signedInBefore({
        'sec-fetch-site': 'cross-site',
        origin: 'https://lexi.example.dev',
        'x-client-display': 'standalone',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      })
    );

    expect(fingerprint.secFetchSite).toBe('cross-site');
    expect(fingerprint.originHost).toBe('lexi.example.dev');
    expect(fingerprint.clientExpectation).toBe('expected');
    expect(fingerprint.clientDisplay).toBe('standalone');
    expect(fingerprint.platform).toBe('ios');
  });
});

/**
 * Everything this returns has to be true by construction. The moment a value
 * here encodes a judgement about *why* — which cookie policy was at fault,
 * which storage the browser cleared — it is a guess written permanently into
 * an append-only table. Those judgements belong to `diagnoseSession`.
 */
describe('observeSession', () => {
  describe('a device that never claimed a session is never a loss', () => {
    it('does not report a first-time reader', () => {
      expect(observeSession(NO_TOKEN, describeRequest(request({})))).toBe('anonymous');
    });

    it('does not report one whose request the browser calls cross-site', () => {
      // The deployment where cross-site diagnosis matters is exactly the one
      // where every stranger's request looks like this.
      const stranger = describeRequest(request({ 'sec-fetch-site': 'cross-site' }));
      expect(observeSession(NO_TOKEN, stranger)).toBe('anonymous');
    });

    it('does not report one carrying an anonymous cookie', () => {
      const returning = describeRequest(
        request({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' })
      );
      expect(observeSession(NO_TOKEN, returning)).toBe('anonymous');
    });

    it('does not report one that has signed out', () => {
      const signedOut = describeRequest(
        request({ cookie: 'anon_id=abc', 'x-client-session': 'none' })
      );
      expect(observeSession(NO_TOKEN, signedOut)).toBe('anonymous');
    });
  });

  it('states only that the cookie did not come back, whatever the request looked like', () => {
    // Whether SameSite withheld it depends on the policy the cookie carries as
    // much as on the request, so that pairing is not decided here. All three
    // are the same observation; the evidence that separates them is recorded
    // alongside and weighed at reading time.
    const crossSite = describeRequest(signedInBefore({ 'sec-fetch-site': 'cross-site' }));
    const sameSite = describeRequest(
      signedInBefore({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' })
    );
    const emptyJar = describeRequest(signedInBefore({ 'sec-fetch-site': 'same-site' }));

    expect(observeSession(NO_TOKEN, crossSite)).toBe('no_session_cookie');
    expect(observeSession(NO_TOKEN, sameSite)).toBe('no_session_cookie');
    expect(observeSession(NO_TOKEN, emptyJar)).toBe('no_session_cookie');
  });

  it('trusts the row over the client for what the server can prove', () => {
    // Storage eviction takes the client's flag with the cookie, so a real loss
    // can arrive claiming nothing. A row is the server's own evidence.
    const noClaim = describeRequest(request({ cookie: 'session=x' }));
    expect(
      observeSession(
        {
          outcome: 'expired',
          sessionId: 's1',
          userId: 'u',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-31T00:00:00.000Z',
        },
        noClaim
      )
    ).toBe('expired');
    expect(observeSession({ outcome: 'unknown_token' }, noClaim)).toBe('unknown_token');
  });
});

/**
 * A session is lost once. Every mechanism below exists so that it is written
 * down once — otherwise one reader's repeated app opens outweigh everyone
 * else's and decide what the screen says.
 */
describe('one loss, one record', () => {
  it('discards a dead cookie so the same loss cannot be seen twice', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await createUser(env);
      const session = await createSession(env, 'user-1');
      await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .bind(DateTime.utc().minus({ hours: 1 }).toISO(), session.id)
        .run();

      const response = await worker.fetch(
        new Request('http://localhost/api/me', {
          headers: { cookie: `session=${session.token}`, 'x-client-session': 'expected' },
        }),
        env,
        executionContext()
      );

      expect(response.status).toBe(200);
      // The cookie deliberately outlives the row so the expiry can be seen
      // once. Clearing it here is the other half: without this the browser
      // would present the same dead token on every app open for a fortnight.
      const setCookie = response.headers.get('Set-Cookie') ?? '';
      expect(setCookie).toContain('session=;');
      expect(setCookie).toContain('Max-Age=0');
    } finally {
      await cleanup();
    }
  });

  it('does not record anonymous readers at all', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      for (let i = 0; i < 5; i += 1) {
        await recordSessionCheck(env, request({ 'sec-fetch-site': 'same-origin' }), NO_TOKEN, null);
      }

      // They support no diagnosis — no session, no session id, nothing lost —
      // and they are the bulk of all traffic, so recording them would push the
      // records that matter out of every window that reads them.
      expect(await queryLogs(env, { category: 'auth' })).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('keeps a live session as state on the session, not as a stream of events', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await createUser(env);
      const session = await createSession(env, 'user-1');
      await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .bind(DateTime.utc().minus({ days: 5 }).toISO(), session.id)
        .run();

      const lookup = await inspectSession(env, session.token);
      for (let i = 0; i < 5; i += 1) {
        await recordSessionCheck(env, request({ cookie: 'session=x' }), lookup, 'user-1');
      }

      // A session still being alive is not an event. Written as a heartbeat row
      // it forced one write per app open and made reading it back a scan of
      // every heartbeat ever recorded.
      expect(await queryLogs(env, { category: 'auth' })).toHaveLength(0);

      const row = (await env.DB.prepare('SELECT last_seen_at FROM sessions WHERE id = ?')
        .bind(session.id)
        .first()) as { last_seen_at: string };
      expect(Date.parse(row.last_seen_at)).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      await cleanup();
    }
  });

  it('stops counting a loss once the client has been told', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      // The request that discovers the loss still claims a session...
      await recordSessionCheck(
        env,
        signedInBefore({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' }),
        NO_TOKEN,
        'user-1'
      );
      // ...and every app open after it arrives with the claim dropped.
      for (let i = 0; i < 4; i += 1) {
        await recordSessionCheck(
          env,
          request({ cookie: 'anon_id=abc', 'x-client-session': 'none' }),
          NO_TOKEN,
          'user-1'
        );
      }

      const entries = await queryLogs(env, { category: 'auth' });
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('warn');
    } finally {
      await cleanup();
    }
  });
});

describe('the session cookie outlives the session', () => {
  it('carries the dead token long enough for the expired row to be found', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      // Given equal lifetimes the browser drops the cookie exactly when the row
      // expires, and every genuine expiry arrives as an empty request instead.
      const cookie = buildSessionCookie(env, 'token');
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
      const ttlSeconds = Number(env.SESSION_TTL_DAYS) * 24 * 60 * 60;

      expect(maxAge).toBeGreaterThan(ttlSeconds);
      expect(maxAge).toBe(ttlSeconds + 14 * 24 * 60 * 60);
    } finally {
      await cleanup();
    }
  });

  it('still refuses the token it keeps carrying', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await createUser(env);
      const session = await createSession(env, 'user-1');
      await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .bind(DateTime.utc().minus({ hours: 1 }).toISO(), session.id)
        .run();

      const { getSessionUserId } = await import('../src/auth/sessions');
      expect(await getSessionUserId(env, session.token)).toBeNull();

      const lookup = await inspectSession(env, session.token);
      expect(lookup.outcome).toBe('expired');
      expect(lookup).toMatchObject({ userId: 'user-1' });
    } finally {
      await cleanup();
    }
  });
});

describe('inspectSession', () => {
  it('reports a live session without disturbing it', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await createUser(env);
      const session = await createSession(env, 'user-1');
      const lookup = await inspectSession(env, session.token);

      expect(lookup.outcome).toBe('valid');
      expect(lookup).toMatchObject({ userId: 'user-1', sessionId: session.id });
    } finally {
      await cleanup();
    }
  });
});

describe('findQuietSessions', () => {
  /**
   * The only trace storage eviction leaves. It is a property of the session —
   * when it was last presented against when it was due to expire — so it is
   * answered by a query over sessions rather than by paging every heartbeat
   * ever written into the browser and aggregating there.
   */
  it('finds sessions that stopped being used while they still had time to run', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const insert = async (id: string, lastSeenDaysAgo: number, expiresInDays: number) =>
        env.DB.prepare(
          'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(
            id,
            'user-1',
            hashToken(id, env.SESSION_SECRET),
            DateTime.utc().minus({ days: 20 }).toISO(),
            DateTime.utc().plus({ days: expiresInDays }).toISO(),
            DateTime.utc().minus({ days: lastSeenDaysAgo }).toISO()
          )
          .run();

      await insert('quiet', 6, 20); // gone silent with weeks left to run
      await insert('active', 0, 20); // still in use
      await insert('ran-out', 6, -5); // was used right up to its expiry

      const quiet = await findQuietSessions(env, { quietDays: 3, windowDays: 30 });

      expect(quiet.map((session) => session.sessionId)).toEqual(['quiet']);
      expect(quiet[0].daysLeftWhenLastSeen).toBeGreaterThan(20);
    } finally {
      await cleanup();
    }
  });

  it('does not reach outside the window it was asked about', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(
          'ancient',
          'user-1',
          hashToken('ancient', env.SESSION_SECRET),
          DateTime.utc().minus({ days: 200 }).toISO(),
          DateTime.utc().minus({ days: 100 }).toISO(),
          DateTime.utc().minus({ days: 180 }).toISO()
        )
        .run();

      expect(await findQuietSessions(env, { quietDays: 3, windowDays: 30 })).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});

describe('purgeExpiredSessions', () => {
  it('keeps recent evidence and collects what is past the window', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const insert = async (id: string, expiredDaysAgo: number) =>
        env.DB.prepare(
          'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(
            id,
            'user-1',
            hashToken(id, env.SESSION_SECRET),
            DateTime.utc()
              .minus({ days: expiredDaysAgo + 30 })
              .toISO(),
            DateTime.utc().minus({ days: expiredDaysAgo }).toISO()
          )
          .run();

      await insert('recent', 2);
      await insert('stale', 60);
      // A sweep is the only thing that can collect these: nobody returns to
      // present the token that a request-driven purge would need.
      expect(await purgeExpiredSessions(env)).toBe(1);

      expect((await inspectSession(env, 'recent')).outcome).toBe('expired');
      expect((await inspectSession(env, 'stale')).outcome).toBe('unknown_token');
    } finally {
      await cleanup();
    }
  });
});

describe('purgeExpiredAuthLogs', () => {
  it('collects only its own category', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await logInfo(env, 'auth', 'old auth');
      await logInfo(env, 'push', 'old push');
      await env.DB.prepare('UPDATE notification_logs SET timestamp = ?')
        .bind(DateTime.utc().minus({ days: 90 }).toISO())
        .run();
      await logInfo(env, 'auth', 'fresh auth');

      expect(await purgeExpiredAuthLogs(env)).toBe(1);
      expect((await queryLogs(env, { category: 'auth' })).map((row) => row.message)).toEqual([
        'fresh auth',
      ]);
      expect(await queryLogs(env, { category: 'push' })).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
});

describe('recordSessionCheck', () => {
  it('writes the evidence a reading needs, and the age the session reached', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await recordSessionCheck(
        env,
        request({ cookie: 'session=x', 'sec-fetch-site': 'same-site' }),
        {
          outcome: 'expired',
          sessionId: 's1',
          userId: 'user-1',
          // Issued for seven days, two days ago — so it died five days early,
          // and its term is seven regardless of what the setting says now.
          createdAt: DateTime.utc().minus({ days: 2 }).toISO() as string,
          expiresAt: DateTime.utc().plus({ days: 5 }).toISO() as string,
        },
        'user-1'
      );

      const [entry] = await queryLogs(env, { category: 'auth' });
      expect(entry.level).toBe('warn');
      expect(entry.user_id).toBe('user-1');

      const metadata = JSON.parse(entry.metadata_json ?? '{}');
      expect(metadata.outcome).toBe('expired');
      expect(metadata.ageDays).toBeCloseTo(2, 0);
      expect(metadata.secFetchSite).toBe('same-site');

      // The term is taken from the session's own two dates, never from
      // configuration: SESSION_TTL_DAYS may have moved since it was issued,
      // and reading the current value would report a 7-day session as having
      // died three weeks early.
      expect(metadata.termDays).toBeCloseTo(7, 0);

      // Named for what it is. A rollout does not rewrite cookies already in
      // browsers, so this is the configuration at the time of the check and
      // not necessarily what issued the cookie that went missing.
      expect(metadata.configuredPolicy).toEqual({ sameSite: 'Lax', secure: false, ttlDays: 30 });
      expect(metadata.cookiePolicy).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
