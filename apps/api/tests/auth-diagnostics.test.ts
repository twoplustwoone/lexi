import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { classifyOutcome, describeRequest, recordSessionCheck } from '../src/auth/diagnostics';
import {
  buildSessionCookie,
  createSession,
  inspectSession,
  purgeExpiredSessions,
} from '../src/auth/sessions';
import { logInfo, purgeExpiredAuthLogs, queryLogs } from '../src/notifications/logger';
import { hashToken } from '../src/utils/crypto';
import { createTestEnv } from './helpers';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/me', { headers });
}

/** A device that completed a sign-in and never signed out. */
function signedInBefore(extra: Record<string, string> = {}): Request {
  return request({ 'x-client-session': 'expected', ...extra });
}

const NO_TOKEN = { outcome: 'no_token' } as const;

async function createUser(env: Awaited<ReturnType<typeof createTestEnv>>['env'], id = 'user-1') {
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
    expect(fingerprint.hadCookies).toBe(false);
  });
});

describe('classifyOutcome', () => {
  describe('a device that never signed in is never a sign-out', () => {
    // Each of these would otherwise be counted as an incident, and readers who
    // never sign in are the overwhelming majority of requests.

    it('does not report a first-time reader', () => {
      expect(classifyOutcome(NO_TOKEN, describeRequest(request({})))).toBe('anonymous');
    });

    it('does not report one whose request the browser calls cross-site', () => {
      // The deployment where cross-site diagnosis matters is exactly the one
      // where every stranger's request looks like this.
      const stranger = describeRequest(request({ 'sec-fetch-site': 'cross-site' }));
      expect(classifyOutcome(NO_TOKEN, stranger)).toBe('anonymous');
    });

    it('does not report one carrying an anonymous cookie', () => {
      // /api/me hands every anonymous reader an anon_id, so from their second
      // request onwards they arrive with cookies but no session.
      const returning = describeRequest(
        request({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' })
      );
      expect(classifyOutcome(NO_TOKEN, returning)).toBe('anonymous');
    });

    it('does not report one that has signed out', () => {
      const signedOut = describeRequest(
        request({ cookie: 'anon_id=abc', 'x-client-session': 'none' })
      );
      expect(classifyOutcome(NO_TOKEN, signedOut)).toBe('anonymous');
    });
  });

  describe('a device that had signed in', () => {
    it('names a cross-site refusal', () => {
      const fingerprint = describeRequest(signedInBefore({ 'sec-fetch-site': 'cross-site' }));
      expect(classifyOutcome(NO_TOKEN, fingerprint)).toBe('cookie_withheld_cross_site');
    });

    it('reports a missing session cookie without reading the rest of the jar', () => {
      // The app registers an anonymous identity before it asks /api/me, and
      // that endpoint always sets an anon_id, so the jar is refilled before
      // this request arrives. Whether the reader had emptied it is no longer
      // visible, and both of these are the same observation.
      const sessionOnly = describeRequest(
        signedInBefore({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' })
      );
      expect(classifyOutcome(NO_TOKEN, sessionOnly)).toBe('cookie_missing');

      const emptyJar = describeRequest(signedInBefore({ 'sec-fetch-site': 'same-site' }));
      expect(classifyOutcome(NO_TOKEN, emptyJar)).toBe('cookie_missing');
    });
  });

  it('trusts the row over the client for outcomes the server can prove', () => {
    // Storage eviction takes the client's flag with the cookie, so a real
    // sign-out can arrive claiming nothing. An expired or unrecognised row is
    // the server's own evidence that a session existed, and still counts.
    const noClaim = describeRequest(request({ cookie: 'session=x' }));
    expect(
      classifyOutcome(
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
    expect(classifyOutcome({ outcome: 'unknown_token' }, noClaim)).toBe('unknown_token');
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

      // ...but the row is still there to say how long it lasted.
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
            DateTime.utc().minus({ days: expiredDaysAgo + 30 }).toISO(),
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
  it('writes a readable record with the age the session reached', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await recordSessionCheck(
        env,
        request({ cookie: 'session=x', 'sec-fetch-site': 'same-site' }),
        {
          outcome: 'expired',
          sessionId: 's1',
          userId: 'user-1',
          createdAt: DateTime.utc().minus({ days: 2 }).toISO() as string,
          expiresAt: DateTime.utc().minus({ hours: 1 }).toISO() as string,
        },
        'user-1'
      );

      const [entry] = await queryLogs(env, { category: 'auth' });
      expect(entry.level).toBe('warn');
      expect(entry.user_id).toBe('user-1');

      const metadata = JSON.parse(entry.metadata_json ?? '{}');
      expect(metadata.outcome).toBe('expired');
      expect(metadata.ageDays).toBeCloseTo(2, 0);
      // The policy the cookie was issued under, so the record can be read
      // against it rather than against an assumption about it.
      expect(metadata.cookiePolicy).toEqual({ sameSite: 'Lax', secure: false, ttlDays: 30 });
    } finally {
      await cleanup();
    }
  });

  it('logs an ordinary anonymous visit without raising a warning', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await recordSessionCheck(env, request({ 'sec-fetch-site': 'same-origin' }), NO_TOKEN, null);

      const [entry] = await queryLogs(env, { category: 'auth' });
      expect(entry.level).toBe('info');
      expect(JSON.parse(entry.metadata_json ?? '{}').outcome).toBe('anonymous');
    } finally {
      await cleanup();
    }
  });

  it('records an accepted session once, not once per app open', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const lookup = {
        outcome: 'valid',
        sessionId: 's1',
        userId: 'user-1',
        createdAt: DateTime.utc().minus({ days: 1 }).toISO() as string,
        expiresAt: DateTime.utc().plus({ days: 29 }).toISO() as string,
      } as const;

      for (let i = 0; i < 5; i += 1) {
        await recordSessionCheck(env, request({ cookie: 'session=x' }), lookup, 'user-1');
      }

      expect(await queryLogs(env, { category: 'auth' })).toHaveLength(1);
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
      // ...and every app open after it arrives with the flag cleared, so the
      // same incident is not re-counted into the verdict for weeks.
      for (let i = 0; i < 4; i += 1) {
        await recordSessionCheck(
          env,
          request({ cookie: 'anon_id=abc', 'x-client-session': 'none' }),
          NO_TOKEN,
          'user-1'
        );
      }

      const entries = await queryLogs(env, { category: 'auth' });
      expect(entries.filter((entry) => entry.level === 'warn')).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('never throttles a sign-out away', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      for (let i = 0; i < 3; i += 1) {
        await recordSessionCheck(
          env,
          signedInBefore({ cookie: 'anon_id=abc', 'sec-fetch-site': 'same-site' }),
          NO_TOKEN,
          'user-1'
        );
      }

      const entries = await queryLogs(env, { category: 'auth' });
      expect(entries).toHaveLength(3);
      expect(entries.every((entry) => entry.level === 'warn')).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
