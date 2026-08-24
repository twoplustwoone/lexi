import type { WordCard, WordDetailsStatus } from '@word-of-the-day/shared';

import type { HistoryEntry } from '../../storage';
import type { WordEntryData } from './WordEntry';

/**
 * Shared shaping for the stream: history entries in, dated and month-grouped
 * entries out. Lives apart from the screen so search and word detail read the
 * same shapes.
 */

export interface StreamEntry extends WordEntryData {
  wordId: number;
  /** The day it was delivered, as an ISO date. */
  date: string;
  /** `18 July` */
  kicker: string;
}

export interface MonthGroup {
  /** `2026-07` — stable key for scroll targets. */
  key: string;
  /** `July 2026` */
  label: string;
  /** `J` — the scrubber initial. */
  initial: string;
  entries: StreamEntry[];
}

/** delivered_on is the authoritative day; delivered_at is a timestamp. */
export function entryDate(entry: HistoryEntry): string {
  return entry.delivered_on ?? entry.delivered_at.slice(0, 10);
}

export function formatKicker(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

export function formatShortKicker(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * History rows carry a flattened legacy shape; the entry components read a
 * WordCard. This rebuilds one so the archive renders identically to today.
 */
export function toWordCard(entry: HistoryEntry): WordCard | null {
  if (!entry.definition) return null;
  return {
    word: entry.word,
    phonetics: entry.pronunciation || null,
    audioUrl: entry.audio_url ?? null,
    meanings: [
      {
        partOfSpeech: '',
        definitions: [entry.definition],
        examples: entry.examples ?? [],
      },
    ],
    etymology: entry.etymology || null,
  };
}

export function toStreamEntry(entry: HistoryEntry): StreamEntry {
  const date = entryDate(entry);
  const details = toWordCard(entry);
  return {
    wordId: entry.word_id,
    word: entry.word,
    date,
    kicker: formatKicker(date),
    details,
    detailsStatus: (details ? 'ready' : 'not_found') as WordDetailsStatus,
  };
}

/** Newest first — the stream reads downward into the past. */
export function sortNewestFirst(entries: StreamEntry[]): StreamEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function groupByMonth(entries: StreamEntry[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      const date = new Date(`${entry.date}T00:00:00`);
      const label = Number.isNaN(date.getTime())
        ? key
        : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      group = {
        key,
        label,
        initial: label.charAt(0).toUpperCase(),
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return Array.from(groups.values());
}

/**
 * Day count since the first delivered word — the streak stated once, on You,
 * and as today's day number.
 */
export function dayNumber(entries: StreamEntry[], todayDate: string): number | null {
  if (entries.length === 0) return 1;
  const earliest = entries.reduce(
    (min, entry) => (entry.date < min ? entry.date : min),
    entries[0].date
  );
  const start = new Date(`${earliest}T00:00:00`).getTime();
  const today = new Date(`${todayDate}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(today)) return null;
  return Math.max(1, Math.round((today - start) / 86_400_000) + 1);
}

/** Substring match on the word and its definition, as the design specifies. */
export function matches(entry: StreamEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (entry.word.toLowerCase().includes(needle)) return true;
  const definition = entry.details?.meanings?.[0]?.definitions?.[0];
  return Boolean(definition && definition.toLowerCase().includes(needle));
}
