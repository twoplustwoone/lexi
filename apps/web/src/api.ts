import {
  eventSchema,
  type WordCard,
  type WordDetailsStatus,
  type WordDifficulty,
} from '@word-of-the-day/shared';

import {
  HistoryEntry,
  SettingsState,
  addOutboxEvent,
  getHistory,
  getSettings,
  saveHistory,
  saveSettings,
} from './storage';
import { getAnonymousId, getTimeZone, setAnonymousId } from './identity';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Legacy word format (for backward compatibility with history)
 */
export interface LegacyWordData {
  id: number;
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples: string[];
}

/**
 * New daily word response from /api/word/today
 */
export interface DailyWordPayload {
  day: string;
  word: string;
  wordPoolId: number;
  detailsStatus: WordDetailsStatus;
  details: WordCard | null;
  selection?: {
    requestedDifficulty: WordDifficulty | null;
    effectiveDifficulty: WordDifficulty | null;
    usedFallback: boolean;
  };
}

/**
 * Legacy word payload (for backward compatibility)
 * @deprecated Use DailyWordPayload instead
 */
export interface WordPayload {
  date: string;
  word: LegacyWordData;
}

export interface AuthMethodsResponse {
  account_exists: boolean;
  methods: {
    password: boolean;
    email_code: boolean;
    google: boolean;
  };
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('X-Anon-Id', getAnonymousId());
  headers.set('X-Timezone', getTimeZone());

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload?.error) {
          throw new Error(payload.error);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
      }
    }
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  return response.json() as Promise<T>;
}

export async function registerAnonymousIdentity(): Promise<void> {
  const timezone = getTimeZone();
  let anonId = getAnonymousId();
  const register = async (id: string) =>
    apiFetch<{ ok: boolean; merged_into_user_id?: string | null }>('/identity/anonymous', {
      method: 'POST',
      body: JSON.stringify({ id, timezone }),
    });

  try {
    const response = await register(anonId);
    if (response.merged_into_user_id) {
      anonId = crypto.randomUUID();
      setAnonymousId(anonId);
      await register(anonId);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'User already exists') {
      anonId = crypto.randomUUID();
      setAnonymousId(anonId);
      await register(anonId);
      return;
    }
    throw error;
  }
}

export async function resetAnonymousIdentity(): Promise<void> {
  setAnonymousId(crypto.randomUUID());
  await registerAnonymousIdentity();
}

export async function fetchMe(): Promise<{
  user_id: string | null;
  is_authenticated: boolean;
  is_anonymous: boolean;
  is_admin: boolean;
}> {
  return apiFetch('/me');
}

export async function fetchTodayWord(): Promise<DailyWordPayload> {
  return apiFetch<DailyWordPayload>('/word/today');
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const response = await apiFetch<{ history: HistoryEntry[] }>('/history');
  return response.history;
}

export async function markWordViewed(wordId: number): Promise<void> {
  await apiFetch('/word/view', { method: 'POST', body: JSON.stringify({ word_id: wordId }) });
}

export async function fetchSettingsRemote(): Promise<SettingsState> {
  return apiFetch<SettingsState>('/settings');
}

export async function updateSettingsRemote(payload: {
  enabled: boolean;
  delivery_time: string;
  timezone: string;
  word_filters?: {
    difficulty: WordDifficulty;
  };
}): Promise<void> {
  await apiFetch('/settings', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function fetchVapidKey(): Promise<string> {
  const response = await apiFetch<{ publicKey: string }>('/notifications/vapid');
  return response.publicKey;
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await apiFetch('/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await apiFetch('/notifications/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export async function syncHistoryCache(): Promise<void> {
  try {
    const history = await fetchHistory();
    await saveHistory(history);
  } catch {
    const cached = await getHistory();
    if (!cached.length) {
      throw new Error('No cached history');
    }
  }
}

export async function syncSettingsCache(): Promise<SettingsState> {
  try {
    const settings = await fetchSettingsRemote();
    await saveSettings(settings);
    return settings;
  } catch {
    const cached = await getSettings();
    if (!cached) {
      throw new Error('No cached settings');
    }
    return cached;
  }
}

export async function trackEvent(event: {
  event_name: string;
  timestamp: string;
  user_id: string;
  client: 'web' | 'pwa';
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  const parsed = eventSchema.parse(event);
  try {
    await apiFetch('/events', { method: 'POST', body: JSON.stringify(parsed) });
  } catch {
    await addOutboxEvent(parsed as unknown as Record<string, unknown>);
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      const syncManager = (
        registration as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        }
      ).sync;
      if (syncManager) {
        await syncManager.register('analytics-sync');
      }
    }
  }
}

export function getClientType(): 'web' | 'pwa' {
  type StandaloneNavigator = Navigator & { standalone?: boolean };
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as StandaloneNavigator).standalone === true;
  return isStandalone ? 'pwa' : 'web';
}

export async function signUpEmailPassword(email: string, password: string): Promise<void> {
  await apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export async function loginEmailPassword(identifier: string, password: string): Promise<void> {
  await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function getAuthMethods(email: string): Promise<AuthMethodsResponse> {
  return apiFetch<AuthMethodsResponse>('/auth/methods', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function requestEmailCode(email: string): Promise<void> {
  await apiFetch('/auth/email/code/request', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  await apiFetch('/auth/email/code/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

export async function loginWithGoogle(idToken: string): Promise<void> {
  await apiFetch('/auth/google', { method: 'POST', body: JSON.stringify({ id_token: idToken }) });
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export interface AdminNotifyResult {
  userId: string;
  endpointDomain: string;
  status: number;
  ok: boolean;
  body?: string;
  error?: string;
}

export type AdminNotifyTarget = 'self' | 'all' | 'admins' | 'enabled' | 'custom';

export interface AdminNotifyTargetSummary {
  mode: AdminNotifyTarget;
  userCount: number;
  subscriptionCount: number;
}

export interface AdminNotifyResponse {
  ok: boolean;
  results: AdminNotifyResult[];
  target?: AdminNotifyTargetSummary;
  missingUserIds?: string[];
  vapidSubject?: string;
}

export interface AdminNotifyRequest {
  title: string;
  body?: string;
  target: AdminNotifyTarget;
  userIds?: string[];
  includePayload?: boolean;
}

export async function sendAdminNotification(
  payload: AdminNotifyRequest
): Promise<AdminNotifyResponse> {
  return apiFetch('/admin/notify', { method: 'POST', body: JSON.stringify(payload) });
}

export interface AdminUser {
  id: string;
  username: string | null;
  email: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  createdAt: string;
  authProviders: AdminAuthProvider[];
}

export interface AdminAuthProvider {
  provider: string;
  email: string | null;
  createdAt: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  nextCursor: string | null;
}

export async function fetchAdminUsers(
  cursor?: string,
  limit?: number
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (limit) {
    params.set('limit', String(limit));
  }
  const query = params.toString();
  return apiFetch<AdminUsersResponse>(`/admin/users${query ? `?${query}` : ''}`);
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  await apiFetch(`/admin/users/${userId}/admin`, {
    method: 'PUT',
    body: JSON.stringify({ isAdmin }),
  });
}

// Admin Dashboard Stats Types
export interface AdminStats {
  users: {
    total: number;
    anonymous: number;
    authenticated: number;
    admins: number;
    byAuthMethod: {
      password: number;
      google: number;
      emailCode: number;
    };
  };
  engagement: {
    totalWordsDelivered: number;
    totalWordsViewed: number;
    viewRate: number;
  };
  notifications: {
    enabledCount: number;
    disabledCount: number;
    pushSubscriptions: number;
  };
}

export interface AdminTimelineStats {
  userGrowth: Array<{ date: string; total: number; authenticated: number }>;
  wordsDelivered: Array<{ date: string; delivered: number; viewed: number }>;
  accountCreations: Array<{ date: string; password: number; google: number; emailCode: number }>;
}

export interface AdminEventStats {
  eventCounts: Record<string, number>;
  clientBreakdown: { web: number; pwa: number };
  recentEvents: Array<{
    event_name: string;
    timestamp: string;
    user_id: string;
    client: string;
  }>;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats');
}

export async function fetchAdminTimelineStats(period: string = '7d'): Promise<AdminTimelineStats> {
  return apiFetch<AdminTimelineStats>(`/admin/stats/timeline?period=${period}`);
}

export async function fetchAdminEventStats(period: string = '7d'): Promise<AdminEventStats> {
  return apiFetch<AdminEventStats>(`/admin/stats/activity?period=${period}`);
}

// Admin Word Management Types
export interface AdminWord {
  id: number;
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples: string[];
  created_at: string;
}

export interface WordInput {
  word: string;
  definition: string;
  etymology?: string;
  pronunciation?: string;
  examples?: string[];
}

export interface AdminWordsResponse {
  words: AdminWord[];
  total: number;
  limit: number;
  offset: number;
}

export interface BulkCreateResult {
  created: number;
  errors: Array<{ index: number; error: string }>;
}

export async function fetchAdminWords(
  options: {
    limit?: number;
    offset?: number;
    search?: string;
  } = {}
): Promise<AdminWordsResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  if (options.search) params.set('search', options.search);
  const query = params.toString();
  return apiFetch<AdminWordsResponse>(`/admin/words${query ? `?${query}` : ''}`);
}

export async function createAdminWord(input: WordInput): Promise<{ word: AdminWord }> {
  return apiFetch<{ word: AdminWord }>('/admin/words', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAdminWord(
  id: number,
  input: Partial<WordInput>
): Promise<{ word: AdminWord }> {
  return apiFetch<{ word: AdminWord }>(`/admin/words/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteAdminWord(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/words/${id}`, {
    method: 'DELETE',
  });
}

export async function bulkCreateAdminWords(words: WordInput[]): Promise<BulkCreateResult> {
  return apiFetch<BulkCreateResult>('/admin/words/bulk', {
    method: 'POST',
    body: JSON.stringify({ words }),
  });
}
