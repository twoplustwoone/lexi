interface RecentEvent {
  event_name: string;
  timestamp: string;
  user_id: string;
  client: string;
}

interface EventsTimelineProps {
  events: RecentEvent[];
  eventCounts: Record<string, number>;
  clientBreakdown: { web: number; pwa: number };
  loading?: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  app_open: 'App Open',
  word_delivered: 'Word Delivered',
  word_viewed: 'Word Viewed',
  account_created: 'Account Created',
  auth_method_used: 'Sign In',
  notification_disabled: 'Notification Disabled',
  app_installed: 'App Installed',
};

const EVENT_ICONS: Record<string, string> = {
  app_open: '📱',
  word_delivered: '📬',
  word_viewed: '👁️',
  account_created: '👤',
  auth_method_used: '🔑',
  notification_disabled: '🔕',
  app_installed: '📥',
};

function formatEventName(name: string): string {
  return EVENT_LABELS[name] || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function EventsTimeline({
  events,
  eventCounts,
  clientBreakdown,
  loading,
}: EventsTimelineProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <div className="mb-4 h-5 w-32 animate-pulse rounded bg-[rgba(30,27,22,0.08)]" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[rgba(30,27,22,0.04)]" />
          ))}
        </div>
      </div>
    );
  }

  const sortedCounts = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink">Event Analytics</h3>

      {/* Client breakdown */}
      <div className="mb-4 flex gap-4">
        <div className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs">
          <span className="font-medium text-muted">Web:</span>
          <span className="font-semibold text-ink">{clientBreakdown.web}</span>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs">
          <span className="font-medium text-muted">PWA:</span>
          <span className="font-semibold text-ink">{clientBreakdown.pwa}</span>
        </div>
      </div>

      {/* Event counts summary */}
      {sortedCounts.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {sortedCounts.map(([name, count]) => (
            <div
              key={name}
              className="flex items-center gap-1.5 rounded-full border border-[rgba(30,27,22,0.08)] bg-white px-2.5 py-1 text-xs"
            >
              <span>{EVENT_ICONS[name] || '📊'}</span>
              <span className="text-muted">{formatEventName(name)}:</span>
              <span className="font-semibold text-ink">{count}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Recent events timeline */}
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Recent Events
      </h4>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No recent events.</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {events.slice(0, 15).map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className="flex items-center justify-between rounded-lg border border-[rgba(30,27,22,0.05)] bg-white px-3 py-2 text-xs transition-colors hover:bg-surface"
            >
              <div className="flex items-center gap-2">
                <span>{EVENT_ICONS[event.event_name] || '📊'}</span>
                <span className="font-medium text-ink">{formatEventName(event.event_name)}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                    event.client === 'pwa'
                      ? 'bg-[#5a8f7b]/10 text-[#5a8f7b]'
                      : 'bg-[#8b7355]/10 text-[#8b7355]'
                  }`}
                >
                  {event.client}
                </span>
              </div>
              <div className="flex items-center gap-3 text-muted">
                <span className="truncate max-w-[80px]" title={event.user_id}>
                  {event.user_id.slice(0, 8)}...
                </span>
                <span className="whitespace-nowrap">{formatEventTime(event.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
