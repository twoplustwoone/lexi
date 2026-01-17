import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface EngagementData {
  date: string;
  delivered: number;
  viewed: number;
}

interface EngagementChartProps {
  data: EngagementData[];
  loading?: boolean;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function EngagementChart({ data, loading }: EngagementChartProps) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <div className="h-40 w-full animate-pulse rounded bg-[rgba(30,27,22,0.06)]" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <h3 className="mb-4 text-sm font-semibold text-ink">Word Engagement</h3>
        <span className="text-sm text-muted">No engagement data for this period.</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink">Word Engagement</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
          <Bar dataKey="delivered" fill="#8b7355" radius={[4, 4, 0, 0]} name="Delivered" />
          <Bar dataKey="viewed" fill="#5a8f7b" radius={[4, 4, 0, 0]} name="Viewed" />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex justify-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-[#8b7355]" />
          <span className="text-muted">Delivered</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-[#5a8f7b]" />
          <span className="text-muted">Viewed</span>
        </div>
      </div>
    </div>
  );
}
