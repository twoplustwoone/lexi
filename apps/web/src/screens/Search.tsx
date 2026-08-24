import { useEffect, useMemo, useState } from 'preact/hooks';
import { route } from 'preact-router';

import { ResultCount, ResultRow, SearchField } from '../components/reader/SearchField';
import { Tag } from '../components/reader/SettingRow';
import { formatShortKicker, matches } from '../components/reader/stream';
import { useStreamHistory } from '../components/reader/useStreamHistory';

/**
 * Full screen. Substring match on the word and its definition, so `quie` finds
 * `acquiesce`. The match is underlined in accent, never highlighted in a block.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Search(_props: { path?: string }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const { entries } = useStreamHistory();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useMemo(
    () => entries.filter((entry) => matches(entry, debounced)),
    [entries, debounced]
  );

  const recent = entries.slice(0, 5);
  const searching = debounced.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-7 pt-2">
        <SearchField value={query} onInput={setQuery} onCancel={() => route('/')} autoFocus />
      </div>

      <div className="flex-1 overflow-y-auto px-7 pt-4">
        {searching ? (
          <>
            <ResultCount>
              {results.length > 0
                ? `${results.length} of your ${entries.length} words`
                : `No match in your ${entries.length} words`}
            </ResultCount>

            {results.length > 0 ? (
              results.map((entry) => (
                <ResultRow
                  key={entry.wordId}
                  kicker={formatShortKicker(entry.date)}
                  word={entry.word}
                  definition={entry.details?.meanings?.[0]?.definitions?.[0] ?? null}
                  query={debounced}
                  onClick={() => route(`/word/${entry.wordId}`)}
                />
              ))
            ) : (
              /* Keeps the page's structure and explains the gap in one line. */
              <>
                <p className="m-0 pt-4 text-[16px] leading-[1.6]">
                  Nothing here yet for{' '}
                  <span className="font-display text-[19px]">{debounced.trim()}</span>. It may still
                  turn up — words appear here the day they arrive.
                </p>
                {recent.length > 0 ? (
                  <div className="mt-6">
                    <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-ink/[0.5]">
                      Try one of these
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recent.map((entry) => (
                        <Tag key={entry.wordId} onClick={() => setQuery(entry.word)}>
                          {entry.word}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : recent.length > 0 ? (
          <div>
            <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-ink/[0.5]">
              Recent
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map((entry) => (
                <Tag key={entry.wordId} onClick={() => setQuery(entry.word)}>
                  {entry.word}
                </Tag>
              ))}
            </div>
          </div>
        ) : (
          <p className="m-0 text-[16px] text-ink/[0.66]">
            Your words will be searchable here once a few have arrived.
          </p>
        )}
      </div>
    </div>
  );
}
