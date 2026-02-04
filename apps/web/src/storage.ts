import { openDB } from 'idb';
import type { PreferencesV1 } from '@word-of-the-day/shared';

export interface HistoryEntry {
  word_id: number;
  delivered_at: string;
  delivered_on?: string;
  viewed_at: string | null;
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  audio_url?: string | null;
  examples: string[];
}

export interface SettingsState {
  schedule: {
    enabled: boolean;
    delivery_time: string;
    timezone: string;
  };
  preferences: PreferencesV1;
}

const DB_NAME = 'wotd';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('history')) {
      const store = db.createObjectStore('history', { keyPath: 'word_id' });
      store.createIndex('by-delivered-at', 'delivered_at');
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('outbox')) {
      db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    }
  },
});

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction('history', 'readwrite');
  for (const entry of entries) {
    await tx.store.put(entry);
  }
  await tx.done;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const db = await dbPromise;
  return db.getAll('history');
}

export async function saveSettings(settings: SettingsState): Promise<void> {
  const db = await dbPromise;
  await db.put('settings', { id: 'settings', ...settings });
}

export async function getSettings(): Promise<SettingsState | null> {
  const db = await dbPromise;
  const record = await db.get('settings', 'settings');
  if (!record) {
    return null;
  }
  const { id, ...rest } = record as { id: string } & SettingsState;
  void id;
  return rest;
}

export async function addOutboxEvent(event: Record<string, unknown>): Promise<void> {
  const db = await dbPromise;
  await db.add('outbox', { event });
}
