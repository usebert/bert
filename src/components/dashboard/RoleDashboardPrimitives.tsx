import type { ReactNode } from "react";
import type { Role } from "../../permissions";
import type { NavItemId } from "../../types/navigation";
import { getRoleTheme } from "../../config/roleTheme";

const QUICK_ACTION_ICONS: Record<string, ReactNode> = {
  invite: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  forms: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 19h16M7 16V10M12 16V6M17 16v-4" />
    </svg>
  ),
  tablet: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M12 17h.01" />
    </svg>
  ),
  setup: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  onboarding: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 19h16M6 16V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M4 19a5 5 0 0 1 10 0M14 19a4 4 0 0 1 6 0" />
    </svg>
  ),
  submit: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  ),
  checks: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m5 12 4 4 10-10" />
    </svg>
  ),
};

function quickActionIconKey(label: string): keyof typeof QUICK_ACTION_ICONS {
  const lower = label.toLowerCase();
  if (lower.includes("corrective") || lower.includes("capa") || lower.includes("action")) return "forms";
  if (lower.includes("invite")) return "invite";
  if (lower.includes("manage users") || lower.includes("users &")) return "users";
  if (lower.includes("forms") || lower.includes("checks")) return "forms";
  if (lower.includes("report")) return "reports";
  if (lower.includes("tablet") || lower.includes("kiosk")) return "tablet";
  if (lower.includes("platform setup") || lower.includes("setup")) return "setup";
  if (lower.includes("onboarding")) return "onboarding";
  if (lower.includes("team")) return "team";
  if (lower.includes("submit")) return "submit";
  if (lower.includes("history")) return "history";
  return "checks";
}

export function DashboardQuickActions({
  role,
  actions,
  layout = "grid",
}: {
  role: Role;
  actions: Array<{ label: string; screen: NavItemId; onClick: () => void }>;
  layout?: "grid" | "list";
}) {
  const theme = getRoleTheme(role);
  if (actions.length === 0) {
    return null;
  }

  if (layout === "list") {
    return (
      <section className={[theme.card, "p-4"].join(" ")}>
        <p className="text-sm font-semibold text-slate-900">Quick actions</p>
        <div className="mt-2 divide-y divide-slate-100">
          {actions.map((action) => (
            <button
              key={`${action.screen}-${action.label}`}
              type="button"
              onClick={action.onClick}
              className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-semibold text-slate-800 transition hover:text-slate-950"
            >
              <span>{action.label}</span>
              <span className="text-slate-400" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <p className="text-sm font-semibold text-slate-900">Quick actions</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {actions.map((action) => {
          const iconKey = quickActionIconKey(action.label);
          return (
            <button
              key={`${action.screen}-${action.label}`}
              type="button"
              onClick={action.onClick}
              className={[theme.quickActionCard, theme.quickActionCardHover].join(" ")}
            >
              <div className={theme.quickActionIconChip}>{QUICK_ACTION_ICONS[iconKey]}</div>
              <span className="text-sm font-semibold leading-snug text-slate-800">{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MetricTile({
  role,
  label,
  value,
  alertValue = false,
  linkLabel,
  onLinkClick,
  hint,
}: {
  role: Role;
  label: string;
  value: string;
  alertValue?: boolean;
  linkLabel?: string;
  onLinkClick?: () => void;
  hint?: string;
}) {
  const theme = getRoleTheme(role);
  return (
    <div className={theme.metricCard}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={["mt-2", alertValue ? theme.metricValueAlert : theme.metricValue].join(" ")}>{value}</p>
      {linkLabel && onLinkClick ? (
        <button type="button" onClick={onLinkClick} className={["mt-2", theme.metricLink].join(" ")}>
          {linkLabel}
        </button>
      ) : null}
      {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** @deprecated Use MetricTile — kept for gradual migration. */
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
  return (
    <MetricTile
      role={role}
      label={label}
      value={value}
      alertValue={ok === false}
      hint={
        ok === true ? hint ?? "OK" : ok === false ? hint ?? "Needs attention" : hint
      }
    />
  );
}

export function RoleDashboardShell({
  role,
  title,
  intro,
  children,
  subtitle,
}: {
  role: Role;
  eyebrow?: string;
  title: string;
  intro?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  void role;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[1.65rem]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        {intro ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{intro}</p> : null}
      </header>
      {children}
    </div>
  );
}

export function SystemHealthyStrip({ role, message = "All systems are operating normally." }: { role: Role; message?: string }) {
  const theme = getRoleTheme(role);
  return (
    <div className={["flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold", theme.healthyStrip].join(" ")}>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden>
        ✓
      </span>
      {message}
    </div>
  );
}

export function AuditorInfoStrip({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white" aria-hidden>
        i
      </span>
      <p>{message}</p>
    </div>
  );
}
