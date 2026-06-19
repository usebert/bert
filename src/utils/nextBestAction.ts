import type { Role } from "../permissions";

export type DashboardSummaryForNextAction = {
  overdueAuditCount: number;
  overdueActionCount: number;
  escalatedActionCount: number;
  stuckActionCount: number;
  dueTodayAuditCount: number;
  dueTodayActionCount: number;
  awaitingVerificationCount: number;
  openOrInProgressActionCount: number;
  /** Auditor: actions assigned with missing required evidence */
  assignedEvidenceMissingCount: number;
  /** Any completed history to imply reporting value */
  recentCompletionCount: number;
};

export type NextBestActionIntent =
  | { type: "none" }
  | { type: "screen"; screen: "actions" | "audits" | "reports" | "sync"; actionFilter?: "Open" | "Overdue" | "Awaiting Verification" | "Closed" };

export type NextBestAction = {
  label: string;
  description?: string;
  intent: NextBestActionIntent;
};

function needsAttentionTotal(s: DashboardSummaryForNextAction) {
  return s.overdueAuditCount + s.overdueActionCount + s.escalatedActionCount + s.stuckActionCount;
}

function dueTodayTotal(s: DashboardSummaryForNextAction) {
  return s.dueTodayAuditCount + s.dueTodayActionCount;
}

/**
 * Priority: overdue / critical pressure → due today → awaiting verification (manager-style roles)
 * → assigned open work → reporting → all clear.
 */
export function getNextBestAction(role: Role, summary: DashboardSummaryForNextAction): NextBestAction {
  const attention = needsAttentionTotal(summary);
  const dueToday = dueTodayTotal(summary);
  const managerLike = role === "Manager" || role === "Admin" || role === "Master";

  if (role === "Auditor") {
    if (summary.overdueActionCount > 0 || summary.stuckActionCount > 0 || summary.escalatedActionCount > 0) {
      return {
        label: "Review overdue work",
        description: "Catch up on assigned actions that are behind or blocked.",
        intent: { type: "screen", screen: "actions", actionFilter: "Overdue" },
      };
    }
    if (summary.overdueAuditCount > 0) {
      return {
        label: "Review overdue work",
        description: "Catch up on audits that are behind.",
        intent: { type: "screen", screen: "audits" },
      };
    }
    if (dueToday > 0) {
      return {
        label: "Start today’s work",
        description: "Open audits or actions due in the next 24 hours.",
        intent: { type: "screen", screen: "audits" },
      };
    }
    if (summary.assignedEvidenceMissingCount > 0) {
      return {
        label: "Upload evidence",
        description: "Finish photo evidence on assigned actions before you sign off.",
        intent: { type: "screen", screen: "actions", actionFilter: "Open" },
      };
    }
    if (summary.openOrInProgressActionCount > 0) {
      return {
        label: "Continue assigned actions",
        description: "Move open items forward or submit them for review.",
        intent: { type: "screen", screen: "actions", actionFilter: "Open" },
      };
    }
    if (summary.awaitingVerificationCount > 0) {
      return {
        label: "Track items in review",
        description: "Some of your work is waiting on a manager.",
        intent: { type: "screen", screen: "actions", actionFilter: "Awaiting Verification" },
      };
    }
    return {
      label: "All clear for now",
      description: "No urgent audits or actions — check back after the next assignment.",
      intent: { type: "none" },
    };
  }

  if (attention > 0) {
    return {
      label: "Review overdue work",
      description: "Overdue audits, overdue actions, or escalations need a decision.",
      intent: { type: "screen", screen: "actions", actionFilter: "Overdue" },
    };
  }
  if (dueToday > 0) {
    return {
      label: "Start today’s work",
      description: "Audits or actions are due within twenty-four hours.",
      intent: { type: "screen", screen: "audits" },
    };
  }
  if (managerLike && summary.awaitingVerificationCount > 0) {
    return {
      label: "Review evidence",
      description: `${summary.awaitingVerificationCount} item${summary.awaitingVerificationCount === 1 ? "" : "s"} waiting on verification.`,
      intent: { type: "screen", screen: "actions", actionFilter: "Awaiting Verification" },
    };
  }
  if (summary.openOrInProgressActionCount > 0) {
    return {
      label: "Continue open work",
      description: "Keep assigned actions moving while the window is open.",
      intent: { type: "screen", screen: "actions", actionFilter: "Open" },
    };
  }
  if (summary.recentCompletionCount > 0) {
    return {
      label: "View completed work",
      description: "Recent completions are ready for assurance and reporting.",
      intent: { type: "screen", screen: "reports" },
    };
  }
  return {
    label: "All clear",
    description: "Nothing urgent in the queue — spot-check schedules or reporting when you have time.",
    intent: { type: "none" },
  };
}
