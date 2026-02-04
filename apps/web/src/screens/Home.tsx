import { useEffect, useState } from 'preact/hooks';
import type { WordCard, WordDetailsStatus } from '@word-of-the-day/shared';

import { fetchTodayWord, markWordViewed, syncHistoryCache, syncSettingsCache } from '../api';
import { Button } from '../components/Button';
import { Loader } from '../components/Loader';
import { canUseSpeechSynthesis, playPronunciation } from '../pronunciation';
import { getHistory } from '../storage';

interface HomeProps {
  path?: string;
  user: { isAuthenticated: boolean };
  onOpenAuth: () => void;
}

type WordDisplay = {
  wordPoolId: number;
  word: string;
  date: string;
  detailsStatus: WordDetailsStatus;
  details: WordCard | null;
};

let cachedWord: WordDisplay | null = null;
let cachedReminder: string | null = null;

export function Home({ user, onOpenAuth }: HomeProps) {
  const [word, setWord] = useState<WordDisplay | null>(() => cachedWord);
  const [loading, setLoading] = useState(() => !cachedWord);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(() => cachedReminder);
  const [pronunciationMessage, setPronunciationMessage] = useState<string | null>(null);

  useEffect(() => {
    const hasCachedWord = cachedWord !== null;
    const load = async () => {
      if (!hasCachedWord) {
        setLoading(true);
        setError(null);
      }
      try {
        const today = await fetchTodayWord();
        const nextWord: WordDisplay = {
          wordPoolId: today.wordPoolId,
          word: today.word,
          date: today.day,
          detailsStatus: today.detailsStatus,
          details: today.details,
        };
        cachedWord = nextWord;
        setWord(nextWord);
        await markWordViewed(today.wordPoolId);
        await syncHistoryCache();

        // If details are pending, poll for updates
        if (today.detailsStatus === 'pending') {
          const pollForDetails = async () => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            try {
              const updated = await fetchTodayWord();
              if (updated.detailsStatus === 'ready' && updated.details) {
                const updatedWord: WordDisplay = {
                  wordPoolId: updated.wordPoolId,
                  word: updated.word,
                  date: updated.day,
                  detailsStatus: updated.detailsStatus,
                  details: updated.details,
                };
                cachedWord = updatedWord;
                setWord(updatedWord);
              } else if (updated.detailsStatus === 'pending') {
                // Continue polling
                void pollForDetails();
              }
            } catch {
              // Stop polling on error
            }
          };
          void pollForDetails();
        }
      } catch {
        const cached = await getHistory();
        if (cached.length) {
          const latest = cached.sort((a, b) => b.delivered_at.localeCompare(a.delivered_at))[0];
          // Convert legacy history format to new display format
          const nextWord: WordDisplay = {
            wordPoolId: latest.word_id,
            word: latest.word,
            date: latest.delivered_at,
            detailsStatus: 'ready',
            details: {
              word: latest.word,
              phonetics: latest.pronunciation || null,
              audioUrl: latest.audio_url || null,
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [latest.definition],
                  examples: latest.examples || [],
                },
              ],
              etymology: latest.etymology || null,
            },
          };
          cachedWord = nextWord;
          setWord(nextWord);
        } else if (!cachedWord) {
          setError("Unable to load today's word while offline.");
        }
      } finally {
        if (!hasCachedWord) {
          setLoading(false);
        }
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
          const message = supportsPush
            ? 'Notifications are enabled, but permission is blocked. Enable in browser settings.'
            : 'This device cannot receive push notifications reliably. Open the app daily for your word.';
          cachedReminder = message;
          setReminder(message);
        } else if (!settings.schedule.enabled) {
          cachedReminder = 'Turn on notifications to receive your word at your chosen time.';
          setReminder('Turn on notifications to receive your word at your chosen time.');
        }
      } catch {
        cachedReminder = null;
        setReminder(null);
      }
    };
    void checkReminder();
  }, []);

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  if (loading) {
    return (
      <div className={`${cardBase} p-6`}>
        <Loader label="Warming up the lexicon..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${cardBase} border-[rgba(143,45,45,0.3)] p-6 text-[#8f2d2d]`}>{error}</div>
    );
  }

  if (!word) {
    return <div className={`${cardBase} p-6`}>No word available yet.</div>;
  }

  // Extract display data from word details
  const details = word.details;
  const phonetics = details?.phonetics || null;
  const audioUrl = details?.audioUrl || null;
  const etymology = details?.etymology || null;
  const pronunciationUnavailable = !audioUrl && !canUseSpeechSynthesis();

  const handlePlayPronunciation = async () => {
    setPronunciationMessage(null);
    const result = await playPronunciation({
      text: word.word,
      audioUrl,
    });

    if (result.status === 'unsupported') {
      setPronunciationMessage('Pronunciation is unavailable (Samantha voice not found).');
      return;
    }

    if (result.status === 'error') {
      setPronunciationMessage(result.message);
      return;
    }
  };

  // Render word details based on status
  const renderDetails = () => {
    if (word.detailsStatus === 'pending') {
      return (
        <div className="mt-5 flex items-center gap-2 text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Loading definition...</span>
        </div>
      );
    }

    if (word.detailsStatus === 'failed' || word.detailsStatus === 'not_found') {
      return <div className="mt-5 text-muted italic">Definition not available for this word.</div>;
    }

    if (!details) {
      return null;
    }

    return (
      <>
        {details.meanings?.map((meaning, idx) => (
          <div key={idx} className="mt-5 space-y-2">
            <h2 className="text-xs uppercase tracking-[0.08em] text-muted">
              {meaning.partOfSpeech}
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              {meaning.definitions.slice(0, 3).map((def, defIdx) => (
                <li key={defIdx}>{def}</li>
              ))}
            </ul>
            {meaning.examples && meaning.examples.length > 0 && (
              <div className="mt-2 pl-5">
                <p className="text-sm italic text-muted">"{meaning.examples[0]}"</p>
              </div>
            )}
          </div>
        ))}
        {etymology && (
          <div className="mt-5 space-y-2">
            <h2 className="text-xs uppercase tracking-[0.08em] text-muted">Etymology</h2>
            <p>{etymology}</p>
          </div>
        )}
      </>
    );
  };

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
          {phonetics && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted">{phonetics}</p>
              <button
                type="button"
                onClick={() => void handlePlayPronunciation()}
                disabled={pronunciationUnavailable}
                className="text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Play pronunciation"
                title={
                  pronunciationUnavailable
                    ? 'Pronunciation is unavailable (speech synthesis not supported).'
                    : 'Play pronunciation'
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </button>
            </div>
          )}
          {pronunciationMessage ? (
            <p className="text-xs text-accent-strong">{pronunciationMessage}</p>
          ) : null}
        </header>
        {renderDetails()}
      </article>
      <div
        className={`${cardBase} flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between`}
      >
        <p className="text-muted">
          {user.isAuthenticated
            ? 'Your history and preferences are synced across devices.'
            : 'Your progress is saved locally and can be upgraded to an account anytime.'}
        </p>
        {!user.isAuthenticated ? <Button onClick={onOpenAuth}>Sign in to sync</Button> : null}
      </div>
    </section>
  );
}
