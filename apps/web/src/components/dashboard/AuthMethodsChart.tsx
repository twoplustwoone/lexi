import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface AuthMethodsData {
  password: number;
  google: number;
  emailCode: number;
}

interface AuthMethodsChartProps {
  data: AuthMethodsData;
  loading?: boolean;
}

const COLORS = {
  password: '#8b7355',
  google: '#5a8f7b',
  emailCode: '#a67c52',
};

const LABELS = {
  password: 'Password',
  google: 'Google',
  emailCode: 'Email Code',
};

export function AuthMethodsChart({ data, loading }: AuthMethodsChartProps) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <div className="h-32 w-32 animate-pulse rounded-full bg-[rgba(30,27,22,0.06)]" />
      </div>
    );
  }

  const chartData = [
    { name: LABELS.password, value: data.password, color: COLORS.password },
    { name: LABELS.google, value: data.google, color: COLORS.google },
    { name: LABELS.emailCode, value: data.emailCode, color: COLORS.emailCode },
  ].filter((item) => item.value > 0);

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <h3 className="mb-4 text-sm font-semibold text-ink">Auth Methods</h3>
        <span className="text-sm text-muted">No authenticated users yet.</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">Auth Methods</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={75}
            paddingAngle={2}
            dataKey="value"
            stroke="rgba(255,252,247,0.8)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={1} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255,252,247,0.98)',
              border: '1px solid rgba(30,27,22,0.12)',
              borderRadius: '12px',
              boxShadow: '0 8px 20px rgba(29,25,18,0.1)',
              fontSize: '12px',
            }}
            formatter={(value) => [String(value ?? 0), 'Users']}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value: string) => (
              <span style={{ color: '#5c574f', fontSize: '12px' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
