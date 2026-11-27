import { AdminStats } from '../../../api';
import { Caption, Figure } from '../primitives';

type AuthMethods = AdminStats['users']['byAuthMethod'];

/**
 * One stacked bar, 11 people. Labels sit beneath in a legend, never inside the
 * fill — small text on an accent fill fails contrast.
 */
export function AuthFigure({ methods, order }: { methods: AuthMethods; order?: string }) {
  const segments = [
    { key: 'google', label: 'Google', count: methods.google, fill: 'bg-accent' },
    { key: 'emailCode', label: 'Magic link', count: methods.emailCode, fill: 'bg-accent/[0.34]' },
    { key: 'password', label: 'Password', count: methods.password, fill: 'bg-ink/[0.1]' },
  ];

  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const leader = [...segments].sort((a, b) => b.count - a.count)[0];
  const share = total > 0 ? leader.count / total : 0;

  const shareWord =
    share >= 0.66 ? 'Two thirds' : share >= 0.5 ? 'More than half' : 'The largest share';

  const unused = segments.filter((segment) => segment.count === 0);

  const answer =
    total === 0 ? (
      <>Nobody has signed in yet.</>
    ) : (
      <>
        {shareWord} use {leader.label}.
        {unused.length > 0 ? <> Nobody uses {unused[0].label.toLowerCase()}.</> : null}
      </>
    );

  return (
    <Figure
      question="How do people get in?"
      answer={answer}
      support={
        unused.some((segment) => segment.key === 'password') ? (
          <>Worth considering whether password sign-in still needs to exist.</>
        ) : undefined
      }
      order={order}
      evidence={
        total === 0 ? (
          <Caption>No sign-ins to chart yet.</Caption>
        ) : (
          <>
            <div
              className="flex h-[28px] overflow-hidden rounded-[2px] border border-ink/[0.16] lg:h-[34px]"
              role="img"
              aria-label={segments.map((segment) => `${segment.label} ${segment.count}`).join(', ')}
            >
              {segments.map((segment) =>
                segment.count > 0 ? (
                  <div
                    key={segment.key}
                    className={segment.fill}
                    style={{ width: `${(segment.count / total) * 100}%` }}
                  />
                ) : null
              )}
            </div>

            <div className="mt-[9px] flex flex-wrap gap-x-[14px] gap-y-2 lg:mt-[11px] lg:gap-x-[18px]">
              {segments.map((segment) => (
                <span
                  key={segment.key}
                  className={`tabular flex items-center gap-1.5 text-[12px] lg:text-[13px] ${
                    segment.count === 0 ? 'text-ink/[0.62]' : ''
                  }`}
                >
                  <span
                    className={`h-[11px] w-[11px] flex-none rounded-[2px] ${segment.fill}`}
                    aria-hidden="true"
                  />
                  {segment.label} {segment.count}
                </span>
              ))}
            </div>

            <Caption className="mt-2.5">
              One bar, {total} {total === 1 ? 'person' : 'people'}.
            </Caption>
          </>
        )
      }
    />
  );
}
