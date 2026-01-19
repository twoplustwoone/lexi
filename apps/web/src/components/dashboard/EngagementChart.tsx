import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

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

  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: 'Delivered',
        data: data.map((d) => d.delivered),
        backgroundColor: '#8b7355',
        borderRadius: 4,
      },
      {
        label: 'Viewed',
        data: data.map((d) => d.viewed),
        backgroundColor: '#5a8f7b',
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: {
        display: false,
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
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#8c8377',
          font: { size: 11 },
        },
        border: {
          color: 'rgba(30, 27, 22, 0.12)',
        },
      },
      y: {
        grid: {
          color: 'rgba(30, 27, 22, 0.08)',
        },
        ticks: {
          color: '#8c8377',
          font: { size: 11 },
          stepSize: 1,
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <div className="rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink">Word Engagement</h3>
      <div style={{ height: 200 }}>
        <Bar data={chartData} options={options} />
      </div>
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
