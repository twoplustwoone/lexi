import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { AdminLogEntry, fetchAdminLogsSince } from '../../api';
import { formatDateTime } from './format';
import { DIVIDER, ErrorLine, LoadingLine, SectionLabel, StatusEnum } from './primitives';

/**
 * Why people are being signed out.
 *
 * A sign-out that only happens on a phone cannot be chased with a debugger, so
 * the API records what the browser presented on every `/api/me` and what
 * became of the session it named. This screen reads those records back and
 * says which of the causes they point at. The evidence is the list; the
 * verdict above it is only ever a reading of the list.
 */

type Window = '7d' | '30d';

const WINDOWS: Array<{ value: Window; label: string; days: number }> = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
];

/** The outcomes that mean somebody lost a session they had not given up. */
const UNEXPECTED = new Set([
  'expired',
  'unknown_token',
  'cookie_withheld_cross_site',
  'cookie_missing',
  'storage_cleared',
]);

/**
 * What each outcome means and what would actually change it. Every verdict
 * names a specific next move — a diagnosis that ends in "investigate further"
 * is the state this screen exists to get out of.
 */
const VERDICTS: Record<string, { title: string; detail: string }> = {
  cookie_withheld_cross_site: {
    title: 'The browser is refusing to send the session cookie',
    detail:
      'These requests came back marked cross-site, and a SameSite=Lax cookie is withheld on those by design. The API is on a different site than the app. Set SESSION_COOKIE_SAMESITE to None (it already requires HTTPS, which COOKIE_SECURE gives you), or move the API onto the app’s own domain.',
  },
  storage_cleared: {
    title: 'The browser is clearing the whole site',
    detail:
      'The session cookie and the app’s own local flag went at the same time, which no expiry or cookie rule does — the browser threw the site’s storage away. Safari and iOS do this to sites they consider idle, and an installed PWA is hit hardest. No cookie lifetime survives it; staying signed in needs a credential the app re-presents after eviction.',
  },
  expired: {
    title: 'Sessions are reaching their expiry',
    detail:
      'The sessions were still on record and had simply run out. Compare the age each one reached against SESSION_TTL_DAYS: at the full term, the fix is a longer TTL or renewal on use; well short of it, something is writing a shorter expiry than the setting says.',
  },
  cookie_missing: {
    title: 'The session cookie alone is disappearing',
    detail:
      'Other site data survived, so this was not an eviction and not a cross-site refusal — the cookie specifically was lost. Check the Max-Age it goes out with against how long it actually lasts.',
  },
  unknown_token: {
    title: 'Sessions are vanishing from the database',
    detail:
      'A valid-looking cookie named a session with no row behind it. Either the row was deleted, or SESSION_SECRET changed — every session hash is derived from it, so rotating it signs everybody out at once.',
  },
};

interface Reading {
  outcome: string;
  count: number;
}

function outcomeOf(entry: AdminLogEntry): string {
  const outcome = entry.metadata?.outcome;
  return typeof outcome === 'string' ? outcome : 'unknown';
}

function detailOf(entry: AdminLogEntry): string[] {
  const metadata = entry.metadata ?? {};
  const parts: string[] = [];

  const site = metadata.secFetchSite;
  if (typeof site === 'string') parts.push(site);

  const cookies = metadata.cookieNames;
  if (Array.isArray(cookies)) {
    parts.push(cookies.length > 0 ? `cookies: ${cookies.join(', ')}` : 'no cookies');
  }

  const expectation = metadata.clientExpectation;
  if (expectation === 'expected') parts.push('app expected a session');

  const age = metadata.ageDays;
  if (typeof age === 'number') parts.push(`${age}d old`);

  const display = metadata.clientDisplay;
  if (display === 'standalone') parts.push('installed');

  const platform = metadata.platform;
  if (typeof platform === 'string' && platform !== 'unknown') parts.push(platform);

  return parts;
}

export function Sessions({ headerSlot }: { headerSlot: (meta: string) => void }) {
  const [entries, setEntries] = useState<AdminLogEntry[]>([]);
  const [windowChoice, setWindowChoice] = useState<Window>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = WINDOWS.find((option) => option.value === windowChoice)?.days ?? 7;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      setEntries(await fetchAdminLogsSince(since, { category: 'auth' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session records.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Newest first, and only the moments worth reading — accepted sessions are the bulk. */
  const signOuts = useMemo(
    () => entries.filter((entry) => UNEXPECTED.has(outcomeOf(entry))),
    [entries]
  );

  const reading = useMemo<Reading | null>(() => {
    const counts = new Map<string, number>();
    for (const entry of signOuts) {
      const outcome = outcomeOf(entry);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    let top: Reading | null = null;
    for (const [outcome, count] of counts) {
      if (!top || count > top.count) top = { outcome, count };
    }
    return top;
  }, [signOuts]);

  useEffect(() => {
    headerSlot(
      loading
        ? ''
        : `${signOuts.length} unwanted ${signOuts.length === 1 ? 'sign-out' : 'sign-outs'} · ${days} days`
    );
  }, [headerSlot, signOuts.length, days, loading]);

  const verdict = reading ? VERDICTS[reading.outcome] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 pt-4">
        <SectionLabel>What the records say</SectionLabel>
        <span className="flex-1" />
        {WINDOWS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === windowChoice}
            onClick={() => setWindowChoice(option.value)}
            className={`cursor-pointer text-[13px] ${
              option.value === windowChoice ? 'text-accent' : 'text-ink/[0.55]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <ErrorLine message={error} onRetry={load} /> : null}

      {loading && entries.length === 0 ? <LoadingLine>Reading session records.</LoadingLine> : null}

      {!loading && !error ? (
        <div className="mt-3">
          {entries.length === 0 ? (
            <p className="m-0 text-[15px] text-ink/[0.66]">
              Nothing recorded yet. The next time the app is opened it will start writing here.
            </p>
          ) : !verdict ? (
            <p className="m-0 text-[15px] text-ink/[0.66]">
              No unwanted sign-outs in this window — every session was either accepted or ended by
              someone signing out.
            </p>
          ) : (
            <div className={`rounded-md border px-4 py-4 lg:px-5 ${DIVIDER}`}>
              <p className="m-0 text-[17px] leading-[1.4]">{verdict.title}</p>
              <p className="mb-0 mt-2 text-[14px] leading-[1.6] text-ink/[0.68]">
                {verdict.detail}
              </p>
              <p className="mb-0 mt-3 text-[13px] text-ink/[0.52]">
                {reading?.count} of {signOuts.length} unwanted sign-outs in the last {days} days.
              </p>
            </div>
          )}
        </div>
      ) : null}

      <SectionLabel className="mb-3 mt-6">Every sign-out</SectionLabel>
      {!loading && signOuts.length === 0 ? (
        <p className="m-0 text-[15px] text-ink/[0.66]">None.</p>
      ) : (
        signOuts.map((entry) => (
          <div
            key={entry.id}
            className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-[11px] ${DIVIDER} last:border-b-0`}
          >
            <span className="tabular w-[92px] flex-none text-[12px] text-ink/[0.52]">
              {formatDateTime(entry.timestamp)}
            </span>
            <StatusEnum status={outcomeOf(entry)} className="flex-none" />
            <span className="w-full text-[13px] text-ink/[0.6] lg:w-auto lg:flex-1">
              {detailOf(entry).join(' · ')}
            </span>
          </div>
        ))
      )}
    </>
  );
}
