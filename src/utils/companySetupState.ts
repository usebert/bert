/**
 * Company setup phase → plain status labels and next actions (frontend).
 * Keep in sync with shared/company-setup-state.mjs.
 */

export const COMPANY_SETUP_PHASE = {
  SETUP_REQUIRED: "SETUP_REQUIRED",
  SETUP_RUNNING: "SETUP_RUNNING",
  LIVE: "LIVE",
  HEALTH_CHECK_READY: "HEALTH_CHECK_READY",
  HEALTH_CHECK_RUNNING: "HEALTH_CHECK_RUNNING",
  HEALTH_CHECK_FAILED_LIVE: "HEALTH_CHECK_FAILED_LIVE",
  SETUP_FAILED: "SETUP_FAILED",
  ARCHIVED: "ARCHIVED",
} as const;

export type CompanySetupPhase = (typeof COMPANY_SETUP_PHASE)[keyof typeof COMPANY_SETUP_PHASE];

export type CompanySetupDisplayStatus =
  | "Not set up"
  | "Working in the background"
  | "Ready"
  | "Needs attention";

export type CompanySetupPrimaryActionKind =
  | "make_usable"
  | "invite_users"
  | "open_dashboard"
  | "none";

export const COMPANY_SETUP_FAILED_MESSAGE = "Could not finish setup";

function isSynced(syncState?: string): boolean {
  const value = String(syncState || "").trim();
  return value === "Synced" || value === "Linked";
}

export function resolveCompanySetupPhase(input: {
  archived?: boolean;
  setupFailed?: boolean;
  companyLive?: boolean;
  hasCompanyFolder?: boolean;
  masterSheetId?: string;
  syncState?: string;
  isProvisioning?: boolean;
  backgroundWorkRunning?: boolean;
  healthCheckRunning?: boolean;
  healthCheckRun?: boolean;
  workspaceHealthOk?: boolean;
}): CompanySetupPhase {
  if (input.archived) {
    return COMPANY_SETUP_PHASE.ARCHIVED;
  }
  if (input.setupFailed) {
    return COMPANY_SETUP_PHASE.SETUP_FAILED;
  }

  const companyLive = Boolean(input.companyLive);
  const healthCheckRun = Boolean(input.healthCheckRun);
  const workspaceHealthOk = input.workspaceHealthOk !== false;

  if (companyLive) {
    if (healthCheckRun && !workspaceHealthOk) {
      return COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE;
    }
    return COMPANY_SETUP_PHASE.LIVE;
  }

  if (input.healthCheckRunning) {
    return COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING;
  }
  if (input.isProvisioning || input.backgroundWorkRunning) {
    return COMPANY_SETUP_PHASE.SETUP_RUNNING;
  }

  const hasCompanyFolder = Boolean(input.hasCompanyFolder);
  const masterSheetId = String(input.masterSheetId || "").trim();
  const synced = isSynced(input.syncState);

  if (hasCompanyFolder && masterSheetId && synced && !healthCheckRun) {
    return COMPANY_SETUP_PHASE.HEALTH_CHECK_READY;
  }

  if (!hasCompanyFolder || !masterSheetId) {
    return COMPANY_SETUP_PHASE.SETUP_REQUIRED;
  }

  return COMPANY_SETUP_PHASE.SETUP_REQUIRED;
}

export function resolveCompanySetupDisplayStatus(phase: CompanySetupPhase): CompanySetupDisplayStatus {
  switch (phase) {
    case COMPANY_SETUP_PHASE.LIVE:
      return "Ready";
    case COMPANY_SETUP_PHASE.SETUP_RUNNING:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_READY:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING:
      return "Working in the background";
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE:
    case COMPANY_SETUP_PHASE.SETUP_FAILED:
    case COMPANY_SETUP_PHASE.ARCHIVED:
      return "Needs attention";
    case COMPANY_SETUP_PHASE.SETUP_REQUIRED:
    default:
      return "Not set up";
  }
}

export function resolveCompanySetupPrimaryAction(phase: CompanySetupPhase): {
  label: string;
  detail?: string;
  action: CompanySetupPrimaryActionKind;
} {
  switch (phase) {
    case COMPANY_SETUP_PHASE.SETUP_REQUIRED:
      return { label: "Make company usable", action: "make_usable" };
    case COMPANY_SETUP_PHASE.LIVE:
      return { label: "Invite users", action: "invite_users" };
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE:
      return {
        label: "",
        detail: "Review advanced diagnostics when convenient.",
        action: "none",
      };
    case COMPANY_SETUP_PHASE.SETUP_FAILED:
      return {
        label: COMPANY_SETUP_FAILED_MESSAGE,
        detail: "Use advanced diagnostics to retry or repair.",
        action: "none",
      };
    case COMPANY_SETUP_PHASE.SETUP_RUNNING:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_READY:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING:
      return {
        label: "",
        detail: "Working in the background",
        action: "none",
      };
    default:
      return { label: "Make company usable", action: "make_usable" };
  }
}

export function shouldAutoQueueHealthCheck(phase: CompanySetupPhase): boolean {
  return phase === COMPANY_SETUP_PHASE.HEALTH_CHECK_READY;
}

export function simpleSetupStatusBadgeClass(status: CompanySetupDisplayStatus): string {
  switch (status) {
    case "Ready":
      return "bg-emerald-100 text-emerald-800";
    case "Working in the background":
      return "bg-sky-100 text-sky-800";
    case "Needs attention":
      return "bg-amber-100 text-amber-900";
    case "Not set up":
    default:
      return "bg-slate-100 text-slate-600";
  }
}
