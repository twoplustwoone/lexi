import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Search } from 'lucide-react';
import { route } from 'preact-router';

import { fetchTodayWord, markWordViewed, syncHistoryCache } from '../api';
import { Button } from '../components/Button';
import { DateRule } from '../components/reader/DateRule';
import { DeliveryTimeSheet } from '../components/reader/DeliveryTimeSheet';
import { WordEntryCompact, WordEntryFull } from '../components/reader/WordEntry';
import {
  MonthGroup,
  StreamEntry,
  dayNumber,
  groupByMonth,
  sortNewestFirst,
  toStreamEntry,
} from '../components/reader/stream';
import { getHistory } from '../storage';

/** Survives a tab switch so the stream does not flash on every return. */
let cachedToday: StreamEntry | null = null;
let cachedArchive: StreamEntry[] = [];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Words(_props: { path?: string }) {
  const [today, setToday] = useState<StreamEntry | null>(() => cachedToday);
  const [archive, setArchive] = useState<StreamEntry[]>(() => cachedArchive);
  const [loading, setLoading] = useState(() => cachedToday === null);
  const [error, setError] = useState<string | null>(null);
  const [deliverySheetOpen, setDeliverySheetOpen] = useState(false);
  const [stickyMonth, setStickyMonth] = useState<MonthGroup | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monthRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await fetchTodayWord();
        const entry: StreamEntry = {
          wordId: payload.wordPoolId,
          word: payload.word,
          date: payload.day,
          kicker: '',
          details: payload.details,
          detailsStatus: payload.detailsStatus,
        };
        setToday(entry);
        cachedToday = entry;
        void markWordViewed(payload.wordPoolId).catch(() => undefined);
      } catch (err) {
        if (!cachedToday) {
          setError(err instanceof Error ? err.message : 'Could not load today’s word.');
        }
      } finally {
        setLoading(false);
      }

      // Offline renders identically to ready — cached words are not marked.
      await syncHistoryCache().catch(() => undefined);
      const history = await getHistory().catch(() => []);
      const entries = sortNewestFirst(history.map(toStreamEntry));
      setArchive(entries);
      cachedArchive = entries;
    };
    void load();
  }, []);

  // Today's word arrives through /word/today, and also lands in history once
  // the cache syncs — keep it out of the archive so it is not stated twice.
  const past = useMemo(
    () => archive.filter((entry) => !today || entry.date !== today.date),
    [archive, today]
  );

  const months = useMemo(() => groupByMonth(past), [past]);
  const day = useMemo(() => (today ? dayNumber(archive, today.date) : null), [archive, today]);

  const todayKicker = today
    ? `Today · ${new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
      })}`
    : '';

  // The sticky month header swaps as groups cross the top of the scroller.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || months.length === 0) return;

    const handleScroll = () => {
      let current: MonthGroup | null = null;
      for (const group of months) {
        const node = monthRefs.current.get(group.key);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= container.getBoundingClientRect().top + 8) {
          current = group;
        }
      }
      setStickyMonth(current);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [months]);

  const jumpToMonth = (key: string) => {
    monthRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const isDayOne = !loading && past.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Nothing sits above today's word but the wordmark and the date rule. */}
      <div className="flex flex-none items-center gap-1.5 px-7 pt-1">
        <span className="font-display text-[12px] uppercase tracking-[0.28em] text-ink/[0.6]">
          Lexi
        </span>
        <span className="flex-1" />
        {past.length > 0 ? (
          <button
            type="button"
            onClick={() => route('/search')}
            aria-label="Search your words"
            className="flex h-11 w-11 cursor-pointer items-center justify-center text-ink/[0.6]"
          >
            <Search size={18} strokeWidth={1.4} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {stickyMonth ? (
        <div className="flex flex-none items-baseline gap-3 border-b border-ink/[0.16] bg-bg px-7 py-2">
          <span className="tabular text-[10px] uppercase tracking-[0.18em] text-accent">
            {stickyMonth.label}
          </span>
          <span className="tabular text-[10px] uppercase tracking-[0.14em] text-ink/[0.45]">
            {stickyMonth.entries.length} {stickyMonth.entries.length === 1 ? 'word' : 'words'}
          </span>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 pt-4">
          {error && !today ? (
            <p className="py-8 text-[16px] text-accent-strong">{error}</p>
          ) : loading && !today ? (
            <p className="py-8 text-[16px] text-ink/[0.55]">Loading today’s word.</p>
          ) : today ? (
            <>
              <DateRule
                kicker={isDayOne ? `Day 1 · ${todayKicker.split('· ')[1] ?? ''}` : todayKicker}
                dayCount={isDayOne ? null : day}
              />
              <WordEntryFull entry={today} />

              {isDayOne ? (
                <div className="mt-8 border-t border-ink/[0.16] pt-5">
                  <h3 className="m-0 mb-1.5 font-display text-[21px] font-normal">
                    This is the whole app
                  </h3>
                  <p className="m-0 mb-4 text-[15px] leading-[1.6] text-ink/[0.68]">
                    One word a day, kept here. Scroll down tomorrow and today’s word will be waiting
                    underneath the new one.
                  </p>
                  {/* The only place notification setup is offered proactively. */}
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    onClick={() => setDeliverySheetOpen(true)}
                  >
                    Choose a delivery time
                  </Button>
                  <div className="mt-2.5 text-center text-[13px] text-ink/[0.52]">
                    Or skip — it will be here when you open the app
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* The previous day at half opacity: the scroll affordance. */}
          {past.length > 0 ? (
            <>
              <div className="mt-[30px] h-px bg-ink/[0.16]" />
              <div className="pr-6">
                {months.map((group) => (
                  <div
                    key={group.key}
                    ref={(node) => {
                      if (node) monthRefs.current.set(group.key, node);
                    }}
                  >
                    {group.entries.map((entry, index) => (
                      <WordEntryCompact
                        key={entry.wordId}
                        entry={entry}
                        kicker={entry.kicker}
                        last={index === group.entries.length - 1}
                        dimmed={group === months[0] && index === 0}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Month scrubber, pinned to the right edge of the frame rather than
            floated into the entries, where it collided with the text. */}
        {months.length > 1 ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 flex-col items-center justify-center gap-[11px]">
            {months.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() => jumpToMonth(group.key)}
                aria-label={`Jump to ${group.label}`}
                className={`pointer-events-auto cursor-pointer font-display text-[10px] tracking-[0.06em] ${
                  stickyMonth?.key === group.key
                    ? 'border-b border-accent pb-px text-accent'
                    : 'text-ink/[0.38]'
                }`}
              >
                {group.initial}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <DeliveryTimeSheet open={deliverySheetOpen} onClose={() => setDeliverySheetOpen(false)} />
    </div>
  );
}
