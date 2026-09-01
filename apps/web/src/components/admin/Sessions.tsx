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
 * says which cause they point at. The evidence is the list; the verdict above
 * it is only ever a reading of the list.
 *
 * Two kinds of evidence, and the difference matters. Most causes are witnessed
 * outright — the record says what happened. Storage eviction cannot be: it
 * takes the cookie and the app's own flag together and leaves a device
 * indistinguishable from a first-time visitor. All it leaves is a session that
 * stops being presented while it is still valid, which is why that is computed
 * here across records rather than claimed by any one of them.
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
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a session must go unseen to count as having gone quiet. Accepted
 * sessions are recorded at most every six hours, so anyone opening the app
 * daily leaves a daily trace — three days of silence is a real absence, not a
 * gap in the sampling.
 */
const QUIET_MS = 3 * DAY_MS;

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
  expired: {
    title: 'Sessions are reaching their expiry',
    detail:
      'The sessions were still on record and had simply run out. Compare the age each one reached against SESSION_TTL_DAYS: at the full term, the fix is a longer TTL or renewal on use; well short of it, something is writing a shorter expiry than the setting says.',
  },
  cookie_missing: {
    title: 'The session cookie is not coming back',
    detail:
      'A device that had signed in returned without it, on a request the browser did not call cross-site, while the session was still on record. Check the Max-Age the cookie goes out with against how long it actually survives. The cookie names on each row say what else came back, though not whether the jar was empty before the app registered an anonymous identity ahead of this request.',
  },
  unknown_token: {
    title: 'Sessions are vanishing from the database',
    detail:
      'A valid-looking cookie named a session with no row behind it. Either the row was deleted, or SESSION_SECRET changed — every session hash is derived from it, so rotating it signs everybody out at once.',
  },
};

/** The reading when nothing was witnessed but sessions stopped being used. */
const QUIET_VERDICT = {
  title: 'Sessions are going quiet while still valid',
  detail:
    'Nothing was witnessed being taken away — but sessions stopped being presented well before they expired, with no sign-out recorded. That is the trace storage eviction leaves: the browser clears the site, and the next visit is indistinguishable from a stranger’s. It is also what someone simply not opening the app looks like, so read it alongside whether these readers came back at all.',
};

function metadataOf(entry: AdminLogEntry): Record<string, unknown> {
  return entry.metadata ?? {};
}

function outcomeOf(entry: AdminLogEntry): string {
  const outcome = metadataOf(entry).outcome;
  return typeof outcome === 'string' ? outcome : 'unknown';
}

function stringField(entry: AdminLogEntry, key: string): string | null {
  const value = metadataOf(entry)[key];
  return typeof value === 'string' ? value : null;
}

function detailOf(entry: AdminLogEntry): string[] {
  const metadata = metadataOf(entry);
  const parts: string[] = [];

  const site = metadata.secFetchSite;
  if (typeof site === 'string') parts.push(site);

  const cookies = metadata.cookieNames;
  if (Array.isArray(cookies)) {
    parts.push(cookies.length > 0 ? `cookies: ${cookies.join(', ')}` : 'no cookies');
  }

  const age = metadata.ageDays;
  if (typeof age === 'number') parts.push(`${age}d old`);

  const display = metadata.clientDisplay;
  if (display === 'standalone') parts.push('installed');

  const platform = metadata.platform;
  if (typeof platform === 'string' && platform !== 'unknown') parts.push(platform);

  return parts;
}

interface QuietSession {
  sessionId: string;
  lastSeen: string;
  expiresAt: string;
  daysLeftWhenLastSeen: number;
}

/**
 * Sessions last seen long ago that had plenty of life left, and were never
 * signed out. Eviction cannot be caught in the act, so it is inferred from the
 * silence it leaves behind.
 */
function quietSessions(entries: AdminLogEntry[], now: number): QuietSession[] {
  const seen = new Map<string, { lastSeen: number; expiresAt: string }>();
  const abandoned = new Set<string>();

  for (const entry of entries) {
    const sessionId = stringField(entry, 'sessionId');
    if (!sessionId) continue;

    if (outcomeOf(entry) === 'signed_out') {
      abandoned.add(sessionId);
      continue;
    }

    const expiresAt = stringField(entry, 'sessionExpiresAt');
    if (!expiresAt) continue;

    const at = Date.parse(entry.timestamp);
    if (Number.isNaN(at)) continue;

    const existing = seen.get(sessionId);
    if (!existing || at > existing.lastSeen) {
      seen.set(sessionId, { lastSeen: at, expiresAt });
    }
  }

  const quiet: QuietSession[] = [];
  for (const [sessionId, record] of seen) {
    if (abandoned.has(sessionId)) continue;

    const expiresAt = Date.parse(record.expiresAt);
    if (Number.isNaN(expiresAt)) continue;

    const silentFor = now - record.lastSeen;
    const lifeLeft = expiresAt - record.lastSeen;
    // Silent for a while, and with real time still on the clock when it went
    // silent — otherwise this is just a session running out, which is witnessed.
    if (silentFor < QUIET_MS || lifeLeft < QUIET_MS) continue;

    quiet.push({
      sessionId,
      lastSeen: new Date(record.lastSeen).toISOString(),
      expiresAt: record.expiresAt,
      daysLeftWhenLastSeen: Math.round(lifeLeft / DAY_MS),
    });
  }

  return quiet.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
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
      const since = new Date(Date.now() - days * DAY_MS).toISOString();
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

  const signOuts = useMemo(
    () => entries.filter((entry) => UNEXPECTED.has(outcomeOf(entry))),
    [entries]
  );

  const quiet = useMemo(() => quietSessions(entries, Date.now()), [entries]);

  /** The most common witnessed cause, if anything was witnessed at all. */
  const reading = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of signOuts) {
      const outcome = outcomeOf(entry);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    let top: { outcome: string; count: number } | null = null;
    for (const [outcome, count] of counts) {
      if (!top || count > top.count) top = { outcome, count };
    }
    return top;
  }, [signOuts]);

  useEffect(() => {
    if (loading) {
      headerSlot('');
      return;
    }
    const witnessed = `${signOuts.length} ${signOuts.length === 1 ? 'sign-out' : 'sign-outs'}`;
    headerSlot(
      quiet.length > 0 ? `${witnessed} · ${quiet.length} quiet` : `${witnessed} · ${days} days`
    );
  }, [headerSlot, signOuts.length, quiet.length, days, loading]);

  const verdict = reading ? VERDICTS[reading.outcome] : quiet.length > 0 ? QUIET_VERDICT : null;

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
              No unwanted sign-outs in this window — every session was either accepted, still in
              use, or ended by someone signing out.
            </p>
          ) : (
            <div className={`rounded-md border px-4 py-4 lg:px-5 ${DIVIDER}`}>
              <p className="m-0 text-[17px] leading-[1.4]">{verdict.title}</p>
              <p className="mb-0 mt-2 text-[14px] leading-[1.6] text-ink/[0.68]">
                {verdict.detail}
              </p>
              <p className="mb-0 mt-3 text-[13px] text-ink/[0.52]">
                {reading
                  ? `${reading.count} of ${signOuts.length} witnessed sign-outs in the last ${days} days.`
                  : `${quiet.length} ${quiet.length === 1 ? 'session' : 'sessions'} went quiet in the last ${days} days, with none witnessed being taken away.`}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <SectionLabel className="mb-3 mt-6">Witnessed sign-outs</SectionLabel>
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

      {quiet.length > 0 ? (
        <>
          <SectionLabel className="mb-1.5 mt-6">Went quiet while still valid</SectionLabel>
          <p className="mb-3 mt-0 max-w-[62ch] text-[13px] leading-[1.6] text-ink/[0.6]">
            Last presented long before they were due to expire, and never signed out. This is what
            storage eviction leaves behind — it cannot be caught in the act — but it is equally what
            someone who stopped opening the app looks like.
          </p>
          {quiet.map((session) => (
            <div
              key={session.sessionId}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-[11px] ${DIVIDER} last:border-b-0`}
            >
              <span className="tabular w-[92px] flex-none text-[12px] text-ink/[0.52]">
                {formatDateTime(session.lastSeen)}
              </span>
              <StatusEnum status="went_quiet" className="flex-none" />
              <span className="w-full text-[13px] text-ink/[0.6] lg:w-auto lg:flex-1">
                {session.daysLeftWhenLastSeen}d still to run
              </span>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}
