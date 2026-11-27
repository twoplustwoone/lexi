/**
 * Opens every entry. Two variants: today takes an accent kicker, a 1px accent
 * rule filling to the right, and the day count; past is the kicker alone.
 */
export function DateRule({
  kicker,
  dayCount,
  variant = 'today',
}: {
  kicker: string;
  /** `Day 142` — the streak stated once, here, not decorating the reading. */
  dayCount?: number | null;
  variant?: 'today' | 'past';
}) {
  if (variant === 'past') {
    return (
      <div className="tabular text-[10px] uppercase tracking-[0.18em] text-ink/[0.5]">
        {kicker}
        {dayCount ? ` · Day ${dayCount}` : ''}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="tabular text-[10px] uppercase tracking-[0.18em] text-accent">{kicker}</span>
      <span className="h-px flex-1 bg-accent opacity-50" />
      {dayCount ? (
        <span className="tabular text-[10px] uppercase tracking-[0.14em] text-ink/[0.45]">
          Day {dayCount}
        </span>
      ) : null}
    </div>
  );
}
