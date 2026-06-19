import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ReportsChartPoint } from "../../types/reportsDashboard";

const palette = ["#94a3b8", "#f59e0b", "#f97316", "#e11d48"];

export function ReportPieChart({ title, data }: { title: string; data: ReportsChartPoint[] }) {
  const visible = data.filter((item) => item.value > 0);

  if (!visible.length) {
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
          <PieChart>
            <Pie data={visible} dataKey="value" nameKey="label" innerRadius={48} outerRadius={78} paddingAngle={2}>
              {visible.map((entry, index) => (
                <Cell key={entry.label} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
