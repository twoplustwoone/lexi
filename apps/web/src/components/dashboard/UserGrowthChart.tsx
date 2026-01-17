import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface UserGrowthData {
  date: string;
  total: number;
  authenticated: number;
}

interface UserGrowthChartProps {
  data: UserGrowthData[];
  loading?: boolean;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function UserGrowthChart({ data, loading }: UserGrowthChartProps) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <div className="h-40 w-full animate-pulse rounded bg-[rgba(30,27,22,0.06)]" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4 text-sm text-muted">
        No user growth data available for this period.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink">User Growth</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b7355" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b7355" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="authGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#5a8f7b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#5a8f7b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,27,22,0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: '#8c8377', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(30,27,22,0.12)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8c8377', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255,252,247,0.98)',
              border: '1px solid rgba(30,27,22,0.12)',
              borderRadius: '12px',
              boxShadow: '0 8px 20px rgba(29,25,18,0.1)',
              fontSize: '12px',
            }}
            labelFormatter={formatDate}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#8b7355"
            strokeWidth={2}
            fill="url(#totalGradient)"
            name="Total Users"
          />
          <Area
            type="monotone"
            dataKey="authenticated"
            stroke="#5a8f7b"
            strokeWidth={2}
            fill="url(#authGradient)"
            name="Authenticated"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex justify-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#8b7355]" />
          <span className="text-muted">Total Users</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#5a8f7b]" />
          <span className="text-muted">Authenticated</span>
        </div>
      </div>
    </div>
  );
}
