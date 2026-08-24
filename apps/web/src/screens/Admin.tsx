import { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';

import {
  AdminEventStats,
  AdminLogEntry,
  AdminStats,
  AdminTimelineStats,
  AdminUser,
  DailyWordPayload,
  WordPoolHealth,
  WordReviewQueueItem,
  fetchAdminEventStats,
  fetchAdminLogs,
  fetchAdminStats,
  fetchAdminTimelineStats,
  fetchAdminUsers,
  fetchTodayWord,
  fetchWordPoolHealth,
  fetchWordReviewQueue,
} from '../api';
import { AdminRail, AdminSidebar, AdminView } from '../components/admin/AdminNav';
import { Notifications } from '../components/admin/Notifications';
import { Overview } from '../components/admin/Overview';
import { People } from '../components/admin/People';
import { Review } from '../components/admin/Review';
import { Words } from '../components/admin/Words';
import { AdminButton, ScreenHeader, Segmented } from '../components/admin/primitives';

type Period = '7d' | '30d' | '90d';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: 'All' },
];

interface AdminProps {
  path?: string;
  user: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  };
  onOpenAuth?: () => void;
  onUserChange: (next: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  }) => void;
}

export function Admin({ user }: AdminProps) {
  const [view, setView] = useState<AdminView>('overview');
  const [period, setPeriod] = useState<Period>('7d');

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [timeline, setTimeline] = useState<AdminTimelineStats | null>(null);
  const [events, setEvents] = useState<AdminEventStats | null>(null);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [health, setHealth] = useState<WordPoolHealth | null>(null);
  const [queue, setQueue] = useState<WordReviewQueueItem[]>([]);
  const [today, setToday] = useState<DailyWordPayload | null>(null);
  const [lastSweep, setLastSweep] = useState<{
    scanned: number;
    approved: number;
    flagged: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wordsMeta, setWordsMeta] = useState('');
  const [testRecipients, setTestRecipients] = useState<string[]>([]);

  const loadUsers = useCallback(async () => {
    const collected: AdminUser[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const response = await fetchAdminUsers(cursor ?? undefined, 200);
      collected.push(...response.users);
      cursor = response.nextCursor;
      pages += 1;
      if (!response.users.length) break;
    } while (cursor && pages < 100);
    setUsers(collected);
  }, []);

  const loadQueue = useCallback(async () => {
    const response = await fetchWordReviewQueue({ reviewStatus: 'pending_review', limit: 20 });
    setQueue(response.words);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, timelineData, eventsData, logsData, healthData] = await Promise.all([
        fetchAdminStats(),
        fetchAdminTimelineStats(period),
        fetchAdminEventStats(period),
        fetchAdminLogs({ limit: 200 }),
        fetchWordPoolHealth(),
      ]);
      setStats(statsData);
      setTimeline(timelineData);
      setEvents(eventsData);
      setLogs(logsData.logs);
      setHealth(healthData);
      await Promise.all([loadUsers(), loadQueue()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [period, loadUsers, loadQueue]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Only the notification composer needs today's word, and only to prefill.
  useEffect(() => {
    if (view !== 'notifications' || today) return;
    void fetchTodayWord()
      .then(setToday)
      .catch(() => undefined);
  }, [view, today]);

  const handleBackToApp = () => route('/');

  const handleSendTest = (userId: string) => {
    setTestRecipients([userId]);
    setView('notifications');
  };

  const handleQueueChanged = () => {
    void loadQueue();
    void fetchWordPoolHealth()
      .then(setHealth)
      .catch(() => undefined);
  };

  const headerFor = (): { title: string; meta?: string; actions?: ComponentChildren } => {
    switch (view) {
      case 'overview':
        return {
          title: 'Overview',
          meta: new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }),
          actions: (
            <Segmented
              label="Period"
              options={PERIODS}
              value={period}
              onChange={(next) => setPeriod(next)}
            />
          ),
        };
      case 'review':
        return {
          title: 'Review',
          meta:
            queue.length > 0
              ? `${queue.length} ${queue.length === 1 ? 'word' : 'words'} · flagged by the quality gate`
              : 'Queue clear',
          actions:
            queue.length > 0 ? (
              <AdminButton variant="ghost" onClick={() => setView('overview')}>
                Skip all, review later
              </AdminButton>
            ) : undefined,
        };
      case 'words':
        return { title: 'Words', meta: wordsMeta };
      case 'notifications':
        return { title: 'Notifications' };
      case 'people': {
        const admins = users.filter((candidate) => candidate.isAdmin).length;
        return { title: 'People', meta: `${users.length} · ${admins} admins` };
      }
    }
  };

  const header = headerFor();

  return (
    <div className="flex min-h-screen bg-bg font-body text-ink">
      <AdminSidebar
        active={view}
        onNavigate={setView}
        queueCount={queue.length}
        onBackToApp={handleBackToApp}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminRail
          active={view}
          onNavigate={setView}
          queueCount={queue.length}
          onBackToApp={handleBackToApp}
        />

        <ScreenHeader title={header.title} meta={header.meta} actions={header.actions} />

        {/* The nav switches this region — nothing renders above it. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[22px] pb-8 md:px-[34px]">
          {view === 'overview' ? (
            <Overview
              loading={loading}
              error={error}
              onRetry={loadAll}
              stats={stats}
              timeline={timeline}
              events={events}
              logs={logs}
              users={users}
              health={health}
              queueCount={queue.length}
              onNavigate={setView}
              onSendTest={handleSendTest}
            />
          ) : null}

          {view === 'review' ? (
            <Review
              queue={queue}
              loading={loading}
              error={error}
              lastSweep={lastSweep}
              onSweepComplete={setLastSweep}
              onQueueChanged={handleQueueChanged}
              onLeave={() => setView('overview')}
            />
          ) : null}

          {view === 'words' ? <Words headerSlot={setWordsMeta} /> : null}

          {view === 'notifications' ? (
            <Notifications
              users={users}
              logs={logs}
              loading={loading}
              today={today}
              initialRecipients={testRecipients}
            />
          ) : null}

          {view === 'people' ? (
            <People
              users={users}
              loading={loading}
              error={error}
              currentUserId={user.userId}
              onChanged={loadUsers}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
