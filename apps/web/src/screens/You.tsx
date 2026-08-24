import { useEffect, useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-react';
import { route } from 'preact-router';
import type { WordDifficulty } from '@word-of-the-day/shared';

import { logout, resetAnonymousIdentity } from '../api';
import { Button } from '../components/Button';
import { DeliveryTimeSheet } from '../components/reader/DeliveryTimeSheet';
import { SectionLabel, SettingRow, Segmented } from '../components/reader/SettingRow';
import { StreamEntry, sortNewestFirst, toStreamEntry } from '../components/reader/stream';
import { getHistory } from '../storage';
import { useSchedule } from '../useSchedule';

interface YouProps {
  path?: string;
  user: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  };
  onOpenAuth: () => void;
  onUserChange: (next: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  }) => void;
}

/** Consecutive days ending today or yesterday. */
function streak(entries: StreamEntry[]): number {
  if (entries.length === 0) return 0;
  const days = new Set(entries.map((entry) => entry.date));
  const cursor = new Date();
  // A word delivered today may not have arrived yet, so yesterday still counts.
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let count = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

const DIFFICULTIES: Array<{ value: WordDifficulty; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'advanced', label: 'Advanced' },
];

/**
 * Replaces both Settings and Account.
 *
 * The streak is stated once, here — not decorating the daily reading. The sync
 * upsell lives here and nowhere else.
 */
export function You({ user, onOpenAuth, onUserChange }: YouProps) {
  const schedule = useSchedule(user.userId);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);

  useEffect(() => {
    void getHistory()
      .then((history) => setEntries(sortNewestFirst(history.map(toStreamEntry))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const firstDay = entries.length > 0 ? entries[entries.length - 1].date : null;
  const firstDayLabel = firstDay
    ? new Date(`${firstDay}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })
    : '—';

  const handleSignOut = async () => {
    try {
      await logout();
    } catch {
      // Ignore; the identity reset below still clears local state.
    }
    try {
      await resetAnonymousIdentity();
    } catch {
      // Ignore re-registration failures.
    }
    onUserChange({
      userId: null,
      isAuthenticated: false,
      isAnonymous: true,
      isAdmin: false,
    });
  };

  const handleInstall = async () => {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void> }) | null;
    if (prompt?.prompt) {
      await prompt.prompt();
      setInstallPrompt(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-7 pt-3.5">
        <h2 className="m-0 font-display text-[34px] font-normal">You</h2>

        <div className="mt-4 flex gap-7 border-b border-ink/[0.16] pb-5">
          {[
            { value: String(entries.length), label: 'Words kept' },
            { value: String(streak(entries)), label: 'Days unbroken' },
            { value: firstDayLabel, label: 'First day' },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="tabular font-display text-[36px] leading-none">{stat.value}</div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-ink/[0.5]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <SectionLabel className="mb-1 mt-[22px]">Daily word</SectionLabel>
        <SettingRow label="Notifications">
          <Segmented
            label="Notifications"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={schedule.enabled ? 'on' : 'off'}
            onChange={(next) => void schedule.setEnabled(next === 'on')}
          />
        </SettingRow>
        <SettingRow
          label="Delivery time"
          value={schedule.deliveryTime}
          chevron
          onClick={() => setSheetOpen(true)}
        />
        <SettingRow label="Difficulty">
          <Segmented
            label="Difficulty"
            options={DIFFICULTIES}
            value={schedule.difficulty}
            onChange={(next) => void schedule.setDifficulty(next)}
          />
        </SettingRow>

        {schedule.message ? (
          <p className="m-0 mt-3 text-[14px] text-accent-strong">{schedule.message}</p>
        ) : null}

        <SectionLabel className="mb-2.5 mt-[26px]">Your words</SectionLabel>
        {user.isAuthenticated ? (
          <>
            <p className="m-0 mb-3.5 text-[14px] leading-[1.55] text-ink/[0.68]">
              Synced to your account, so they follow you to the next device.
            </p>
            <Button variant="secondary" size="lg" block onClick={handleSignOut}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="m-0 mb-3.5 text-[14px] leading-[1.55] text-ink/[0.68]">
              Saved on this device. Add an account and they follow you to the next one.
            </p>
            <Button variant="primary" size="lg" block onClick={onOpenAuth}>
              Sign in to sync
            </Button>
          </>
        )}

        <SectionLabel className="mb-1 mt-7">App</SectionLabel>
        {installPrompt ? (
          <SettingRow label="Install on this phone" chevron onClick={handleInstall} />
        ) : (
          <div className="flex min-h-[50px] items-center border-b border-ink/[0.16] text-[15px] text-ink/[0.55]">
            Installed, or not available in this browser
          </div>
        )}

        {/* Admin is reached from here, not from the tab bar. */}
        {user.isAdmin ? (
          <button
            type="button"
            onClick={() => route('/admin')}
            className="flex min-h-[50px] w-full cursor-pointer items-center justify-between border-b border-ink/[0.16] text-left text-[15px] text-accent"
          >
            <span>Admin</span>
            <ChevronRight size={15} strokeWidth={1.4} aria-hidden="true" />
          </button>
        ) : null}

        <div className="h-8" />
      </div>

      <DeliveryTimeSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        userId={user.userId}
      />
    </div>
  );
}
