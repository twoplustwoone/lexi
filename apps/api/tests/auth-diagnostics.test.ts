import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { classifyOutcome, describeRequest, recordSessionCheck } from '../src/auth/diagnostics';
import { createSession, inspectSession } from '../src/auth/sessions';
import { queryLogs } from '../src/notifications/logger';
import { createTestEnv } from './helpers';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/me', { headers });
}

const NO_TOKEN = { outcome: 'no_token' } as const;

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
      request({
        'sec-fetch-site': 'cross-site',
        origin: 'https://lexi.example.dev',
        'x-client-session': 'expected',
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
  it('names a cross-site refusal when the browser withheld the cookie', () => {
    const fingerprint = describeRequest(
      request({ 'sec-fetch-site': 'cross-site', 'x-client-session': 'expected' })
    );
    expect(classifyOutcome(NO_TOKEN, fingerprint)).toBe('cookie_withheld_cross_site');
  });

  it('separates cleared storage from a cookie lost on its own', () => {
    // Nothing came back at all, but the app knew it had signed in: the
    // browser threw the site away, flag and cookie together.
    const evicted = describeRequest(
      request({ 'sec-fetch-site': 'same-site', 'x-client-session': 'expected' })
    );
    expect(classifyOutcome(NO_TOKEN, evicted)).toBe('storage_cleared');

    // The device kept its other cookie, so only the session cookie went.
    const cookieOnly = describeRequest(
      request({
        'sec-fetch-site': 'same-site',
        cookie: 'anon_id=abc',
        'x-client-session': 'expected',
      })
    );
    expect(classifyOutcome(NO_TOKEN, cookieOnly)).toBe('cookie_missing');
  });

  it('does not report a first-time reader as a failure', () => {
    const stranger = describeRequest(request({ 'sec-fetch-site': 'same-site' }));
    expect(classifyOutcome(NO_TOKEN, stranger)).toBe('anonymous');
  });

  it('distinguishes an expired session from one that is not on record', () => {
    const fingerprint = describeRequest(request({ cookie: 'session=x' }));
    expect(
      classifyOutcome(
        {
          outcome: 'expired',
          userId: 'u',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-31T00:00:00.000Z',
        },
        fingerprint
      )
    ).toBe('expired');
    expect(classifyOutcome({ outcome: 'unknown_token' }, fingerprint)).toBe('unknown_token');
  });
});

describe('inspectSession', () => {
  it('reports a live session without disturbing it', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      await env.DB.prepare(
        'INSERT INTO users (id, timezone, is_anonymous, preferences_json, created_at) VALUES (?, ?, 1, ?, ?)'
      )
        .bind('user-1', 'UTC', '{}', DateTime.utc().toISO())
        .run();

      const session = await createSession(env, 'user-1');
      const lookup = await inspectSession(env, session.token);

      expect(lookup.outcome).toBe('valid');
      expect(lookup).toMatchObject({ userId: 'user-1' });
    } finally {
      await cleanup();
    }
  });

  it('keeps a recently expired session as evidence rather than deleting it', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      // A session that died yesterday, two days after it was issued — the
      // exact shape the "logged out again after a couple of days" report
      // would leave, and the row that has to survive to prove it.
      const createdAt = DateTime.utc().minus({ days: 3 }).toISO() as string;
      const expiresAt = DateTime.utc().minus({ days: 1 }).toISO() as string;
      const { hashToken } = await import('../src/utils/crypto');
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind('s1', 'user-1', hashToken('token-1', env.SESSION_SECRET), createdAt, expiresAt)
        .run();

      const { getSessionUserId } = await import('../src/auth/sessions');
      expect(await getSessionUserId(env, 'token-1')).toBeNull();

      const lookup = await inspectSession(env, 'token-1');
      expect(lookup.outcome).toBe('expired');
      expect(lookup).toMatchObject({ createdAt, expiresAt });
    } finally {
      await cleanup();
    }
  });

  it('purges a session once it is long past the forensic window', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const { hashToken } = await import('../src/utils/crypto');
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(
          's2',
          'user-1',
          hashToken('token-2', env.SESSION_SECRET),
          DateTime.utc().minus({ days: 90 }).toISO(),
          DateTime.utc().minus({ days: 60 }).toISO()
        )
        .run();

      const { getSessionUserId } = await import('../src/auth/sessions');
      expect(await getSessionUserId(env, 'token-2')).toBeNull();
      expect(await inspectSession(env, 'token-2')).toEqual({ outcome: 'unknown_token' });
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
});
