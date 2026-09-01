import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import {
  SessionDiagnosis,
  SessionEvidence,
  SessionObservation,
  diagnoseSession,
  isUnwantedSessionLoss,
} from '@word-of-the-day/shared';

import { AdminLogEntry, fetchAdminLogsSince } from '../../api';
import { formatDateTime } from './format';
import { DIVIDER, ErrorLine, LoadingLine, SectionLabel, StatusEnum } from './primitives';

/**
 * Why people are being signed out.
 *
 * A sign-out that only happens on a phone cannot be chased with a debugger, so
 * the API records what each request presented and what became of the session
 * it named. Those records state observations only. Turning them into an
 * explanation is `diagnoseSession`, and this screen is where that runs — over
 * evidence that is still intact, rather than a conclusion frozen into a row.
 *
 * Every reading here carries its standing: whether the evidence admits one
 * explanation or several. A shortlist honestly labelled is worth more than a
 * confident answer that sends someone to change the wrong setting.
 *
 * Storage eviction is the one cause no record can witness — it takes the
 * cookie and the app's own flag together and leaves a device identical to a
 * first-time visitor. What it leaves instead is a session that stops being
 * presented while still valid, computed below across records, and claimed
 * nowhere else.
 */

type Window = '7d' | '30d';

const WINDOWS: Array<{ value: Window; label: string; days: number }> = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a session must go unseen to count as having gone quiet. Accepted
 * sessions are recorded at most every six hours, so anyone opening the app
 * daily leaves a daily trace — three days of silence is a real absence, not a
 * gap in the sampling.
 */
const QUIET_MS = 3 * DAY_MS;

/** The reading when nothing was observed but sessions stopped being used. */
const QUIET_READING: SessionDiagnosis = {
  statement:
    'Sessions are going quiet while still valid: they stopped being presented well before they expired, with no sign-out recorded.',
  standing: 'narrowed',
  nextStep:
    'That is the trace storage eviction leaves — the browser clears the site, and the next visit is indistinguishable from a stranger\u2019s. It is equally what someone who stopped opening the app looks like, so read it alongside whether these readers came back at all.',
};

function metadataOf(entry: AdminLogEntry): Record<string, unknown> {
  return entry.metadata ?? {};
}

function outcomeOf(entry: AdminLogEntry): string {
  const outcome = metadataOf(entry).outcome;
  return typeof outcome === 'string' ? outcome : 'unknown';
}

/** The recorded facts, in the shape the shared reading expects. */
function evidenceOf(entry: AdminLogEntry): SessionEvidence {
  const metadata = metadataOf(entry);
  const policy = (metadata.cookiePolicy ?? {}) as { sameSite?: string; ttlDays?: number };
  return {
    observation: outcomeOf(entry) as SessionObservation,
    secFetchSite: typeof metadata.secFetchSite === 'string' ? metadata.secFetchSite : null,
    sameSite: typeof policy.sameSite === 'string' ? policy.sameSite : null,
    ageDays: typeof metadata.ageDays === 'number' ? metadata.ageDays : null,
    ttlDays: typeof policy.ttlDays === 'number' ? policy.ttlDays : null,
  };
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
    () => entries.filter((entry) => isUnwantedSessionLoss(outcomeOf(entry))),
    [entries]
  );

  const quiet = useMemo(() => quietSessions(entries, Date.now()), [entries]);

  /**
   * The reading that accounts for most of the losses.
   *
   * Grouped by what the evidence says, not by the observation: two rows can
   * both be a missing cookie and mean different things, and rows that mean the
   * same thing belong together however they were observed.
   */
  const reading = useMemo(() => {
    const groups = new Map<string, { diagnosis: SessionDiagnosis; count: number }>();
    for (const entry of signOuts) {
      const diagnosis = diagnoseSession(evidenceOf(entry));
      const group = groups.get(diagnosis.statement);
      if (group) {
        group.count += 1;
      } else {
        groups.set(diagnosis.statement, { diagnosis, count: 1 });
      }
    }
    let top: { diagnosis: SessionDiagnosis; count: number } | null = null;
    for (const group of groups.values()) {
      if (!top || group.count > top.count) top = group;
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

  const shown = reading?.diagnosis ?? (quiet.length > 0 ? QUIET_READING : null);

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
          ) : !shown ? (
            <p className="m-0 text-[15px] text-ink/[0.66]">
              No unwanted sign-outs in this window — every session was either accepted, still in
              use, or ended by someone signing out.
            </p>
          ) : (
            <div className={`rounded-md border px-4 py-4 lg:px-5 ${DIVIDER}`}>
              <p className="m-0 text-[17px] leading-[1.4]">{shown.statement}</p>
              {shown.nextStep ? (
                <p className="mb-0 mt-2 text-[14px] leading-[1.6] text-ink/[0.68]">
                  {shown.nextStep}
                </p>
              ) : null}
              <p className="mb-0 mt-3 text-[13px] text-ink/[0.52]">
                {/* Said plainly, because reading a shortlist as an answer is
                    how the wrong setting gets changed. */}
                {shown.standing === 'determined'
                  ? 'The evidence admits one explanation.'
                  : 'Several explanations remain — the evidence narrows it to these.'}{' '}
                {reading
                  ? `${reading.count} of ${signOuts.length} losses in the last ${days} days.`
                  : `${quiet.length} ${quiet.length === 1 ? 'session' : 'sessions'} went quiet in the last ${days} days, with no loss recorded.`}
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
