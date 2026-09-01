import { DateTime } from 'luxon';

import { Env } from '../env';
import { base64UrlEncode } from '../utils/base64';
import { hashToken, randomBytes } from '../utils/crypto';

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

export async function createSession(
  env: Env,
  userId: string
): Promise<{ token: string } & SessionRecord> {
  const tokenBytes = randomBytes(32);
  const token = base64UrlEncode(tokenBytes);
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  const now = DateTime.utc();
  const expiresAt = now.plus({ days: Number(env.SESSION_TTL_DAYS || '30') }).toISO();
  const sessionId = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(sessionId, userId, tokenHash, now.toISO(), expiresAt)
    .run();

  return { token, id: sessionId, userId, expiresAt };
}

/**
 * What a session token turned out to be. `getSessionUserId` only needs to know
 * whether it may proceed, but diagnosing an unwanted sign-out needs the
 * difference between a session that expired and one that was never here — the
 * first is a TTL question, the second means the row was purged or
 * `SESSION_SECRET` changed underneath it.
 */
export type SessionLookup =
  | { outcome: 'no_token' }
  | { outcome: 'unknown_token' }
  | {
      outcome: 'expired';
      sessionId: string;
      userId: string;
      createdAt: string;
      expiresAt: string;
    }
  | { outcome: 'valid'; sessionId: string; userId: string; createdAt: string; expiresAt: string };

/**
 * How long an expired session is kept as evidence before the sweep removes it.
 *
 * Deleting on sight is what made the "logged out again" reports impossible to
 * chase: the row that would have said when the session was issued and how long
 * it lasted was gone by the time anyone came asking. Expired rows are inert —
 * the check in `inspectSession` rejects them either way — so they are held for
 * a fortnight instead, and `purgeExpiredSessions` clears them on the cron.
 */
export const EXPIRED_SESSION_RETENTION_DAYS = 14;

/** Read-only: reports what the token is without changing anything. */
export async function inspectSession(env: Env, token: string | null): Promise<SessionLookup> {
  if (!token) {
    return { outcome: 'no_token' };
  }
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  const now = DateTime.utc().toISO();
  const result = await env.DB.prepare(
    'SELECT id, user_id, created_at, expires_at FROM sessions WHERE token_hash = ? LIMIT 1'
  )
    .bind(tokenHash)
    .first();
  if (!result) {
    return { outcome: 'unknown_token' };
  }
  const record = result as {
    id: string;
    user_id: string;
    created_at: string;
    expires_at: string;
  };
  const common = {
    sessionId: record.id,
    userId: record.user_id,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
  };
  return record.expires_at <= now
    ? { outcome: 'expired', ...common }
    : { outcome: 'valid', ...common };
}

export async function getSessionUserId(env: Env, token: string | null): Promise<string | null> {
  const lookup = await inspectSession(env, token);
  return lookup.outcome === 'valid' ? lookup.userId : null;
}

/**
 * Remove sessions that expired longer ago than the evidence window.
 *
 * This has to be a sweep rather than something a read triggers: a request can
 * only purge the session whose token it carries, so any reader who simply
 * stops coming back leaves a row nothing will ever collect.
 */
export async function purgeExpiredSessions(env: Env): Promise<number> {
  const cutoff = DateTime.utc().minus({ days: EXPIRED_SESSION_RETENTION_DAYS }).toISO();
  const result = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}

export async function clearSession(env: Env, token: string | null): Promise<void> {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export function buildSessionCookie(
  env: Env,
  token: string,
  options: { clear?: boolean } = {}
): string {
  const secure = env.COOKIE_SECURE === 'true';
  const sameSite = env.SESSION_COOKIE_SAMESITE || 'Lax';
  /**
   * The cookie deliberately outlives the session it carries.
   *
   * Given the same lifetime, the browser drops the cookie at the very moment
   * the row expires, so the next request arrives with nothing and a genuine
   * expiry is indistinguishable from a cookie that was never sent. Carrying
   * the dead token for the evidence window means the expired row can still be
   * found and can say how long it actually lasted. It grants nothing in the
   * meantime: `inspectSession` rejects it on `expires_at`, which is unchanged.
   */
  const ttlDays = Number(env.SESSION_TTL_DAYS || '30');
  const maxAge = options.clear ? 0 : (ttlDays + EXPIRED_SESSION_RETENTION_DAYS) * 24 * 60 * 60;

  return [
    `session=${options.clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    secure ? 'Secure' : null,
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function buildAnonCookie(
  env: Env,
  anonId: string,
  options: { clear?: boolean } = {}
): string {
  const secure = env.COOKIE_SECURE === 'true';
  const sameSite = env.SESSION_COOKIE_SAMESITE || 'Lax';
  const ttlDays = Number(env.ANON_TTL_DAYS || env.SESSION_TTL_DAYS || '30');
  const maxAge = options.clear ? 0 : ttlDays * 24 * 60 * 60;

  return [
    `anon_id=${options.clear ? '' : anonId}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    secure ? 'Secure' : null,
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }
  return header.split(';').reduce(
    (acc, part) => {
      const [key, ...value] = part.trim().split('=');
      if (!key) {
        return acc;
      }
      acc[key] = value.join('=');
      return acc;
    },
    {} as Record<string, string>
  );
}
