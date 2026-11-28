import { WordDifficulty, WordPoolHealth } from '../../../api';
import { DIFFICULTY_ORDER, difficultyLabel, joinWords } from '../format';
import { AdminButton, Caption, Figure } from '../primitives';

/** The bars are capped so one enormous category cannot flatten the others. */
const SCALE_CAP = 60;

interface PoolHealthFigureProps {
  order?: string;
  health: WordPoolHealth | null;
  onReviewQueue: () => void;
  onBulkUpload: () => void;
  queueCount: number;
}

function days(count: number) {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

function readers(count: number) {
  return `${count} ${count === 1 ? 'reader' : 'readers'}`;
}

function answerFor(health: WordPoolHealth | null) {
  if (!health) {
    return { answer: <>Checking the pool.</>, support: undefined };
  }
  const advanced = health.byDifficulty.advanced;
  const minimum = health.minimumAdvancedReadyWords;
  const { warnBelow } = health.runway;
  const bands = DIFFICULTY_ORDER.flatMap((difficulty) => {
    const summary = health.runway.byDifficulty[difficulty];
    return summary?.fewestLeft == null
      ? []
      : [{ difficulty, atRisk: summary.atRisk, fewestLeft: summary.fewestLeft }];
  }).sort((a, b) => a.fewestLeft - b.fewestLeft);
  const closest = bands[0];

  if (closest && closest.atRisk > 0) {
    const band = difficultyLabel(closest.difficulty).toLowerCase();
    const alsoAtRisk = bands
      .slice(1)
      .filter((other) => other.atRisk > 0)
      .map(
        (other) => `${readers(other.atRisk)} on ${difficultyLabel(other.difficulty).toLowerCase()}`
      );
    return {
      answer:
        closest.fewestLeft === 0 ? (
          <>
            No — a reader has run out of new {band} words{' '}
            <span className="text-accent-strong">and is getting words from another band</span>.
          </>
        ) : closest.atRisk === 1 ? (
          <>
            No — a reader runs out of new {band} words{' '}
            <span className="text-accent-strong">in {days(closest.fewestLeft)}</span>.
          </>
        ) : (
          <>
            No — {closest.atRisk} readers run out of new {band} words within {days(warnBelow)},{' '}
            <span className="text-accent-strong">the first in {days(closest.fewestLeft)}</span>.
          </>
        ),
      support: (
        <>
          {closest.fewestLeft === 0 && closest.atRisk > 1
            ? `${readers(closest.atRisk)} on ${band} are under ${days(warnBelow)}. `
            : null}
          {alsoAtRisk.length > 0
            ? `Also under ${days(warnBelow)}: ${joinWords(alsoAtRisk)}. `
            : null}
          Add more {band} words to keep them from repeating or switching bands.
        </>
      ),
    };
  }

  if (!health.advancedHealthy) {
    const pending = advanced?.pending ?? 0;
    return {
      answer: (
        <>
          No — advanced is{' '}
          <span className="text-accent-strong">
            {advanced?.ready ?? 0} ready against a {minimum} minimum
          </span>
          .
        </>
      ),
      support:
        pending > 0 ? (
          <>
            {pending} more advanced {pending === 1 ? 'word is' : 'words are'} enriched but waiting
            on review, which would clear the gate.
          </>
        ) : (
          <>Nothing is waiting in review to close the gap — the pool needs more advanced words.</>
        ),
    };
  }

  return {
    answer: (
      <>
        Yes — advanced is {advanced?.ready ?? 0} ready, over its {minimum} minimum.
      </>
    ),
    support: closest ? (
      <>
        The closest reader has {days(closest.fewestLeft)} of new{' '}
        {difficultyLabel(closest.difficulty).toLowerCase()} words left.
      </>
    ) : (
      <>Every category is above the threshold the pool-health check gates on.</>
    ),
  };
}

function Bar({
  category,
  health,
  compact,
}: {
  category: WordDifficulty;
  health: WordPoolHealth;
  compact: boolean;
}) {
  const stats = health.byDifficulty[category];
  const ready = stats?.ready ?? 0;
  const minimum = health.minimumAdvancedReadyWords;
  // Only advanced is gated, but the tick reads as a common scale marker so it
  // sits on every bar.
  const belowMinimum = category === 'advanced' && !health.advancedHealthy;

  const fillPercent = Math.min(100, (ready / SCALE_CAP) * 100);
  const tickPercent = Math.min(100, (minimum / SCALE_CAP) * 100);

  const detail = [
    `${ready} ready`,
    stats?.pending ? `${stats.pending} pending` : null,
    stats?.failed ? `${stats.failed} failed` : null,
    stats?.notFound ? `${stats.notFound} missing` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className={compact ? 'text-[13px]' : 'text-[14px]'}>{difficultyLabel(category)}</span>
        <span
          className={`tabular ${compact ? 'text-[12px]' : 'text-[13px]'} ${
            belowMinimum ? 'text-accent-strong' : 'text-ink/[0.6]'
          }`}
        >
          {/* At phone width the pending and failed detail drops — the answer
              sentence is what has to survive. */}
          <span className="lg:hidden">{ready}</span>
          <span className="hidden lg:inline">{detail}</span>
        </span>
      </div>
      <div
        className={`relative ${compact ? 'h-2' : 'h-[9px]'} rounded-[2px] bg-ink/[0.09]`}
        role="img"
        aria-label={`${difficultyLabel(category)}: ${detail}. Minimum ${minimum}.`}
      >
        <div
          className={`h-full rounded-[2px] ${belowMinimum ? 'bg-accent-strong' : 'bg-accent'}`}
          style={{ width: `${fillPercent}%` }}
        />
        <div
          className={`absolute -top-[3px] -bottom-[3px] w-px ${
            fillPercent >= tickPercent ? 'bg-neutral-100/80' : 'bg-ink/[0.55]'
          }`}
          style={{ left: `${tickPercent}%` }}
        />
      </div>
    </div>
  );
}

export function PoolHealthFigure({
  order,
  health,
  onReviewQueue,
  onBulkUpload,
  queueCount,
}: PoolHealthFigureProps) {
  const { answer, support } = answerFor(health);

  const upcoming = health?.upcomingPreview?.advanced ?? [];
  const upcomingWords = upcoming.slice(0, 3).map((entry) => entry.word);

  return (
    <Figure
      order={order}
      question="Is the pool healthy?"
      answer={answer}
      support={support}
      actions={
        <>
          <AdminButton variant="primary" onClick={onReviewQueue} disabled={queueCount === 0}>
            {queueCount > 0 ? `Review ${queueCount} queued` : 'Nothing queued'}
          </AdminButton>
          <AdminButton variant="ghost" onClick={onBulkUpload}>
            Bulk upload JSON
          </AdminButton>
        </>
      }
      evidence={
        health ? (
          <div className="flex flex-col gap-[9px] lg:gap-3.5">
            {DIFFICULTY_ORDER.map((category) => (
              <Bar key={category} category={category} health={health} compact={false} />
            ))}
            <Caption className="mt-0.5">
              Bar is words ready to serve, scale capped at {SCALE_CAP}. The tick is the{' '}
              {health.minimumAdvancedReadyWords}-word minimum the pool-health check gates on.
            </Caption>
            {upcomingWords.length > 0 ? (
              <Caption>Next advanced up: {joinWords(upcomingWords)}.</Caption>
            ) : null}
          </div>
        ) : (
          <Caption>Pool health unavailable.</Caption>
        )
      }
    />
  );
}
