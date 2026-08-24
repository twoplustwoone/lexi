import { useEffect, useState } from 'preact/hooks';

import { syncHistoryCache } from '../../api';
import { getHistory } from '../../storage';
import { StreamEntry, sortNewestFirst, toStreamEntry } from './stream';

/**
 * History for the routes that can be entered directly.
 *
 * Reading IndexedDB alone is wrong on a fresh device, after storage eviction,
 * or when a signed-in reader reloads straight into /search — the server has
 * their words and the screen would report having none. Sync first, then read;
 * the local copy still answers when the network does not.
 */
export function useStreamHistory(): { entries: StreamEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await syncHistoryCache().catch(() => undefined);
      const history = await getHistory().catch(() => []);
      if (cancelled) return;
      setEntries(sortNewestFirst(history.map(toStreamEntry)));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, loading };
}
