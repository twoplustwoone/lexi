import { useEffect, useState } from 'preact/hooks';

import {
  WordDifficulty,
  WordPoolEntry,
  bulkCreateAdminWords,
  createAdminWord,
  fetchWordPool,
} from '../../api';
import { difficultyLabel } from './format';
import {
  AdminButton,
  DIVIDER,
  ErrorLine,
  LoadingLine,
  SearchField,
  Segmented,
  StatusEnum,
  Tag,
} from './primitives';

const PAGE_SIZE = 20;

type Filter = 'all' | WordDifficulty;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'easy', label: 'Easy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'advanced', label: 'Advanced' },
];

/**
 * The words table. Status values are the real enums, rendered in monospace to
 * signal they are system values — no friendlier labels without changing the
 * data behind them.
 */
export function Words({ headerSlot }: { headerSlot: (meta: string) => void }) {
  const [words, setWords] = useState<WordPoolEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWordPool({
        limit: PAGE_SIZE,
        offset,
        search: search.trim() || undefined,
        difficultyCategory: filter === 'all' ? undefined : filter,
      });
      setWords(response.words);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load words');
    } finally {
      setLoading(false);
    }
  };

  // Debounced so typing a query does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search, filter, offset]);

  useEffect(() => {
    headerSlot(`${total} total · ${PAGE_SIZE} per page`);
  }, [total]);

  // Changing the query or the filter should return you to the first page.
  useEffect(() => {
    setOffset(0);
  }, [search, filter]);

  const handleAddWord = async () => {
    const word = window.prompt('Word to add');
    if (!word?.trim()) return;
    const definition = window.prompt(`Definition for ${word.trim()}`);
    if (!definition?.trim()) return;
    try {
      await createAdminWord({ word: word.trim(), definition: definition.trim() });
      setNotice(`Added ${word.trim()}.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the word');
    }
  };

  const handleBulkUpload = async () => {
    const raw = window.prompt('Paste a JSON array of words');
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Expected a JSON array.');
      }
      const result = await bulkCreateAdminWords(parsed);
      setNotice(
        `Created ${result.created}${result.errors.length ? `, ${result.errors.length} rejected` : ''}.`
      );
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload');
    }
  };

  return (
    <>
      <div className="flex flex-none flex-col gap-3.5 pb-3.5 pt-4 lg:flex-row lg:items-center">
        <SearchField
          value={search}
          onInput={setSearch}
          label="Find a word"
          placeholder="Find a word"
        />
        {/* The segmented control becomes tags at phone width. */}
        <div className="hidden lg:block">
          <Segmented
            label="Filter by level"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </div>
        <div className="flex flex-wrap gap-[7px] lg:hidden">
          {FILTERS.map((option) => (
            <Tag
              key={option.value}
              selected={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value === 'all' ? ` ${total}` : ''}
            </Tag>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 pb-3.5">
        <AdminButton variant="ghost" onClick={handleBulkUpload}>
          Bulk upload
        </AdminButton>
        <AdminButton variant="primary" onClick={handleAddWord}>
          Add a word
        </AdminButton>
      </div>

      {notice ? <p className="pb-2 text-[14px] text-accent-strong">{notice}</p> : null}

      {error ? (
        <ErrorLine message={error} onRetry={load} />
      ) : loading && words.length === 0 ? (
        <LoadingLine>Loading words.</LoadingLine>
      ) : words.length === 0 ? (
        <p className="py-6 text-[15px] text-ink/[0.66]">
          Nothing here yet{search ? ` for ${search}` : ''}.
        </p>
      ) : (
        <>
          {/* Desktop: a table. Phone: list rows. */}
          <table className="hidden w-full border-collapse text-[14px] lg:table">
            <thead>
              <tr>
                <th
                  className={`border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
                >
                  Word
                </th>
                <th
                  className={`w-[100px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
                >
                  Level
                </th>
                <th
                  className={`w-[112px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
                >
                  Details
                </th>
                <th
                  className={`w-[70px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
                >
                  Enabled
                </th>
              </tr>
            </thead>
            <tbody>
              {words.map((entry) => (
                <tr key={entry.id} className="hover:bg-ink/[0.04]">
                  <td className={`border-b ${DIVIDER} px-2 py-2`}>
                    <span className="font-display text-[18px]">{entry.word}</span>
                  </td>
                  <td className={`border-b ${DIVIDER} px-2 py-2`}>
                    {difficultyLabel(entry.difficultyCategory)}
                  </td>
                  <td className={`border-b ${DIVIDER} px-2 py-2`}>
                    <StatusEnum
                      status={
                        entry.reviewStatus === 'pending_review'
                          ? 'pending_review'
                          : entry.detailsStatus
                      }
                    />
                  </td>
                  <td className={`border-b ${DIVIDER} px-2 py-2`}>
                    {entry.enabled ? 'Yes' : 'No'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="lg:hidden">
            {words.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-baseline gap-2.5 border-b py-[13px] ${DIVIDER} last:border-b-0`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[21px] leading-[1.2]">{entry.word}</div>
                  <div className="text-[12px] text-ink/[0.55]">
                    {difficultyLabel(entry.difficultyCategory)}
                  </div>
                </div>
                <StatusEnum
                  status={
                    entry.reviewStatus === 'pending_review' ? 'pending_review' : entry.detailsStatus
                  }
                />
              </div>
            ))}
          </div>

          {total > PAGE_SIZE ? (
            <div className="flex items-center gap-3 py-4">
              <AdminButton
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset((previous) => Math.max(0, previous - PAGE_SIZE))}
              >
                Previous
              </AdminButton>
              <span className="tabular text-[13px] text-ink/[0.55]">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <AdminButton
                variant="ghost"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((previous) => previous + PAGE_SIZE)}
              >
                Next
              </AdminButton>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
