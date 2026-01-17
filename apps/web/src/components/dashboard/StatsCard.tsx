interface StatsCardProps {
  label: string;
  value: string | number;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: string;
  loading?: boolean;
}

export function StatsCard({ label, value, trend, icon, loading }: StatsCardProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.8)] p-4">
        <div className="h-4 w-20 animate-pulse rounded bg-[rgba(30,27,22,0.08)]" />
        <div className="h-8 w-16 animate-pulse rounded bg-[rgba(30,27,22,0.08)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.8)] p-4 transition-shadow hover:shadow-[0_8px_20px_rgba(29,25,18,0.08)]">
      <div className="flex items-center gap-2">
        {icon ? <span className="text-lg">{icon}</span> : null}
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-ink">{value}</span>
        {trend ? (
          <span
            className={`flex items-center text-sm font-medium ${trend.isPositive ? 'text-[#2d6a4f]' : 'text-[#9d4343]'}`}
          >
            {trend.isPositive ? '+' : ''}
            {trend.value}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
