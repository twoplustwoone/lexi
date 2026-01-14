import { useEffect, useState } from 'preact/hooks';

import { fetchTodayWord, markWordViewed, syncHistoryCache, syncSettingsCache } from '../api';
import { getHistory } from '../storage';

interface HomeProps {
  path?: string;
  user: { isAuthenticated: boolean };
  onOpenAuth: () => void;
}

type WordDisplay = {
  id?: number;
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples: string[];
  date: string;
};

export function Home({ user, onOpenAuth }: HomeProps) {
  const [word, setWord] = useState<WordDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const today = await fetchTodayWord();
        setWord({ ...today.word, date: today.date });
        await markWordViewed(today.word.id);
        await syncHistoryCache();
      } catch {
        const cached = await getHistory();
        if (cached.length) {
          const latest = cached.sort((a, b) => b.delivered_at.localeCompare(a.delivered_at))[0];
          setWord({ ...latest, date: latest.delivered_at });
        } else {
          setError("Unable to load today's word while offline.");
        }
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const checkReminder = async () => {
      try {
        const settings = await syncSettingsCache();
        const permission = 'Notification' in window ? Notification.permission : 'denied';
        const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window;
        if (settings.schedule.enabled && (!supportsPush || permission !== 'granted')) {
          setReminder(
            supportsPush
              ? 'Notifications are enabled, but permission is blocked. Enable in browser settings.'
              : 'This device cannot receive push notifications reliably. Open the app daily for your word.'
          );
        } else if (!settings.schedule.enabled) {
          setReminder('Turn on notifications to receive your word at your chosen time.');
        }
      } catch {
        setReminder(null);
      }
    };
    void checkReminder();
  }, []);

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  if (loading) {
    return <div className={`${cardBase} p-6`}>Warming up the lexicon...</div>;
  }

  if (error) {
    return (
      <div className={`${cardBase} border-[rgba(143,45,45,0.3)] p-6 text-[#8f2d2d]`}>{error}</div>
    );
  }

  if (!word) {
    return <div className={`${cardBase} p-6`}>No word available yet.</div>;
  }

  return (
    <section className="grid gap-5">
      {reminder ? (
        <div className="rounded-2xl border border-dashed border-[rgba(30,27,22,0.2)] bg-banner px-4 py-3">
          {reminder}
        </div>
      ) : null}
      <article className={`${cardBase} p-6`}>
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Today's word</p>
          <h1 className="font-[var(--font-display)] text-4xl">{word.word}</h1>
          <p className="text-sm text-muted">{word.pronunciation}</p>
        </header>
        <div className="mt-5 space-y-2">
          <h2 className="text-xs uppercase tracking-[0.08em] text-muted">Definition</h2>
          <p>{word.definition}</p>
        </div>
        <div className="mt-5 space-y-2">
          <h2 className="text-xs uppercase tracking-[0.08em] text-muted">Etymology</h2>
          <p>{word.etymology}</p>
        </div>
        <div className="mt-5 space-y-2">
          <h2 className="text-xs uppercase tracking-[0.08em] text-muted">Examples</h2>
          <ul className="list-disc space-y-1 pl-5">
            {(Array.isArray(word.examples) ? word.examples : []).map((example: string) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      </article>
      <div className={`${cardBase} flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between`}>
        <p className="text-muted">
          {user.isAuthenticated
            ? 'Your history and preferences are synced across devices.'
            : 'Your progress is saved locally and can be upgraded to an account anytime.'}
        </p>
        {!user.isAuthenticated ? (
          <button
            className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            type="button"
            onClick={onOpenAuth}
          >
            Sign in to sync
          </button>
        ) : null}
      </div>
    </section>
  );
}
