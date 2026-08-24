import { ArrowLeft, ArrowRight } from 'lucide-react';
import { route } from 'preact-router';

import { DateRule } from '../components/reader/DateRule';
import { Tag } from '../components/reader/SettingRow';
import { WordEntryFull } from '../components/reader/WordEntry';
import { dayNumber, formatKicker } from '../components/reader/stream';
import { useStreamHistory } from '../components/reader/useStreamHistory';

interface WordDetailProps {
  path?: string;
  id?: string;
}

/**
 * The same full entry as today's word, at the same sizes — a word you looked
 * up is not less important than today's.
 */
export function WordDetail({ id }: WordDetailProps) {
  const { entries: all, loading } = useStreamHistory();
  const entry = all.find((candidate) => String(candidate.wordId) === id) ?? null;

  // The back affordance names where you came from.
  const origin =
    typeof document !== 'undefined' && document.referrer.includes('/search') ? 'Search' : 'Archive';

  if (loading) {
    return <p className="px-7 py-8 text-[16px] text-ink/[0.55]">Loading.</p>;
  }

  if (!entry) {
    return (
      <div className="px-7 py-8">
        <p className="m-0 text-[16px] text-ink/[0.66]">That word is not in your archive.</p>
        <button
          type="button"
          onClick={() => route('/')}
          className="mt-4 min-h-[44px] cursor-pointer text-[15px] text-accent"
        >
          Back to your words
        </button>
      </div>
    );
  }

  const synonyms = entry.details?.meanings?.flatMap((meaning) => meaning.synonyms ?? []) ?? [];
  const day = dayNumber(all, entry.date);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-[18px] pt-1">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex min-h-[44px] cursor-pointer items-center gap-2 px-2.5 text-accent"
        >
          <ArrowLeft size={17} strokeWidth={1.4} aria-hidden="true" />
          <span className="text-[15px]">{origin}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 pt-3">
        <DateRule variant="past" kicker={formatKicker(entry.date)} dayCount={day} />
        <WordEntryFull entry={entry} />

        {/* The whole block hides when the array is empty. */}
        {synonyms.length > 0 ? (
          <div className="mt-[26px] border-t border-ink/[0.16] pt-[18px]">
            <div className="mb-2.5 text-[10px] uppercase tracking-[0.16em] text-accent">
              Synonyms
            </div>
            <div className="flex flex-wrap gap-2">
              {synonyms.slice(0, 8).map((synonym) => (
                <Tag key={synonym}>{synonym}</Tag>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => route('/')}
        className="flex min-h-[52px] flex-none cursor-pointer items-center justify-between border-t border-ink/[0.16] px-7 text-accent"
      >
        <span className="font-display text-[14px]">Show in the stream</span>
        <ArrowRight size={17} strokeWidth={1.4} aria-hidden="true" />
      </button>
    </div>
  );
}
