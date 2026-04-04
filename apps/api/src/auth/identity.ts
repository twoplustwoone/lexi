import { DEFAULT_PREFERENCES, normalizePreferences, timeZoneSchema } from '@word-of-the-day/shared';

import { Env } from '../env';
import { createAnonymousUser, getUserById } from '../db';
import { buildAnonCookie, getSessionUserId, parseCookies } from './sessions';

export interface ResolveAnonOptions {
  setCookie?: (cookie: string) => void;
  allowHeader?: boolean;
}

export async function resolveAnonymousId(
  env: Env,
  request: Request,
  options: ResolveAnonOptions = {}
): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const cookieAnon = cookies.anon_id ?? null;

  if (cookieAnon) {
    const record = await getUserById(env, cookieAnon);
    if (record && record.is_anonymous === 1 && !record.merged_into_user_id) {
      return cookieAnon;
    }
  }

  const allowHeader = options.allowHeader !== false;
  const headerAnon = allowHeader ? request.headers.get('x-anon-id') : null;
  if (!headerAnon) {
    return null;
  }

  const record = await getUserById(env, headerAnon);
  if (!record || record.is_anonymous !== 1 || record.merged_into_user_id) {
    return null;
  }

  if (options.setCookie && headerAnon !== cookieAnon) {
    options.setCookie(buildAnonCookie(env, headerAnon));
  }

  return headerAnon;
}

export async function resolveUserId(
  env: Env,
  request: Request,
  options: ResolveAnonOptions = {}
): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionToken = cookies.session ?? null;
  const sessionUserId = await getSessionUserId(env, sessionToken);
  if (sessionUserId) {
    return sessionUserId;
  }
  return resolveAnonymousId(env, request, options);
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

export async function getUserOrThrow(
  env: Env,
  request: Request,
  options: ResolveAnonOptions = {}
): Promise<string> {
  const userId = await resolveUserId(env, request, options);
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
