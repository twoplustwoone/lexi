import { DEFAULT_PREFERENCES, normalizePreferences, timeZoneSchema } from '@word-of-the-day/shared';

import { Env } from '../env';
import { createAnonymousUser, getUserById } from '../db';
import { getSessionUserId, parseCookies } from './sessions';

export async function resolveAnonymousId(env: Env, request: Request): Promise<string | null> {
  const anonId = request.headers.get('x-anon-id');
  if (!anonId) {
    return null;
  }
  const record = await getUserById(env, anonId);
  if (!record || record.is_anonymous !== 1 || record.merged_into_user_id) {
    return null;
  }
  return anonId;
}

export async function resolveUserId(env: Env, request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionToken = cookies.session ?? null;
  const sessionUserId = await getSessionUserId(env, sessionToken);
  if (sessionUserId) {
    return sessionUserId;
  }
  return resolveAnonymousId(env, request);
}

export async function ensureAnonymousUserExists(
  env: Env,
  params: { userId: string; timezone: string }
): Promise<void> {
  timeZoneSchema.parse(params.timezone);
  const existing = await getUserById(env, params.userId);
  if (!existing) {
    await createAnonymousUser(env, params.userId, params.timezone, DEFAULT_PREFERENCES);
    return;
  }
  if (existing.is_anonymous !== 1 || existing.merged_into_user_id) {
    return;
  }
}

export async function getUserOrThrow(env: Env, request: Request): Promise<string> {
  const userId = await resolveUserId(env, request);
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

export function getNormalizedPreferences(
  preferencesJson: string
): ReturnType<typeof normalizePreferences> {
  try {
    return normalizePreferences(JSON.parse(preferencesJson));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
