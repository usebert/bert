import type { ReactNode } from "react";
import type { Role } from "../../permissions";
import type { NavItemId } from "../../types/navigation";
import { getRoleTheme } from "../../config/roleTheme";
import { AlertTriangleIcon } from "../icons/AlertTriangleIcon";
import { AnimatedButton } from "../animation/AnimatedButton";
import { AnimatedCount } from "../animation/AnimatedCount";

export type LandingCardIconTone = "orange" | "blue" | "grey" | "green";

const LANDING_ICON_TONE_CLASS: Record<LandingCardIconTone, string> = {
  orange: "bg-orange-500 text-white",
  blue: "bg-blue-500 text-white",
  grey: "bg-slate-400 text-white",
  green: "bg-emerald-500 text-white",
};

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export const DASHBOARD_CARD = "bert-light-surface rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";

const PRIMARY_BUTTON_BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 text-sm font-black shadow-lg disabled:cursor-not-allowed disabled:opacity-60";

const PRIMARY_BUTTON_CONTENT = "inline-flex items-center justify-center gap-2 whitespace-nowrap";

const SECONDARY_BUTTON_BASE =
  "inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50";

export function PrimaryButton({
  role,
  children,
  onClick,
  className = "",
  fullWidth = false,
}: {
  role: Role;
  children: ReactNode;
  onClick: () => void;
  className?: string;
  fullWidth?: boolean;
}) {
  const theme = getRoleTheme(role);
  return (
    <AnimatedButton
      type="button"
      onClick={onClick}
      className={[
        PRIMARY_BUTTON_BASE,
        theme.primaryButton,
        theme.primaryButtonHover,
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {children}
    </AnimatedButton>
  );
}

export function SecondaryButton({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <AnimatedButton type="button" onClick={onClick} className={[SECONDARY_BUTTON_BASE, className].join(" ")}>
      {children}
    </AnimatedButton>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "warning"
        ? "bg-amber-100 text-amber-900"
        : tone === "danger"
          ? "bg-rose-100 text-rose-900"
          : tone === "info"
            ? "bg-sky-100 text-sky-900"
            : "bg-slate-100 text-slate-700";
  return (
    <span className={["inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", toneClass].join(" ")}>
      {children}
    </span>
  );
}

export function PageHeader({
  role,
  eyebrow,
  title,
  subtitle,
  primaryAction,
}: {
  role: Role;
  eyebrow: string;
  title: string;
  subtitle?: string;
  primaryAction?: { label: string; onClick: () => void; icon?: "search" | "alert" | "invite" };
}) {
  const theme = getRoleTheme(role);
  const actionIcon =
    primaryAction?.icon === "search" ? (
      <SearchIcon className="h-4 w-4 shrink-0" />
    ) : primaryAction?.icon === "alert" ? (
      <AlertTriangleIcon className="h-4 w-4 shrink-0" />
    ) : primaryAction?.icon === "invite" ? (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    ) : null;
  return (
    <header className={[theme.pageHeaderShell, "p-7 text-white"].join(" ")}>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <p className={["text-xs font-black uppercase tracking-[0.2em]", theme.pageHeaderEyebrow].join(" ")}>{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight md:text-5xl">{title}</h1>
          {subtitle ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">{subtitle}</p> : null}
        </div>
        {primaryAction ? (
          <PrimaryButton role={role} onClick={primaryAction.onClick} className="shrink-0 md:min-w-[11rem]">
            <span className={PRIMARY_BUTTON_CONTENT}>
              {primaryAction.label}
              {actionIcon}
            </span>
          </PrimaryButton>
        ) : null}
      </div>
    </header>
  );
}

function LandingCardIcon({ tone }: { tone: LandingCardIconTone }) {
  const chip = ["mb-5 flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", LANDING_ICON_TONE_CLASS[tone]].join(" ");
  if (tone === "orange") {
    return (
      <span className={chip} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
        </svg>
      </span>
    );
  }
  if (tone === "blue") {
    return (
      <span className={chip} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    );
  }
  if (tone === "grey") {
    return (
      <span className={chip} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </span>
    );
  }
  return (
    <span className={chip} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19h16M7 16V10M12 16V6M17 16v-4" />
      </svg>
    </span>
  );
}

export function DashboardLandingCard({
  role,
  title,
  description,
  actionLabel,
  onAction,
  primary = false,
  iconTone,
}: {
  role: Role;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  primary?: boolean;
  iconTone?: LandingCardIconTone;
}) {
  return (
    <article className={[DASHBOARD_CARD, "flex h-full flex-col p-7"].join(" ")}>
      {iconTone ? <LandingCardIcon tone={iconTone} /> : null}
      <h3 className="text-xl font-black tracking-tight text-slate-900">{title}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{description}</p>
      {primary ? (
        <div className="mt-8">
          <PrimaryButton role={role} onClick={onAction} fullWidth>
            <span className={PRIMARY_BUTTON_CONTENT}>
              {actionLabel}
              <SearchIcon className="h-4 w-4 shrink-0" />
            </span>
          </PrimaryButton>
        </div>
      ) : (
        <div className="mt-8">
          <SecondaryButton onClick={onAction}>{actionLabel}</SecondaryButton>
        </div>
      )}
    </article>
  );
}

export function SetupChecklistRow({
  done,
  title,
  actionLabel,
  onAction,
  readyBadge,
}: {
  done: boolean;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  readyBadge?: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={[
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black",
            done ? "bg-emerald-500 text-white" : "border-2 border-slate-300 bg-white",
          ].join(" ")}
          aria-hidden
        >
          {done ? "✓" : ""}
        </span>
        <span className="font-bold text-slate-900">{title}</span>
      </div>
      {readyBadge ? (
        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">Ready</span>
      ) : actionLabel && onAction ? (
        <PrimaryButton role="Admin" onClick={onAction} className="w-full sm:w-auto sm:min-w-[8.5rem]">
          {actionLabel}
        </PrimaryButton>
      ) : null}
    </li>
  );
}

export function TodayMetricBlock({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "orange" | "blue" | "green";
}) {
  const bg = tone === "orange" ? "bg-orange-50" : tone === "blue" ? "bg-blue-50" : "bg-emerald-50";
  const text = tone === "orange" ? "text-orange-700" : tone === "blue" ? "text-blue-700" : "text-emerald-700";
  const numericValue = /^\d+$/.test(value) ? Number(value) : null;
  return (
    <div className={["rounded-3xl px-5 py-5", bg].join(" ")}>
      <p className="text-4xl font-black text-slate-900">
        {numericValue !== null ? <AnimatedCount value={numericValue} durationMs={600} /> : value}
      </p>
      <p className={["mt-1 text-sm font-black", text].join(" ")}>{label}</p>
    </div>
  );
}

export function ManagerSummaryCard({
  pill,
  pillTone,
  metric,
  description,
  actionLabel,
  onAction,
  primary = false,
}: {
  pill: string;
  pillTone: "danger" | "warning" | "success";
  metric: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  primary?: boolean;
}) {
  return (
    <article className={[DASHBOARD_CARD, "flex h-full flex-col"].join(" ")}>
      <StatusPill tone={pillTone === "danger" ? "danger" : pillTone === "warning" ? "warning" : "success"}>{pill}</StatusPill>
      <p className="mt-4 text-3xl font-black tracking-tight text-slate-900">{metric}</p>
      <p className="mt-2 flex-1 text-sm text-slate-600">{description}</p>
      <div className="mt-6">
        {primary ? (
          <PrimaryButton role="Manager" onClick={onAction} fullWidth>
            {actionLabel}
          </PrimaryButton>
        ) : (
          <SecondaryButton onClick={onAction}>{actionLabel}</SecondaryButton>
        )}
      </div>
    </article>
  );
}

export function OpenActionRow({
  title,
  area,
  statusLabel,
  statusTone,
  onOpen,
}: {
  title: string;
  area: string;
  statusLabel: string;
  statusTone: "danger" | "warning" | "neutral" | "info";
  onOpen: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 border-b border-slate-100 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-black text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm text-slate-500">{area}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
        <SecondaryButton onClick={onOpen} className="min-w-[5.5rem]">
          Open
        </SecondaryButton>
      </div>
    </li>
  );
}

export function TabletBottomNav({
  onChecks,
  onSubmit,
  onHistory,
}: {
  onChecks: () => void;
  onSubmit: () => void;
  onHistory: () => void;
}) {
  const items = [
    { label: "Checks", onClick: onChecks, icon: QUICK_ACTION_ICONS.checks },
    { label: "Submit", onClick: onSubmit, icon: QUICK_ACTION_ICONS.submit },
    { label: "History", onClick: onHistory, icon: QUICK_ACTION_ICONS.history },
  ];
  return (
    <nav className="grid grid-cols-3 gap-3" aria-label="Tablet navigation">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.onClick}
          className="flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:shadow-md"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">{item.icon}</span>
          <span className="text-sm font-black text-slate-900">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

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
  safety: <AlertTriangleIcon />,
};

function quickActionIconKey(label: string): keyof typeof QUICK_ACTION_ICONS {
  const lower = label.toLowerCase();
  if (
    lower.includes("quality & safety") ||
    lower.includes("quality and safety") ||
    lower.includes("incident") ||
    lower.includes("near miss") ||
    lower.includes("hazard") ||
    lower.includes("safety")
  ) {
    return "safety";
  }
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
  eyebrow,
  title,
  intro,
  children,
  subtitle,
  primaryAction,
}: {
  role: Role;
  eyebrow?: string;
  title: string;
  intro?: string;
  subtitle?: string;
  primaryAction?: { label: string; onClick: () => void; icon?: "search" | "alert" | "invite" };
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {eyebrow ? (
        <PageHeader role={role} eyebrow={eyebrow} title={title} subtitle={subtitle ?? intro} primaryAction={primaryAction} />
      ) : (
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[1.65rem]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          {intro ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{intro}</p> : null}
        </header>
      )}
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
