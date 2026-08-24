import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Search } from 'lucide-react';
import { route } from 'preact-router';

import {
  fetchTodayWord,
  fetchTodayWordWithIdentity,
  markWordViewed,
  syncHistoryCache,
} from '../api';
import { useSchedule } from '../useSchedule';
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
  // "Day one" is a claim about the archive being empty, so it may only be made
  // once the archive has actually been read. Deriving it from the word's
  // loading flag flashed the first-run invitation at returning readers whose
  // history had not arrived yet.
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const schedule = useSchedule(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monthRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;

    const toEntry = (payload: {
      wordPoolId: number;
      word: string;
      day: string;
      details: StreamEntry['details'];
      detailsStatus: StreamEntry['detailsStatus'];
    }): StreamEntry => ({
      wordId: payload.wordPoolId,
      word: payload.word,
      date: payload.day,
      kicker: '',
      details: payload.details,
      detailsStatus: payload.detailsStatus,
    });

    /**
     * Enrichment can still be running when the word is served. Poll until the
     * card lands, so a pending word resolves in place rather than sitting on
     * "Looking up the definition" until the next remount.
     */
    const pollWhilePending = async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (cancelled) return;
        try {
          const updated = await fetchTodayWord();
          if (cancelled) return;
          if (updated.detailsStatus !== 'pending') {
            const entry = toEntry(updated);
            setToday(entry);
            cachedToday = entry;
            return;
          }
        } catch {
          return; // Stop polling rather than hammering a failing endpoint.
        }
      }
    };

    /** Today's date, computed locally — no round-trip needed to show it. */
    const todayKey = new Date().toISOString().slice(0, 10);

    /**
     * Paint from IndexedDB before touching the network.
     *
     * A returning reader already has their words on the device. Waiting on
     * two round-trips to show them meant a loading sentence, then a second
     * loading sentence, then the content — for data that was sitting locally
     * the whole time.
     */
    const paintFromCache = async () => {
      const history = await getHistory().catch(() => []);
      if (cancelled || history.length === 0) return;
      const entries = sortNewestFirst(history.map(toStreamEntry));
      setArchive(entries);
      cachedArchive = entries;
      setArchiveLoaded(true);
      if (!cachedToday && entries[0]?.date === todayKey) {
        setToday(entries[0]);
      }
      setLoading(false);
    };

    const loadToday = async () => {
      try {
        const payload = await fetchTodayWordWithIdentity();
        if (cancelled) return;
        const entry = toEntry(payload);
        setToday(entry);
        cachedToday = entry;
        setError(null);
        void markWordViewed(payload.wordPoolId).catch(() => undefined);
        if (payload.detailsStatus === 'pending') {
          void pollWhilePending();
        }
      } catch (err) {
        // Only an empty screen is worth an error; a cached word still reads.
        if (!cancelled && !cachedToday) {
          setError(err instanceof Error ? err.message : 'Could not load today’s word.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const refreshArchive = async () => {
      await syncHistoryCache().catch(() => undefined);
      const history = await getHistory().catch(() => []);
      if (cancelled) return;
      const entries = sortNewestFirst(history.map(toStreamEntry));

      // A cold offline launch has no served word, so the newest stored entry
      // stands in as today's reading rather than appearing only as a dimmed
      // archive row.
      setToday((current) => {
        if (current || entries.length === 0) return current;
        cachedToday = entries[0];
        setError(null);
        return entries[0];
      });

      setArchive(entries);
      cachedArchive = entries;
      setArchiveLoaded(true);
    };

    const load = async () => {
      // Local first, then both network reads at once rather than in a chain.
      await paintFromCache();
      await Promise.all([loadToday(), refreshArchive()]);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Today's word arrives through /word/today, and also lands in history once
  // the cache syncs — keep it out of the archive so it is not stated twice.
  const past = useMemo(
    () => archive.filter((entry) => !today || entry.date !== today.date),
    [archive, today]
  );

  const months = useMemo(() => groupByMonth(past), [past]);
  const day = useMemo(() => (today ? dayNumber(archive, today.date) : null), [archive, today]);

  const kickerDate = new Date(
    `${today ? today.date : new Date().toISOString().slice(0, 10)}T00:00:00`
  ).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const todayKicker = `Today · ${kickerDate}`;

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

  const isDayOne = archiveLoaded && !loading && past.length === 0;

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
          {/* The date rule is a local computation, so the entry keeps its
              shape from the first paint and only the word arrives into it. A
              sentence that swaps for another sentence and then for content
              reads as three separate screens. */}
          <DateRule
            kicker={isDayOne ? `Day 1 · ${kickerDate}` : todayKicker}
            dayCount={isDayOne ? null : day}
          />

          {error && !today ? (
            <p className="mt-5 text-[16px] text-accent-strong">{error}</p>
          ) : !today ? (
            <div aria-hidden="true" className="mt-4 h-[58px]" />
          ) : (
            <>
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
          )}

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

      <DeliveryTimeSheet
        open={deliverySheetOpen}
        onClose={() => setDeliverySheetOpen(false)}
        schedule={schedule}
      />
    </div>
  );
}
