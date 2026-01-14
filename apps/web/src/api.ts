import { eventSchema } from '@word-of-the-day/shared';

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

export interface WordPayload {
  date: string;
  word: {
    id: number;
    word: string;
    definition: string;
    etymology: string;
    pronunciation: string;
    examples: string[];
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
  const payload = {
    id: getAnonymousId(),
    timezone: getTimeZone(),
  };
  const response = await apiFetch<{ ok: boolean; merged_into_user_id?: string | null }>(
    '/identity/anonymous',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (response.merged_into_user_id) {
    setAnonymousId(response.merged_into_user_id);
  }
}

export async function fetchMe(): Promise<{
  user_id: string | null;
  is_authenticated: boolean;
  is_anonymous: boolean;
  is_admin: boolean;
}> {
  return apiFetch('/me');
}

export async function fetchTodayWord(): Promise<WordPayload> {
  return apiFetch<WordPayload>('/word/today');
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

export async function sendAdminTestNotification(): Promise<void> {
  await apiFetch('/admin/notify', { method: 'POST' });
}
