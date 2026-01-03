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

export async function getSessionUserId(env: Env, token: string | null): Promise<string | null> {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  const now = DateTime.utc().toISO();
  const result = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ? LIMIT 1'
  )
    .bind(tokenHash)
    .first();
  if (!result) {
    return null;
  }
  const record = result as { user_id: string; expires_at: string };
  if (record.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return record.user_id;
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
  const maxAge = options.clear ? 0 : Number(env.SESSION_TTL_DAYS || '30') * 24 * 60 * 60;

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
