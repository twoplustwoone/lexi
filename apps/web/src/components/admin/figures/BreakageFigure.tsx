import { useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-react';

import { AdminEventStats, AdminLogEntry, AdminUser } from '../../../api';
import { deliveryRuns, totalDelivered } from '../deliveries';
import { WEEK_MS, displayName, formatDateTime, joinWords } from '../format';
import { AdminButton, Caption, Figure, SectionLabel, StatusEnum } from '../primitives';

/**
 * A raw event feed cannot say much at this scale. What the events can do is
 * operational: surface failures before the affected person mentions them. So
 * failures are listed in full and everything routine collapses to one counted
 * line.
 */

interface BreakageFigureProps {
  order?: string;
  logs: AdminLogEntry[];
  events: AdminEventStats | null;
  users: AdminUser[];
  onSendTest: (userId: string) => void;
  onAllEvents: () => void;
}

/** The raw status the row reports, pulled off the log's metadata where present. */
function statusOf(entry: AdminLogEntry): string {
  const status = entry.metadata?.status;
  if (typeof status === 'string') return status;
  if (typeof status === 'number') return String(status);
  if (entry.category === 'subscription') return 'expired';
  return entry.level === 'error' ? 'failed' : 'warning';
}

/** What this failure means for the person it happened to. */
function consequenceOf(entry: AdminLogEntry): string {
  if (entry.category === 'subscription') {
    return 'Push subscription is no longer valid. They will stop receiving the daily word.';
  }
  if (entry.category === 'push') {
    return 'The send did not reach them. Retried, then dropped.';
  }
  if (entry.category === 'vapid') {
    return 'Signing keys were rejected — sends will keep failing until this is fixed.';
  }
  if (entry.category === 'rate_limit') {
    return 'Throttled before it went out.';
  }
  return 'Held. Nothing was delivered for this run.';
}

export function BreakageFigure({
  order,
  logs,
  events,
  users,
  onSendTest,
  onAllEvents,
}: BreakageFigureProps) {
  const [showRoutine, setShowRoutine] = useState(false);

  const cutoff = Date.now() - WEEK_MS;
  const recent = logs.filter((entry) => {
    const time = new Date(entry.timestamp).getTime();
    return Number.isFinite(time) && time >= cutoff;
  });

  const failures = recent.filter((entry) => entry.level === 'error' || entry.level === 'warn');
  const routine = recent.filter((entry) => entry.level === 'info');

  const nameFor = (userId: string | null) => {
    if (!userId) return null;
    const user = users.find((candidate) => candidate.id === userId);
    return user ? displayName(user) : `${userId.slice(0, 8)}…`;
  };

  const affected = Array.from(
    new Set(
      failures
        .map((entry) => nameFor(entry.user_id))
        .filter((name): name is string => Boolean(name))
    )
  );

  const answer =
    failures.length === 0 ? (
      <>Nothing broke this week.</>
    ) : (
      <>
        {failures.length} {failures.length === 1 ? 'thing' : 'things'} failed this week
        {affected.length > 0 ? (
          <>
            , to <span className="text-accent-strong">{joinWords(affected)}</span>
          </>
        ) : null}
        . Nothing else.
      </>
    );

  const eventCounts = events?.eventCounts ?? {};
  // Deliveries come from each scheduler run's own tally; counting log rows
  // would report a run's bookkeeping records as sends.
  const delivered = totalDelivered(deliveryRuns(recent));
  const routineParts = [
    delivered > 0 ? `${delivered} notifications delivered` : null,
    eventCounts.auth_flow_completed
      ? `${eventCounts.auth_flow_completed} sign-ins completed`
      : null,
    eventCounts.word_viewed ? `${eventCounts.word_viewed} words opened` : null,
  ].filter((part): part is string => Boolean(part));

  const firstAffectedId = failures.find((entry) => entry.user_id)?.user_id ?? null;
  const firstAffectedName = nameFor(firstAffectedId);

  return (
    <Figure
      order={order}
      question="Did anything break?"
      answer={answer}
      support={
        failures.length === 0 ? (
          <>Everything in the last seven days completed.</>
        ) : (
          <>Everything else in the last seven days completed.</>
        )
      }
      actions={
        <>
          {firstAffectedId && firstAffectedName ? (
            <AdminButton variant="primary" onClick={() => onSendTest(firstAffectedId)}>
              Send {firstAffectedName} a test
            </AdminButton>
          ) : null}
          <AdminButton variant="ghost" onClick={onAllEvents}>
            All events
          </AdminButton>
        </>
      }
      last
      evidence={
        <>
          {failures.length > 0 ? (
            <>
              <div className="mb-0.5 flex items-baseline gap-3">
                <SectionLabel tone="warning">Needs attention</SectionLabel>
                <span className="h-px flex-1 bg-ink/[0.16]" />
              </div>
              {failures.map((entry) => (
                <div key={entry.id} className="flex gap-4 border-b border-ink/[0.16] py-3.5">
                  <span className="tabular w-[86px] flex-none text-[12px] leading-[1.6] text-ink/[0.52]">
                    {formatDateTime(entry.timestamp)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-[1.45]">
                      {entry.message}
                      {nameFor(entry.user_id) ? (
                        <>
                          {' '}
                          for{' '}
                          <span className="font-display text-[17px]">{nameFor(entry.user_id)}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-[1.5] text-ink/[0.68]">
                      {consequenceOf(entry)}
                    </div>
                  </div>
                  <StatusEnum status={statusOf(entry)} className="flex-none leading-[1.9]" />
                </div>
              ))}
            </>
          ) : null}

          <div className="mb-0.5 mt-6 flex items-baseline gap-3">
            <SectionLabel tone="muted">Routine, last 7 days</SectionLabel>
            <span className="h-px flex-1 bg-ink/[0.16]" />
          </div>
          <div className="flex items-center gap-4 border-b border-ink/[0.16] py-3.5">
            <div className="flex-1 text-[15px] leading-[1.5]">
              {routineParts.length > 0 ? routineParts.join(' · ') : 'Nothing recorded.'}
            </div>
            {routine.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowRoutine((previous) => !previous)}
                aria-expanded={showRoutine}
                className="flex flex-none cursor-pointer items-center gap-[7px] text-[13px] text-accent"
              >
                <span>{showRoutine ? 'Hide' : 'Show'}</span>
                <ChevronRight
                  size={14}
                  strokeWidth={1.4}
                  aria-hidden="true"
                  className={
                    showRoutine ? 'rotate-90 transition-transform' : 'transition-transform'
                  }
                />
              </button>
            ) : null}
          </div>

          {showRoutine
            ? routine.slice(0, 25).map((entry) => (
                <div
                  key={entry.id}
                  className="flex gap-4 border-b border-ink/[0.16] py-2.5 text-[13px]"
                >
                  <span className="tabular w-[86px] flex-none text-ink/[0.52]">
                    {formatDateTime(entry.timestamp)}
                  </span>
                  <span className="min-w-0 flex-1 text-ink/[0.68]">{entry.message}</span>
                </div>
              ))
            : null}

          <Caption className="pt-3">
            Routine events stay collapsed. They are counted, not listed.
          </Caption>
        </>
      }
    />
  );
}
