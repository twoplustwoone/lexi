import { useEffect, useState } from 'preact/hooks';

import { fetchHistory, getClientType, trackEvent } from '../api';
import { HistoryEntry, getHistory, saveHistory } from '../storage';
import { getAnonymousId } from '../identity';
import { Loader } from '../components/Loader';
import { canUseSpeechSynthesis, playPronunciation } from '../pronunciation';

interface HistoryProps {
  path?: string;
  user: { userId: string | null };
}

let cachedHistory: HistoryEntry[] | null = null;

function formatHistoryDate(entry: HistoryEntry): string {
  if (entry.delivered_on) {
    const [year, month, day] = entry.delivered_on.split('-').map(Number);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return new Date(year, month - 1, day).toLocaleDateString();
    }
  }
  return new Date(entry.delivered_at).toLocaleDateString();
}

function sortHistoryEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => {
    const dateKeyA = a.delivered_on ?? a.delivered_at;
    const dateKeyB = b.delivered_on ?? b.delivered_at;
    const byDay = dateKeyB.localeCompare(dateKeyA);
    if (byDay !== 0) {
      return byDay;
    }
    return b.delivered_at.localeCompare(a.delivered_at);
  });
}

export function History({ user }: HistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[]>(() => cachedHistory ?? []);
  const [loading, setLoading] = useState(() => cachedHistory === null);
  const [pronunciationMessage, setPronunciationMessage] = useState<{
    wordId: number;
    message: string;
  } | null>(null);
  const supportsSpeechSynthesis = canUseSpeechSynthesis();

  useEffect(() => {
    const hasCachedHistory = cachedHistory !== null;
    const load = async () => {
      if (!hasCachedHistory) {
        setLoading(true);
      }
      try {
        const remote = await fetchHistory();
        const sorted = sortHistoryEntries(remote);
        await saveHistory(sorted);
        cachedHistory = sorted;
        setHistory(sorted);
      } catch {
        const cached = await getHistory();
        const sorted = sortHistoryEntries(cached);
        cachedHistory = sorted;
        setHistory(sorted);
      } finally {
        if (!hasCachedHistory) {
          setLoading(false);
        }
      }
    };
    void load();
    void trackEvent({
      event_name: 'history_opened',
      timestamp: new Date().toISOString(),
      user_id: user.userId || getAnonymousId(),
      client: getClientType(),
    });
  }, []);

  const handlePlayPronunciation = async (entry: HistoryEntry) => {
    setPronunciationMessage(null);
    const result = await playPronunciation({
      text: entry.word,
      audioUrl: entry.audio_url ?? null,
    });

    if (result.status === 'unsupported') {
      setPronunciationMessage({
        wordId: entry.word_id,
        message: 'Pronunciation is unavailable (Samantha voice not found).',
      });
      return;
    }

    if (result.status === 'error') {
      setPronunciationMessage({
        wordId: entry.word_id,
        message: result.message,
      });
      return;
    }
  };

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  if (loading) {
    return (
      <div className={`${cardBase} p-6`}>
        <Loader label="Collecting your past words..." />
      </div>
    );
  }

  if (!history.length) {
    return (
      <div className={`${cardBase} p-6`}>No history yet. Check back after your first word.</div>
    );
  }

  return (
    <section className="grid gap-5">
      <div className={`${cardBase} p-6`}>
        <h2 className="font-[var(--font-display)] text-2xl">History</h2>
        <p className="mt-1 text-muted">Every word you have received, in order.</p>
      </div>
      <div className="grid auto-rows-min grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-4">
        {history.map((entry) => (
          <details className={`${cardBase} group p-0`} key={entry.word_id}>
            <summary className="relative flex cursor-pointer list-none flex-col gap-1 px-6 py-6 pr-12 focus-visible:rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4 after:absolute after:right-6 after:top-6 after:text-xl after:text-muted after:content-['+'] group-open:after:content-['-']">
              <span className="text-xs uppercase tracking-[0.2em] text-muted">
                {formatHistoryDate(entry)}
              </span>
              <span className="font-[var(--font-display)] text-lg">{entry.word}</span>
              <span className="text-muted">{entry.definition}</span>
            </summary>
            <div className="border-t border-[rgba(30,27,22,0.12)] px-6 pb-6 pt-4">
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted">{entry.pronunciation}</p>
                <button
                  type="button"
                  onClick={() => void handlePlayPronunciation(entry)}
                  disabled={!entry.audio_url && !supportsSpeechSynthesis}
                  className="text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Play pronunciation for ${entry.word}`}
                  title={
                    !entry.audio_url && !supportsSpeechSynthesis
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
              {pronunciationMessage?.wordId === entry.word_id ? (
                <p className="mt-1 text-xs text-accent-strong">{pronunciationMessage.message}</p>
              ) : null}
              <div className="mt-4">
                <h4 className="text-sm uppercase tracking-[0.08em] text-muted">Definition</h4>
                <p>{entry.definition}</p>
              </div>
              <div className="mt-4">
                <h4 className="text-sm uppercase tracking-[0.08em] text-muted">Etymology</h4>
                <p>{entry.etymology}</p>
              </div>
              <div className="mt-4">
                <h4 className="text-sm uppercase tracking-[0.08em] text-muted">Examples</h4>
                <ul className="list-disc space-y-1 pl-5">
                  {(Array.isArray(entry.examples) ? entry.examples : []).map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
