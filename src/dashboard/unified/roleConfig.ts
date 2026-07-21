import type { Role } from "../../permissions";
import type { UnifiedDashboardRole } from "./types";

const ROLE_SUBTITLES: Record<UnifiedDashboardRole, string> = {
  Master: "Here is the current operational position across BERT companies.",
  Admin: "Here is what needs attention across the company today.",
  Manager: "Here is what needs attention across your sites and teams today.",
  Auditor: "Here are your assigned tasks and priorities for today.",
};

export function getRoleDashboardSubtitle(role: UnifiedDashboardRole): string {
  return ROLE_SUBTITLES[role] ?? ROLE_SUBTITLES.Auditor;
}

export type KpiMetricId =
  | "compliance-score"
  | "open-actions"
  | "overdue-actions"
  | "current-incidents"
  | "audits-completed"
  | "documents-awaiting"
  | "outstanding-briefings"
  | "equipment-due"
  | "today-due"
  | "today-outstanding"
  | "sync-queued";

const ROLE_KPI_ORDER: Record<UnifiedDashboardRole, KpiMetricId[]> = {
  Master: ["today-due", "open-actions", "overdue-actions", "current-incidents", "sync-queued"],
  Admin: [
    "compliance-score",
    "open-actions",
    "overdue-actions",
    "current-incidents",
    "audits-completed",
    "outstanding-briefings",
    "equipment-due",
  ],
  Manager: [
    "compliance-score",
    "open-actions",
    "overdue-actions",
    "current-incidents",
    "audits-completed",
    "outstanding-briefings",
    "equipment-due",
  ],
  Auditor: ["today-due", "today-outstanding", "open-actions", "outstanding-briefings", "sync-queued"],
};

export function getKpiOrderForRole(role: UnifiedDashboardRole): KpiMetricId[] {
  return ROLE_KPI_ORDER[role] ?? ROLE_KPI_ORDER.Auditor;
}

export function getRoleShortcuts(role: UnifiedDashboardRole): Array<{ label: string; description: string; screen: import("../../types/navigation").NavItemId }> {
  if (role === "Master") {
    return [
      { label: "Select company", description: "Open an existing company workspace.", screen: "godmodeHome" },
      { label: "Create company", description: "Provision a new company from scratch.", screen: "onboarding" },
      { label: "Platform setup", description: "Google, drive, and platform readiness.", screen: "setup" },
      { label: "Diagnostics", description: "Review platform health without a company.", screen: "reports" },
    ];
  }
  if (role === "Auditor") {
    return [
      { label: "My checks", description: "Open assigned audits and inspections.", screen: "audits" },
      { label: "My actions", description: "Continue corrective actions assigned to you.", screen: "actions" },
      { label: "Briefings", description: "Read and sign mandatory briefings.", screen: "briefings" },
      { label: "Sync uploads", description: "Retry queued offline submissions.", screen: "sync" },
    ];
  }
  if (role === "Manager") {
    return [
      { label: "Open actions", description: "Review overdue and open corrective actions.", screen: "actions" },
      { label: "Audit centre", description: "Start or review scheduled checks.", screen: "auditCentre" },
      { label: "Schedule", description: "See what is due across your sites.", screen: "schedules" },
      { label: "Reports", description: "Open operational reports.", screen: "reports" },
    ];
  }
  return [
    { label: "Invite people", description: "Add auditors and managers to the company.", screen: "users" },
    { label: "Schedules", description: "Plan checks across sites and teams.", screen: "schedules" },
    { label: "Documents", description: "Review controlled documents.", screen: "documents" },
    { label: "Company settings", description: "Open administration and workspace tools.", screen: "admin" },
  ];
}
