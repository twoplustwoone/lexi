import { useEffect, useState } from 'preact/hooks';

import {
  AdminEventStats,
  AdminStats,
  AdminTimelineStats,
  fetchAdminEventStats,
  fetchAdminStats,
  fetchAdminTimelineStats,
  fetchMe,
  logout,
  resetAnonymousIdentity,
} from '../api';
import { AdminPanel } from '../components/AdminPanel';
import { Button } from '../components/Button';
import { AuthMethodsChart } from '../components/dashboard/AuthMethodsChart';
import { EngagementChart } from '../components/dashboard/EngagementChart';
import { EventsTimeline } from '../components/dashboard/EventsTimeline';
import { StatsCard } from '../components/dashboard/StatsCard';
import { UserGrowthChart } from '../components/dashboard/UserGrowthChart';

type Period = '7d' | '30d' | '90d';

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

type TabId = 'dashboard' | 'users' | 'notifications' | 'logs';

export function Admin({ user, onUserChange }: AdminProps) {
  const [period, setPeriod] = useState<Period>('7d');
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [timeline, setTimeline] = useState<AdminTimelineStats | null>(null);
  const [events, setEvents] = useState<AdminEventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = async () => {
    const me = await fetchMe();
    onUserChange({
      userId: me.user_id,
      isAuthenticated: me.is_authenticated,
      isAnonymous: me.is_anonymous,
      isAdmin: me.is_admin,
    });
    return me;
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignore logout failures
    }
    try {
      await resetAnonymousIdentity();
    } catch {
      // Ignore re-registration failures
    }
    await refreshUser();
  };

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, timelineData, eventsData] = await Promise.all([
        fetchAdminStats(),
        fetchAdminTimelineStats(period),
        fetchAdminEventStats(period),
      ]);
      setStats(statsData);
      setTimeline(timelineData);
      setEvents(eventsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [period]);

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  const tabButtonClass = (tab: TabId) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      activeTab === tab
        ? 'bg-white text-accent-strong shadow-[0_2px_8px_rgba(29,25,18,0.1)]'
        : 'text-muted hover:text-ink'
    }`;

  return (
    <section className="grid gap-5">
      {/* Header */}
      <div className={`${cardBase} p-6`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-[var(--font-display)] text-2xl">Admin Dashboard</h2>
            <p className="mt-1 text-sm text-muted">Monitor app usage and engagement metrics.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex rounded-lg border border-[rgba(30,27,22,0.1)] bg-surface p-1">
              {(['7d', '30d', '90d'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    period === p
                      ? 'bg-white text-accent-strong shadow-sm'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={loadStats} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className={`${cardBase} p-6`}>
          <p className="text-sm text-[#8f2d2d]">{error}</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={loadStats}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatsCard
              label="Total Users"
              value={stats?.users.total ?? '-'}
              icon="👥"
              loading={loading}
            />
            <StatsCard
              label="Authenticated"
              value={stats?.users.authenticated ?? '-'}
              icon="🔐"
              loading={loading}
            />
            <StatsCard
              label="View Rate"
              value={stats ? `${stats.engagement.viewRate}%` : '-'}
              icon="👁️"
              loading={loading}
            />
            <StatsCard
              label="Push Subs"
              value={stats?.notifications.pushSubscriptions ?? '-'}
              icon="🔔"
              loading={loading}
            />
          </div>

          {/* Charts */}
          <div className={`${cardBase} p-6`}>
            <UserGrowthChart data={timeline?.userGrowth ?? []} loading={loading} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className={cardBase}>
              <AuthMethodsChart
                data={stats?.users.byAuthMethod ?? { password: 0, google: 0, emailCode: 0 }}
                loading={loading}
              />
            </div>
            <div className={cardBase}>
              <EngagementChart data={timeline?.wordsDelivered ?? []} loading={loading} />
            </div>
          </div>

          {/* Events Timeline */}
          <div className={cardBase}>
            <EventsTimeline
              events={events?.recentEvents ?? []}
              eventCounts={events?.eventCounts ?? {}}
              clientBreakdown={events?.clientBreakdown ?? { web: 0, pwa: 0 }}
              loading={loading}
            />
          </div>
        </>
      )}

      {/* Tab navigation */}
      <div className={`${cardBase} p-4`}>
        <div className="flex flex-wrap gap-2 rounded-lg bg-surface p-1">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={tabButtonClass('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={tabButtonClass('users')}
          >
            Users
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={tabButtonClass('notifications')}
          >
            Notifications
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'users' || activeTab === 'notifications' ? (
        <div className={`${cardBase} p-6`}>
          <AdminPanel currentUserId={user.userId} />
        </div>
      ) : null}

      {/* Account section */}
      <div className={`${cardBase} p-6`}>
        <h3 className="text-lg font-semibold">Account</h3>
        <p className="mt-1 text-sm text-muted">Signed in as {user.userId}</p>
        <Button className="mt-3" variant="secondary" onClick={handleLogout}>
          Sign out
        </Button>
      </div>
    </section>
  );
}
