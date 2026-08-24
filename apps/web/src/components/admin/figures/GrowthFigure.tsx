import { AdminTimelineStats } from '../../../api';
import { formatShortDate } from '../format';
import { Caption, Figure } from '../primitives';

type GrowthPoint = AdminTimelineStats['userGrowth'][number];

const VIEW_WIDTH = 470;
const VIEW_HEIGHT = 92;

/** The single largest day-on-day jump — the one inflection worth annotating. */
function findInflection(points: GrowthPoint[]) {
  let best: { index: number; delta: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index].total - points[index - 1].total;
    if (delta > 0 && (!best || delta > best.delta)) {
      best = { index, delta };
    }
  }
  return best;
}

/** Up to five evenly spaced month labels across the range. */
function monthLabels(points: GrowthPoint[]): string[] {
  const seen: string[] = [];
  for (const point of points) {
    const date = new Date(point.date);
    if (Number.isNaN(date.getTime())) continue;
    const label = date.toLocaleDateString(undefined, { month: 'short' });
    if (seen[seen.length - 1] !== label) {
      seen.push(label);
    }
  }
  if (seen.length <= 5) return seen;
  const step = (seen.length - 1) / 4;
  return Array.from({ length: 5 }, (_, index) => seen[Math.round(index * step)]);
}

export function GrowthFigure({ points, order }: { points: GrowthPoint[]; order?: string }) {
  const usable = points.filter((point) => Number.isFinite(point.total));
  const latest = usable[usable.length - 1]?.total ?? 0;
  const earliest = usable[0]?.total ?? 0;
  const joined = latest - earliest;

  const max = Math.max(1, ...usable.map((point) => point.total));
  const inflection = findInflection(usable);

  // Percentages rather than SVG coordinates, so the annotation and the end dot
  // stay round and unskewed when the chart stretches to its container.
  const coordinates = usable.map((point, index) => ({
    x: usable.length > 1 ? (index / (usable.length - 1)) * 100 : 0,
    y: 100 - (point.total / max) * 88,
  }));

  const polyline = coordinates
    .map(({ x, y }) => `${(x / 100) * VIEW_WIDTH},${(y / 100) * VIEW_HEIGHT}`)
    .join(' ');

  const labels = monthLabels(usable);

  const answer =
    latest === 0 ? (
      <>Nobody has joined yet.</>
    ) : (
      <>
        {latest} {latest === 1 ? 'person' : 'people'}
        {joined > 0 ? (
          <>
            , {joined} joined {joined === 1 ? 'in' : 'across'} this period
          </>
        ) : null}
        .
      </>
    );

  return (
    <Figure
      order={order}
      question="Is the circle growing?"
      answer={answer}
      support={
        inflection ? (
          <>
            The jump on {formatShortDate(usable[inflection.index].date)} added {inflection.delta}{' '}
            {inflection.delta === 1 ? 'person' : 'people'} at once.
          </>
        ) : (
          <>Flat across the period.</>
        )
      }
      evidence={
        usable.length < 2 ? (
          <Caption>Not enough history to chart yet.</Caption>
        ) : (
          <>
            <div className="relative h-[92px]">
              <svg
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="none"
                className="block h-full w-full"
                role="img"
                aria-label={`Growth to ${latest} people`}
              >
                <line
                  x1="0"
                  y1={VIEW_HEIGHT - 1}
                  x2={VIEW_WIDTH}
                  y2={VIEW_HEIGHT - 1}
                  stroke="currentColor"
                  className="text-ink/[0.16]"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={polyline}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {inflection ? (
                <>
                  <span
                    className="absolute -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-accent"
                    style={{
                      left: `${coordinates[inflection.index].x}%`,
                      top: `${coordinates[inflection.index].y}%`,
                    }}
                  />
                  <span
                    className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-ink/[0.55]"
                    style={{
                      left: `${Math.min(88, Math.max(12, coordinates[inflection.index].x))}%`,
                      top: `${Math.max(0, coordinates[inflection.index].y - 20)}%`,
                    }}
                  >
                    {formatShortDate(usable[inflection.index].date)} · +{inflection.delta}
                  </span>
                </>
              ) : null}

              <span
                className="absolute -ml-[3.5px] -mt-[3.5px] h-[7px] w-[7px] rounded-full bg-accent"
                style={{
                  left: `${coordinates[coordinates.length - 1].x}%`,
                  top: `${coordinates[coordinates.length - 1].y}%`,
                }}
              />
            </div>

            <div className="tabular mt-1.5 flex justify-between text-[12px] text-ink/[0.55]">
              {labels.map((label, index) => (
                <span key={`${label}-${index}`}>
                  {index === labels.length - 1 ? `${label} · ${latest}` : label}
                </span>
              ))}
            </div>
          </>
        )
      }
    />
  );
}
