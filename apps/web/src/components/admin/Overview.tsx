import {
  AdminEventStats,
  AdminLogEntry,
  AdminStats,
  AdminTimelineStats,
  AdminUser,
  WordPoolHealth,
} from '../../api';
import { AuthFigure } from './figures/AuthFigure';
import { BreakageFigure } from './figures/BreakageFigure';
import { GrowthFigure } from './figures/GrowthFigure';
import { PoolHealthFigure } from './figures/PoolHealthFigure';
import { ReadingFigure } from './figures/ReadingFigure';
import { AdminView } from './AdminNav';
import { ErrorLine, LoadingLine } from './primitives';

interface OverviewProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  stats: AdminStats | null;
  timeline: AdminTimelineStats | null;
  events: AdminEventStats | null;
  logs: AdminLogEntry[];
  users: AdminUser[];
  health: WordPoolHealth | null;
  queueCount: number;
  onNavigate: (view: AdminView) => void;
  onSendTest: (userId: string) => void;
}

/**
 * Five figures, in the order the phone needs them: pool, reading and sign-in
 * fit above the fold, growth sits below it, and breakage comes last.
 */
export function Overview({
  loading,
  error,
  onRetry,
  stats,
  timeline,
  events,
  logs,
  users,
  health,
  queueCount,
  onNavigate,
  onSendTest,
}: OverviewProps) {
  if (error) {
    return <ErrorLine message={error} onRetry={onRetry} />;
  }
  if (loading && !stats) {
    return <LoadingLine>Reading the last seven days.</LoadingLine>;
  }

  return (
    <div className="flex flex-col">
      <PoolHealthFigure
        order="order-1"
        health={health}
        queueCount={queueCount}
        onReviewQueue={() => onNavigate('review')}
        onBulkUpload={() => onNavigate('words')}
      />
      <ReadingFigure order="order-2" users={users} />
      {/* Sign-in comes third on the phone so it clears the fold; on desktop
          growth keeps its place ahead of it. */}
      <AuthFigure
        order="order-3 lg:order-4"
        methods={stats?.users.byAuthMethod ?? { password: 0, google: 0, emailCode: 0 }}
      />
      <GrowthFigure
        order="order-4 lg:order-3"
        points={timeline?.userGrowth ?? []}
        currentTotal={stats?.users.total ?? 0}
      />
      <BreakageFigure
        order="order-5"
        logs={logs}
        events={events}
        users={users}
        onSendTest={onSendTest}
        onAllEvents={() => onNavigate('notifications')}
      />
    </div>
  );
}
