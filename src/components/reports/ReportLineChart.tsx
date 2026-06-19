import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportsChartPoint, ReportsPassFailPoint } from "../../types/reportsDashboard";

type LineSeries = ReportsChartPoint | ReportsPassFailPoint;

function isPassFailSeries(data: LineSeries[]): data is ReportsPassFailPoint[] {
  return data.length > 0 && "pass" in data[0];
}

export function ReportLineChart({
  title,
  data,
  dualSeries = false,
}: {
  title: string;
  data: LineSeries[];
  dualSeries?: boolean;
}) {
  if (!data.length) {
    return (
      <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-6 text-center text-sm text-slate-500">No data for this chart yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-slate-900">{title}</p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {dualSeries && isPassFailSeries(data) ? (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pass" stroke="#2563eb" strokeWidth={2} dot={false} name="Pass" />
              <Line type="monotone" dataKey="fail" stroke="#e11d48" strokeWidth={2} dot={false} name="Fail" />
            </LineChart>
          ) : (
            <LineChart data={data as ReportsChartPoint[]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
