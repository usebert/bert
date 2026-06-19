import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportsChartPoint } from "../../types/reportsDashboard";

export function ReportBarChart({
  title,
  data,
  horizontal = false,
  color = "#0f172a",
}: {
  title: string;
  data: ReportsChartPoint[];
  horizontal?: boolean;
  color?: string;
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
          <BarChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 8, left: horizontal ? 24 : 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            {horizontal ? (
              <>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 11 }} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              </>
            )}
            <Tooltip />
            <Bar dataKey="value" fill={color} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
