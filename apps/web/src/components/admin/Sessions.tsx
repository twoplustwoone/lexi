import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import {
  SessionDiagnosis,
  SessionEvidence,
  SessionObservation,
  diagnoseSession,
} from '@word-of-the-day/shared';

import {
  QuietSessionRecord,
  SessionDiagnosticsResponse,
  SessionLossRecord,
  fetchSessionDiagnostics,
} from '../../api';
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
 * Every reading carries its standing: whether the evidence admits one
 * explanation or several. That distinction is the point. A shortlist read as
 * an answer is how someone ends up changing a setting that was never at fault.
 *
 * The API does the summarising. This screen used to page the raw log into the
 * browser and aggregate here, which put a row cap between it and the window it
 * claimed to show.
 */

type Window = '7d' | '30d';

const WINDOWS: Array<{ value: Window; label: string; days: number }> = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
];

/** The reading when nothing was observed but sessions stopped being used. */
const QUIET_READING: SessionDiagnosis = {
  kind: 'went_quiet',
  statement:
    'Sessions are going quiet while still valid: they stopped being presented well before they expired, with no sign-out recorded.',
  standing: 'narrowed',
  nextStep:
    'That is the trace storage eviction leaves — the browser clears the site, and the next visit is indistinguishable from a stranger’s. It is equally what someone who stopped opening the app looks like, so read it alongside whether these readers came back at all.',
};

function metadataOf(loss: SessionLossRecord): Record<string, unknown> {
  return loss.metadata ?? {};
}

function observationOf(loss: SessionLossRecord): string {
  const outcome = metadataOf(loss).outcome;
  return typeof outcome === 'string' ? outcome : 'unknown';
}

/** The recorded facts, in the shape the shared reading expects. */
function evidenceOf(loss: SessionLossRecord): SessionEvidence {
  const metadata = metadataOf(loss);
  const policy = (metadata.configuredPolicy ?? {}) as { sameSite?: string };
  return {
    observation: observationOf(loss) as SessionObservation,
    secFetchSite: typeof metadata.secFetchSite === 'string' ? metadata.secFetchSite : null,
    configuredSameSite: typeof policy.sameSite === 'string' ? policy.sameSite : null,
    ageDays: typeof metadata.ageDays === 'number' ? metadata.ageDays : null,
    termDays: typeof metadata.termDays === 'number' ? metadata.termDays : null,
  };
}

function detailOf(loss: SessionLossRecord): string[] {
  const metadata = metadataOf(loss);
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

export function Sessions({ headerSlot }: { headerSlot: (meta: string) => void }) {
  const [data, setData] = useState<SessionDiagnosticsResponse | null>(null);
  const [windowChoice, setWindowChoice] = useState<Window>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = WINDOWS.find((option) => option.value === windowChoice)?.days ?? 7;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSessionDiagnostics(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session records.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const losses: SessionLossRecord[] = data?.losses ?? [];
  const quiet: QuietSessionRecord[] = data?.quiet ?? [];

  /**
   * The reading that accounts for most of the losses.
   *
   * Grouped by what the evidence says, not by the observation: two rows can
   * both be a missing cookie and mean different things, and rows that mean the
   * same thing belong together however they were observed.
   */
  const reading = useMemo(() => {
    const groups = new Map<string, { diagnosis: SessionDiagnosis; count: number }>();
    for (const loss of losses) {
      const diagnosis = diagnoseSession(evidenceOf(loss));
      // Keyed on `kind`, never on the sentence. Grouping on prose split every
      // loss into its own group the moment a statement mentioned a specific
      // day count, and the dominant cause was then whichever singleton won.
      const group = groups.get(diagnosis.kind);
      if (group) {
        group.count += 1;
      } else {
        groups.set(diagnosis.kind, { diagnosis, count: 1 });
      }
    }
    let top: { diagnosis: SessionDiagnosis; count: number } | null = null;
    for (const group of groups.values()) {
      if (!top || group.count > top.count) top = group;
    }
    return top;
  }, [losses]);

  useEffect(() => {
    if (loading) {
      headerSlot('');
      return;
    }
    const witnessed = `${losses.length} ${losses.length === 1 ? 'loss' : 'losses'}`;
    headerSlot(
      quiet.length > 0 ? `${witnessed} · ${quiet.length} quiet` : `${witnessed} · ${days} days`
    );
  }, [headerSlot, losses.length, quiet.length, days, loading]);

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

      {loading && !data ? <LoadingLine>Reading session records.</LoadingLine> : null}

      {!loading && !error ? (
        <div className="mt-3">
          {!shown ? (
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
                  ? `${reading.count} of ${losses.length} losses in the last ${days} days.`
                  : `${quiet.length} ${quiet.length === 1 ? 'session' : 'sessions'} went quiet in the last ${days} days, with no loss recorded.`}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <SectionLabel className="mb-3 mt-6">Recorded losses</SectionLabel>
      {!loading && losses.length === 0 ? (
        <p className="m-0 text-[15px] text-ink/[0.66]">None.</p>
      ) : (
        losses.map((loss) => (
          <div
            key={loss.id}
            className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-[11px] ${DIVIDER} last:border-b-0`}
          >
            <span className="tabular w-[104px] flex-none whitespace-nowrap text-[12px] text-ink/[0.52]">
              {formatDateTime(loss.timestamp)}
            </span>
            <StatusEnum status={observationOf(loss)} className="flex-none" />
            <span className="w-full text-[13px] text-ink/[0.6] lg:w-auto lg:flex-1">
              {detailOf(loss).join(' · ')}
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
              <span className="tabular w-[104px] flex-none whitespace-nowrap text-[12px] text-ink/[0.52]">
                {formatDateTime(session.lastSeenAt)}
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
