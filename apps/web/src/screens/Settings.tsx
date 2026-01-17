import { useEffect, useState } from 'preact/hooks';

import { isThirtyMinuteTime } from '@word-of-the-day/shared';

import {
  fetchVapidKey,
  getClientType,
  syncSettingsCache,
  trackEvent,
  unsubscribePush,
  updateSettingsRemote,
  subscribePush,
} from '../api';
import { Button } from '../components/Button';
import { Loader } from '../components/Loader';
import { getAnonymousId, getTimeZone } from '../identity';
import type { SettingsState } from '../storage';

interface SettingsProps {
  path?: string;
  user: { userId: string | null };
}

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

let cachedSettings: SettingsState | null = null;

export function Settings({ user }: SettingsProps) {
  const [enabled, setEnabled] = useState(() => cachedSettings?.schedule.enabled ?? false);
  const [deliveryTime, setDeliveryTime] = useState(
    () => cachedSettings?.schedule.delivery_time ?? '09:00'
  );
  const [timezone, setTimezone] = useState(
    () => cachedSettings?.schedule.timezone ?? getTimeZone()
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cachedSettings);
  const [isToggling, setIsToggling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const supportsPush =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  const validateDeliveryTime = () => {
    if (isThirtyMinuteTime(deliveryTime)) {
      return true;
    }
    setMessage('Delivery time must be in 30-minute increments.');
    return false;
  };

  useEffect(() => {
    const hasCachedSettings = cachedSettings !== null;
    const load = async () => {
      if (!hasCachedSettings) {
        setLoading(true);
      }
      try {
        const settings = await syncSettingsCache();
        cachedSettings = settings;
        setEnabled(settings.schedule.enabled);
        setDeliveryTime(settings.schedule.delivery_time);
        setTimezone(settings.schedule.timezone);
      } finally {
        if (!hasCachedSettings) {
          setLoading(false);
        }
      }
    };
    void load();
  }, []);

  const handleToggle = async (nextEnabled: boolean) => {
    setMessage(null);
    if (!supportsPush && nextEnabled) {
      setMessage('Push notifications are not supported on this device.');
      return;
    }
    if (!validateDeliveryTime()) {
      return;
    }

    setIsToggling(true);
    try {
      if (nextEnabled) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setMessage('Notification permission was denied.');
          await updateSettingsRemote({ enabled: false, delivery_time: deliveryTime, timezone });
          setEnabled(false);
          return;
        }

        await trackEvent({
          event_name: 'notification_permission_granted',
          timestamp: new Date().toISOString(),
          user_id: user.userId || getAnonymousId(),
          client: getClientType(),
        });

        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        let subscription = existing;
        if (!subscription) {
          let key: Uint8Array;
          try {
            const rawKey = await fetchVapidKey();
            key = getValidatedVapidKey(rawKey);
          } catch (error: unknown) {
            setMessage(getErrorMessage(error, 'Push setup failed. Check VAPID keys.'));
            setEnabled(false);
            return;
          }
          const applicationServerKey = key as unknown as BufferSource;
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
        await subscribePush(subscription.toJSON());
        await trackEvent({
          event_name: 'notification_enabled',
          timestamp: new Date().toISOString(),
          user_id: user.userId || getAnonymousId(),
          client: getClientType(),
        });
      } else {
        if (supportsPush) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await unsubscribePush(subscription.endpoint);
            await subscription.unsubscribe();
          }
        }
      }

      await updateSettingsRemote({ enabled: nextEnabled, delivery_time: deliveryTime, timezone });
      const updated = await syncSettingsCache();
      cachedSettings = updated;
      setEnabled(updated.schedule.enabled);
      setDeliveryTime(updated.schedule.delivery_time);
      setTimezone(updated.schedule.timezone);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, 'Unable to update notification settings.'));
    } finally {
      setIsToggling(false);
    }
  };

  const handleSave = async (event: Event) => {
    event.preventDefault();
    setMessage(null);
    if (!validateDeliveryTime()) {
      return;
    }
    setIsSaving(true);
    try {
      await updateSettingsRemote({ enabled, delivery_time: deliveryTime, timezone });
      const updated = await syncSettingsCache();
      cachedSettings = updated;
      setEnabled(updated.schedule.enabled);
      setDeliveryTime(updated.schedule.delivery_time);
      setTimezone(updated.schedule.timezone);
      setMessage('Saved. Changes apply next day.');
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, 'Unable to save settings.'));
    } finally {
      setIsSaving(false);
    }
  };

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  if (loading) {
    return (
      <div className={`${cardBase} p-6`}>
        <Loader label="Loading settings..." />
      </div>
    );
  }

  return (
    <section className="grid gap-5">
      <form className={`${cardBase} p-6`} onSubmit={handleSave}>
        <h2 className="font-[var(--font-display)] text-2xl">Notifications</h2>
        <div className="mt-4 flex items-center gap-4">
          <label className="relative inline-flex h-7 w-12 cursor-pointer items-center focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={isToggling || isSaving}
              className="peer sr-only"
              onChange={(event) => handleToggle(event.currentTarget.checked)}
            />
            <span className="absolute inset-0 rounded-full bg-[#e1d3c0] transition peer-checked:bg-accent" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_4px_8px_rgba(0,0,0,0.15)] transition-transform peer-checked:translate-x-5" />
          </label>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Daily reminder</p>
              {isToggling ? <Loader label="Updating..." className="text-xs" /> : null}
            </div>
            <p className="text-sm text-muted">Receive your word once per day.</p>
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="font-semibold">Delivery time</span>
          <input
            type="time"
            className="rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            value={deliveryTime}
            onChange={(event) => setDeliveryTime(event.currentTarget.value)}
            step={1800}
          />
          <p className="text-xs text-muted">Times are available every 30 minutes.</p>
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="font-semibold">Timezone</span>
          <input
            type="text"
            className="rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm text-muted"
            value={timezone}
            readOnly
          />
        </label>

        {message ? <p className="mt-3 text-sm text-accent-strong">{message}</p> : null}
        <Button className="mt-4" type="submit" disabled={isSaving || isToggling}>
          {isSaving ? <Loader label="Saving..." tone="light" /> : 'Save settings'}
        </Button>
      </form>

      <div className={`${cardBase} p-6`}>
        <h2 className="font-[var(--font-display)] text-2xl">Word preferences</h2>
        <p className="mt-1 text-muted">Coming soon - choose difficulty, themes, or languages.</p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
          <div className="rounded-xl border border-dashed border-[rgba(30,27,22,0.12)] p-3 text-sm text-muted">
            Difficulty
          </div>
          <div className="rounded-xl border border-dashed border-[rgba(30,27,22,0.12)] p-3 text-sm text-muted">
            Theme
          </div>
          <div className="rounded-xl border border-dashed border-[rgba(30,27,22,0.12)] p-3 text-sm text-muted">
            Language
          </div>
        </div>
      </div>
    </section>
  );
}
