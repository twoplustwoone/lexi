import { useEffect, useState } from 'preact/hooks';
import { isThirtyMinuteTime, type WordDifficulty } from '@word-of-the-day/shared';

import {
  fetchVapidKey,
  getClientType,
  subscribePush,
  syncSettingsCache,
  trackEvent,
  unsubscribePush,
  updateSettingsRemote,
} from './api';
import { getAnonymousId, getTimeZone } from './identity';
import type { SettingsState } from './storage';

/**
 * The delivery schedule, shared by You and the delivery-time sheet.
 *
 * This is lifted verbatim out of the old Settings screen rather than rewritten
 * — the permission dance, the VAPID key validation and the subscribe/
 * unsubscribe pairing are all load-bearing, and the redesign is a restyle of
 * this flow, not a change to it.
 */

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function getValidatedVapidKey(base64Key: string): Uint8Array {
  try {
    const bytes = urlBase64ToUint8Array(base64Key);
    if (bytes.length !== 65 || bytes[0] !== 0x04) {
      throw new Error('Invalid VAPID key shape');
    }
    return bytes;
  } catch {
    throw new Error('Invalid VAPID public key. Run npm run generate:vapid and update .dev.vars.');
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

let cachedSettings: SettingsState | null = null;

export interface ScheduleController {
  enabled: boolean;
  deliveryTime: string;
  difficulty: WordDifficulty;
  timezone: string;
  loading: boolean;
  busy: boolean;
  message: string | null;
  supportsPush: boolean;
  setMessage: (message: string | null) => void;
  /** Turns notifications on or off, running the whole push handshake. */
  setEnabled: (next: boolean) => Promise<void>;
  /** Applies from tomorrow, as the sheet says. */
  setDeliveryTime: (next: string) => Promise<void>;
  setDifficulty: (next: WordDifficulty) => Promise<void>;
}

export function useSchedule(userId: string | null): ScheduleController {
  const [enabled, setEnabledState] = useState(() => cachedSettings?.schedule.enabled ?? false);
  const [deliveryTime, setDeliveryTimeState] = useState(
    () => cachedSettings?.schedule.delivery_time ?? '09:00'
  );
  const [difficulty, setDifficultyState] = useState<WordDifficulty>(
    () => cachedSettings?.preferences.word_filters?.difficulty ?? 'balanced'
  );
  const [timezone, setTimezone] = useState(
    () => cachedSettings?.schedule.timezone ?? getTimeZone()
  );
  const [loading, setLoading] = useState(() => !cachedSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supportsPush =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const apply = (settings: SettingsState) => {
    cachedSettings = settings;
    setEnabledState(settings.schedule.enabled);
    setDeliveryTimeState(settings.schedule.delivery_time);
    setDifficultyState(settings.preferences.word_filters?.difficulty ?? 'balanced');
    setTimezone(settings.schedule.timezone);
  };

  useEffect(() => {
    const load = async () => {
      if (!cachedSettings) setLoading(true);
      try {
        apply(await syncSettingsCache());
      } catch {
        // Offline with no cache: the defaults above stand.
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const persist = async (next: {
    enabled: boolean;
    delivery_time: string;
    difficulty: WordDifficulty;
  }) => {
    await updateSettingsRemote({
      enabled: next.enabled,
      delivery_time: next.delivery_time,
      timezone,
      word_filters: { difficulty: next.difficulty },
    });
    apply(await syncSettingsCache());
  };

  const setEnabled = async (next: boolean) => {
    setMessage(null);
    if (next && !supportsPush) {
      setMessage('This device cannot receive push notifications.');
      return;
    }
    if (!isThirtyMinuteTime(deliveryTime)) {
      setMessage('Delivery time must be in 30-minute increments.');
      return;
    }

    setBusy(true);
    try {
      if (next) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setMessage('Notification permission was denied.');
          await persist({ enabled: false, delivery_time: deliveryTime, difficulty });
          return;
        }

        await trackEvent({
          event_name: 'notification_permission_granted',
          timestamp: new Date().toISOString(),
          user_id: userId || getAnonymousId(),
          client: getClientType(),
        });

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          let key: Uint8Array;
          try {
            key = getValidatedVapidKey(await fetchVapidKey());
          } catch (error) {
            setMessage(errorMessage(error, 'Push setup failed. Check VAPID keys.'));
            return;
          }
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key as unknown as BufferSource,
          });
        }
        await subscribePush(subscription.toJSON());
        await trackEvent({
          event_name: 'notification_enabled',
          timestamp: new Date().toISOString(),
          user_id: userId || getAnonymousId(),
          client: getClientType(),
        });
      } else if (supportsPush) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await unsubscribePush(subscription.endpoint);
          await subscription.unsubscribe();
        }
      }

      await persist({ enabled: next, delivery_time: deliveryTime, difficulty });
    } catch (error) {
      setMessage(errorMessage(error, 'Unable to update notifications.'));
    } finally {
      setBusy(false);
    }
  };

  const setDeliveryTime = async (next: string) => {
    setMessage(null);
    if (!isThirtyMinuteTime(next)) {
      setMessage('Delivery time must be in 30-minute increments.');
      return;
    }
    setBusy(true);
    try {
      await persist({ enabled, delivery_time: next, difficulty });
    } catch (error) {
      setMessage(errorMessage(error, 'Unable to save the delivery time.'));
    } finally {
      setBusy(false);
    }
  };

  const setDifficulty = async (next: WordDifficulty) => {
    setMessage(null);
    setBusy(true);
    try {
      await persist({ enabled, delivery_time: deliveryTime, difficulty: next });
    } catch (error) {
      setMessage(errorMessage(error, 'Unable to save the difficulty.'));
    } finally {
      setBusy(false);
    }
  };

  return {
    enabled,
    deliveryTime,
    difficulty,
    timezone,
    loading,
    busy,
    message,
    supportsPush,
    setMessage,
    setEnabled,
    setDeliveryTime,
    setDifficulty,
  };
}
