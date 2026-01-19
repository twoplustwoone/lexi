import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

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

  const chartItems = [
    { name: LABELS.password, value: data.password, color: COLORS.password },
    { name: LABELS.google, value: data.google, color: COLORS.google },
    { name: LABELS.emailCode, value: data.emailCode, color: COLORS.emailCode },
  ].filter((item) => item.value > 0);

  const total = chartItems.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
        <h3 className="mb-4 text-sm font-semibold text-ink">Auth Methods</h3>
        <span className="text-sm text-muted">No authenticated users yet.</span>
      </div>
    );
  }

  const chartData = {
    labels: chartItems.map((item) => item.name),
    datasets: [
      {
        data: chartItems.map((item) => item.value),
        backgroundColor: chartItems.map((item) => item.color),
        borderColor: 'rgba(255, 252, 247, 0.8)',
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    cutout: '60%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#5c574f',
          font: { size: 12 },
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(255, 252, 247, 0.98)',
        titleColor: '#1e1b16',
        bodyColor: '#6f6457',
        borderColor: 'rgba(30, 27, 22, 0.12)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 12,
      },
    },
  };

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">Auth Methods</h3>
      <div style={{ height: 200 }}>
        <Doughnut data={chartData} options={options} />
      </div>
    </div>
  );
}
