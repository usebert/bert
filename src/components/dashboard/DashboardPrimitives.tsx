import { DashboardAuditStatus, statusStyles } from "../../utils/dashboardHealth";
import { EmptyState } from "../ui/LoadingStates";

function DashboardAppIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "grid":
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="6.5" height="6.5" rx="1.25" />
          <rect x="14.5" y="3" width="6.5" height="6.5" rx="1.25" />
          <rect x="3" y="14.5" width="6.5" height="6.5" rx="1.25" />
          <rect x="14.5" y="14.5" width="6.5" height="6.5" rx="1.25" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...shared}>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "checklist":
      return (
        <svg {...shared}>
          <path d="M9 7h10" />
          <path d="M9 12h10" />
          <path d="M9 17h10" />
          <path d="m4 7 1.5 1.5L7.5 6" />
          <path d="m4 12 1.5 1.5L7.5 11" />
          <path d="m4 17 1.5 1.5L7.5 16" />
        </svg>
      );
    case "warningTriangle":
      return (
        <svg {...shared}>
          <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
          <path d="M12 9.5v4.5" />
          <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chart":
      return (
        <svg {...shared}>
          <path d="M4 19h16" />
          <path d="M7 16V10" />
          <path d="M12 16V6" />
          <path d="M17 16v-4" />
        </svg>
      );
    case "sync":
      return (
        <svg {...shared}>
          <path d="M3 12a8 8 0 0 1 13.66-5.66L19 8" />
          <path d="M21 12a8 8 0 0 1-13.66 5.66L5 16" />
          <path d="M19 3v5h-5" />
          <path d="M5 21v-5h5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...shared}>
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" />
          <path d="m9.5 12 1.8 1.8 3.2-3.6" />
        </svg>
      );
    case "user":
      return (
        <svg {...shared}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19a7 7 0 0 1 14 0" />
        </svg>
      );
    case "spark":
      return (
        <svg {...shared}>
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
    case "camera":
      return (
        <svg {...shared}>
          <path d="M4.5 8.5h3l1.5-2h6l1.5 2h3v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9Z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="m5 12 4 4 10-10" />
        </svg>
      );
    case "note":
      return (
        <svg {...shared}>
          <path d="M7 4h10a2 2 0 0 1 2 2v12l-4-3H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path d="M9 8h6" />
          <path d="M9 11h6" />
        </svg>
      );
    default:
      return null;
  }
}

export function SectionHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  tone = "onLight",
}: {
  icon: string;
  eyebrow?: string;
  title: string;
  subtitle: string;
  tone?: "onLight" | "onDark";
}) {
  const onDark = tone === "onDark";
  return (
    <div className="mb-4 flex items-start gap-3">
      <div
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
          onDark
            ? "bg-white/10 text-white"
            : "bg-slate-100 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
        ].join(" ")}
      >
        <DashboardAppIcon name={icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h3 className={["text-base font-semibold", onDark ? "text-[#F8FAFC]" : "text-slate-900"].join(" ")}>{title}</h3>
        <p className={["text-sm", onDark ? "text-slate-300" : "text-slate-600"].join(" ")}>{subtitle}</p>
      </div>
    </div>
  );
}

export function MetaPill({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
      <DashboardAppIcon name={icon} className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({ status, dark = false }: { status: DashboardAuditStatus; dark?: boolean }) {
  const base = statusStyles[status];
  return (
    <div className={["inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", dark ? "bg-white/10 text-white" : `${base.soft} ${base.text}`].join(" ")}>
      <span className={`h-2.5 w-2.5 rounded-full ${dark ? "bg-white" : base.dot}`} />
      {base.label}
    </div>
  );
}

export function KpiCard({
  title,
  value,
  subtitle,
  tone,
  dark = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: "green" | "amber" | "red";
  dark?: boolean;
}) {
  const toneClasses =
    tone === "green"
      ? dark
        ? "bg-blue-500/20 text-blue-200 ring-blue-400/30"
        : "bg-blue-500/12 text-blue-800 ring-blue-500/20"
      : tone === "red"
        ? dark
          ? "bg-rose-500/20 text-rose-200 ring-rose-400/30"
          : "bg-rose-500/12 text-rose-700 ring-rose-500/20"
        : dark
          ? "bg-amber-500/20 text-amber-200 ring-amber-400/30"
          : "bg-amber-500/12 text-amber-700 ring-amber-500/20";

  return (
    <div className={["rounded-[1.6rem] border p-4 shadow-[0_18px_35px_rgba(15,23,42,0.08)]", dark ? "border-sky-700/70 bg-slate-900" : "border-sky-200/80 bg-white"].join(" ")}>
      <div className="flex items-center justify-between gap-3">
        <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${toneClasses}`}>{title}</div>
        <div
          className={[
            "h-10 w-10 rounded-2xl",
            tone === "green" ? (dark ? "bg-blue-500/22" : "bg-blue-500/12") : tone === "red" ? (dark ? "bg-rose-500/22" : "bg-rose-500/12") : (dark ? "bg-amber-500/22" : "bg-amber-500/12"),
          ].join(" ")}
        />
      </div>
      <p className={["mt-4 text-3xl font-semibold tracking-tight", dark ? "text-slate-100" : "text-slate-900"].join(" ")}>{value}</p>
      <p className={["mt-1 text-sm leading-6", dark ? "text-slate-300" : "text-slate-500"].join(" ")}>{subtitle}</p>
    </div>
  );
}

export function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <EmptyState title={title} description={text} />;
}

export function StartHereCard() {
  const steps = [
    "Choose a workspace",
    "Run an audit",
    "Create actions",
    "Add evidence",
    "Verify and report",
  ];
  return (
    <section
      aria-label="Start here"
      className="rounded-2xl border border-sky-200/80 bg-sky-50/60 px-4 py-3 shadow-[0_6px_16px_rgba(15,23,42,0.04)]"
    >
      <p className="text-sm font-semibold text-slate-900">Start here</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">Set up the workspace and complete the first control loop.</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

export function AuditorStartHereCard() {
  const steps = [
    "Open Today",
    "Tap Start or Continue",
    "Add notes and evidence",
    "Submit",
  ];
  return (
    <section
      aria-label="Start today"
      className="rounded-2xl border border-violet-200/80 bg-violet-50/70 px-4 py-4 shadow-sm"
    >
      <p className="text-base font-semibold text-slate-900">Start today</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Complete assigned checks or submit a new record.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="font-medium text-violet-800">{index + 1}.</span> {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TrendBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "green" | "amber" | "red";
}) {
  const width = Math.max(8, Math.round((value / total) * 100));
  const toneClass =
    tone === "green" ? "bg-blue-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="rounded-[1.2rem] bg-slate-50 px-3 py-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <p className="font-semibold text-slate-900">{label}</p>
        <p className="text-slate-500">{value}</p>
      </div>
      <div className="h-3 rounded-full bg-white shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
        <div className={`h-3 rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function MiniMetric({
  label,
  value,
  icon,
  tone = "slate",
}: {
  label: string;
  value: string;
  icon?: string;
  tone?: "slate" | "red" | "amber" | "green" | "sky";
}) {
  const toneClasses: Record<NonNullable<typeof tone>, { shell: string; icon: string; label: string; value: string }> = {
    slate: {
      shell: "border-slate-200 bg-white",
      icon: "text-slate-600",
      label: "text-slate-500",
      value: "text-slate-900",
    },
    red: {
      shell: "border-rose-200 bg-white",
      icon: "text-rose-600",
      label: "text-rose-500",
      value: "text-rose-900",
    },
    amber: {
      shell: "border-amber-200 bg-white",
      icon: "text-amber-600",
      label: "text-amber-600",
      value: "text-amber-900",
    },
    green: {
      shell: "border-blue-200 bg-white",
      icon: "text-blue-700",
      label: "text-blue-700",
      value: "text-blue-950",
    },
    sky: {
      shell: "border-sky-200 bg-white",
      icon: "text-sky-600",
      label: "text-sky-600",
      value: "text-sky-900",
    },
  };
  const classes = toneClasses[tone];
  return (
    <div className={`rounded-[1.5rem] border p-3 ${classes.shell}`}>
      <div className="flex items-center gap-2">
        {icon ? (
          <span className={classes.icon}>
            <DashboardAppIcon name={icon} className="h-4 w-4" />
          </span>
        ) : null}
        <p className={`text-[11px] font-semibold leading-tight tracking-[0.08em] ${classes.label}`}>{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${classes.value}`}>{value}</p>
    </div>
  );
}

export function DashboardBertFlowStrip({ variant }: { variant: "onDark" | "onLight" }) {
  const shell =
    variant === "onDark"
      ? "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-snug text-slate-300"
      : "rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600";
  const lead = variant === "onDark" ? "font-semibold text-slate-100" : "font-semibold text-slate-800";
  return (
    <div className={`mt-3 ${shell}`}>
      <span className={lead}>How work flows in bert. </span>
      Provision → Evaluate → Action → Verify → Report — connect the workspace, run audits, close corrective actions with evidence, then export or share the record.
    </div>
  );
}
