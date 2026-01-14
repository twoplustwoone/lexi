import { useEffect, useState } from 'preact/hooks';

import { fetchHistory, getClientType, trackEvent } from '../api';
import { HistoryEntry, getHistory, saveHistory } from '../storage';
import { getAnonymousId } from '../identity';

interface HistoryProps {
  path?: string;
  user: { userId: string | null };
}

export function History({ user }: HistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const remote = await fetchHistory();
        await saveHistory(remote);
        setHistory(remote);
      } catch {
        const cached = await getHistory();
        setHistory(cached.sort((a, b) => b.delivered_at.localeCompare(a.delivered_at)));
      } finally {
        setLoading(false);
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

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  if (loading) {
    return <div className={`${cardBase} p-6`}>Collecting your past words...</div>;
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
                {new Date(entry.delivered_at).toLocaleDateString()}
              </span>
              <span className="font-[var(--font-display)] text-lg">{entry.word}</span>
              <span className="text-muted">{entry.definition}</span>
            </summary>
            <div className="border-t border-[rgba(30,27,22,0.12)] px-6 pb-6 pt-4">
              <p className="text-sm text-muted">{entry.pronunciation}</p>
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
