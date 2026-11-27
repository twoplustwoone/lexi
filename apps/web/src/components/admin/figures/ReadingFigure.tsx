import { AdminUser } from '../../../api';
import { formatShortDate, readThisWeek } from '../format';
import { Caption, Figure } from '../primitives';

/**
 * One mark per person, so the ratio is countable rather than inferred. Gold
 * for opened this week, ink 12% for not.
 */
export function ReadingFigure({ users, order }: { users: AdminUser[]; order?: string }) {
  const total = users.length;
  const readers = users.filter((user) => readThisWeek(user));
  const dormant = users.filter((user) => !readThisWeek(user));

  const lastDormantRead = dormant
    .map((user) => user.lastReadAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  const answer =
    total === 0 ? (
      <>Nobody has signed up yet.</>
    ) : (
      <>
        {readers.length} of your {total} {total === 1 ? 'person' : 'people'} opened a word this
        week.
      </>
    );

  const support =
    dormant.length === 0 ? undefined : (
      <>
        {dormant.length} {dormant.length === 1 ? 'has' : 'have'} not opened the app
        {lastDormantRead ? <> since {formatShortDate(lastDormantRead)}</> : <> at all</>}.
      </>
    );

  return (
    <Figure
      order={order}
      question="Are people still reading?"
      answer={answer}
      support={support}
      evidence={
        total === 0 ? (
          <Caption>No people to chart yet.</Caption>
        ) : (
          <>
            <div
              className="grid gap-[5px] lg:gap-[7px]"
              style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
              role="img"
              aria-label={`${readers.length} of ${total} people opened a word this week`}
            >
              {users.map((user) => (
                <div
                  key={user.id}
                  className={`h-[38px] rounded-[2px] lg:h-[52px] ${
                    readThisWeek(user) ? 'bg-accent' : 'bg-ink/[0.12]'
                  }`}
                />
              ))}
            </div>
            <div className="mt-[7px] flex justify-between lg:mt-[9px]">
              <Caption>One mark per person · gold opened this week</Caption>
              <Caption className="tabular">
                {readers.length} / {total}
              </Caption>
            </div>
          </>
        )
      }
    />
  );
}
