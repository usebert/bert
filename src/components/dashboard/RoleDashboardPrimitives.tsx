import type { ReactNode } from "react";
import type { Role } from "../../permissions";
import type { NavItemId } from "../../types/navigation";
import { getRoleTheme } from "../../config/roleTheme";

export function DashboardQuickActions({
  role,
  actions,
}: {
  role: Role;
  actions: Array<{ label: string; screen: NavItemId; onClick: () => void }>;
}) {
  const theme = getRoleTheme(role);
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
            className={[
              "h-11 rounded-2xl border px-4 text-sm font-semibold transition",
              theme.quickAction,
              theme.quickActionHover,
            ].join(" ")}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function StatusTile({
  role,
  label,
  value,
  ok,
  hint,
}: {
  role: Role;
  label: string;
  value: string;
  ok?: boolean | null;
  hint?: string;
}) {
  const theme = getRoleTheme(role);
  return (
    <div className={["rounded-2xl border px-4 py-3", theme.statusTile].join(" ")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <span className={["inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold", theme.chip].join(" ")} aria-hidden>
          •
        </span>
      </div>
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
  role,
  eyebrow,
  title,
  intro,
  children,
}: {
  role: Role;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const theme = getRoleTheme(role);
  return (
    <div className="space-y-4">
      <section className={["rounded-[1.75rem] px-5 py-4", theme.dashboardShell].join(" ")}>
        <p className={["text-xs font-semibold uppercase tracking-[0.3em]", theme.dashboardEyebrow].join(" ")}>
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
        {intro ? <p className={["mt-2 text-sm leading-relaxed", theme.dashboardIntro].join(" ")}>{intro}</p> : null}
      </section>
      {children}
    </div>
  );
}
