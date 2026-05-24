import type { ReactNode } from "react";
import type { NavItemId } from "../../types/navigation";

export function DashboardQuickActions({
  actions,
}: {
  actions: Array<{ label: string; screen: NavItemId; onClick: () => void }>;
}) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Quick actions</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={`${action.screen}-${action.label}`}
            type="button"
            onClick={action.onClick}
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800 transition hover:border-orange-300 hover:bg-orange-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function StatusTile({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {ok === true ? (
        <p className="mt-1 text-xs font-medium text-emerald-700">OK</p>
      ) : ok === false ? (
        <p className="mt-1 text-xs font-medium text-amber-800">Needs attention</p>
      ) : null}
      {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function RoleDashboardShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] bg-slate-950 px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
        {intro ? <p className="mt-2 text-sm leading-relaxed text-slate-300">{intro}</p> : null}
      </section>
      {children}
    </div>
  );
}
