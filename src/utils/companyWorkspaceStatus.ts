import { isArchiveOrNonLiveWorkspaceName, getCanonicalCompanyStatus, isCompanyRegistryLive } from "./companyWorkspaceInvite";

/** Simplified setup status for the Godmode primary UI. */
export type SimpleCompanySetupStatus = "Not set up" | "In progress" | "Live" | "Needs attention";

export function resolveSimpleCompanySetupStatus(status: CompanySetupStatusLabel): SimpleCompanySetupStatus {
  switch (status) {
    case "Live":
      return "Live";
    case "Setup in progress":
    case "Invited":
    case "Ready for health check":
      return "In progress";
    case "Needs attention":
    case "Failed":
      return "Needs attention";
    default:
      return "Not set up";
  }
}

export function simpleSetupStatusBadgeClass(status: SimpleCompanySetupStatus): string {
  switch (status) {
    case "Live":
      return "bg-emerald-100 text-emerald-800";
    case "In progress":
      return "bg-sky-100 text-sky-800";
    case "Needs attention":
      return "bg-amber-100 text-amber-900";
    case "Not set up":
    default:
      return "bg-slate-100 text-slate-600";
  }
}

/** Setup status shown on Godmode company workspace UI. */
export type CompanySetupStatusLabel =
  | "Not started"
  | "Invited"
  | "Setup in progress"
  | "Ready for health check"
  | "Needs attention"
  | "Live"
  | "Failed"
  | "Archived";

/** @deprecated Use CompanySetupStatusLabel — kept for gradual migration. */
export type CompanyWorkspaceStatusLabel = CompanySetupStatusLabel;

export function workspaceStatusBadgeClass(status: CompanySetupStatusLabel): string {
  switch (status) {
    case "Live":
      return "bg-emerald-100 text-emerald-800";
    case "Setup in progress":
      return "bg-sky-100 text-sky-800";
    case "Ready for health check":
      return "bg-indigo-100 text-indigo-800";
    case "Needs attention":
      return "bg-amber-100 text-amber-900";
    case "Invited":
      return "bg-violet-100 text-violet-800";
    case "Failed":
      return "bg-rose-100 text-rose-800";
    case "Archived":
      return "bg-slate-200 text-slate-700";
    case "Not started":
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export type CompanySetupNextAction = {
  label: string;
  detail?: string;
  primaryHandler: "run_setup" | "health_check" | "resync" | "repair_folders" | "repair_workspace" | "open_onboarding" | "none";
};

export function resolveCompanySetupStatus(input: {
  folderName: string;
  hasCompanyFolder: boolean;
  masterSheetId?: string;
  syncState?: string;
  isProvisioning?: boolean;
  setupFailed?: boolean;
  onboardingVerified?: boolean;
  responseSheetVerified?: boolean;
  workspaceHealthOk?: boolean;
  healthCheckRun?: boolean;
  registryStatus?: string;
}): CompanySetupStatusLabel {
  if (isArchiveOrNonLiveWorkspaceName(input.folderName)) {
    return "Archived";
  }
  if (input.setupFailed) {
    return "Failed";
  }

  const canonicalRegistry = getCanonicalCompanyStatus({
    status: input.registryStatus,
    registryStatus: input.registryStatus,
  });
  if (isCompanyRegistryLive({ status: canonicalRegistry, registryStatus: canonicalRegistry })) {
    return "Live";
  }
  if (input.isProvisioning) {
    return "Setup in progress";
  }
  if (canonicalRegistry === "Needs attention") {
    return "Needs attention";
  }

  const masterSheetId = String(input.masterSheetId || "").trim();
  const synced = input.syncState === "Synced" || input.syncState === "Linked";
  if (masterSheetId && input.hasCompanyFolder) {
    if (input.healthCheckRun && input.workspaceHealthOk === false) {
      return "Needs attention";
    }
    if (synced && !input.healthCheckRun) {
      return "Ready for health check";
    }
    return "Setup in progress";
  }
  if (input.hasCompanyFolder && !masterSheetId) {
    if (!input.onboardingVerified && !input.responseSheetVerified) {
      return "Invited";
    }
    return "Setup in progress";
  }
  return "Not started";
}

export function getCompanySetupNextAction(input: {
  status: CompanySetupStatusLabel;
  googleWorkspaceReady: boolean;
  masterSheetOk: boolean;
  folderStructureOk: boolean;
  healthCheckRun: boolean;
  workspaceHealthOk: boolean;
}): CompanySetupNextAction {
  if (!input.googleWorkspaceReady) {
    return {
      label: "Connect Google in Platform Setup",
      detail: "Drive linking requires a connected Google Workspace account.",
      primaryHandler: "none",
    };
  }
  switch (input.status) {
    case "Not started":
      return {
        label: "Send a company onboarding invite or select a provisioned company folder",
        primaryHandler: "open_onboarding",
      };
    case "Invited":
      return {
        label: "Wait for the customer to finish onboarding, or run setup after the folder appears",
        primaryHandler: "run_setup",
      };
    case "Setup in progress":
      if (!input.masterSheetOk) {
        return {
          label: "Run setup to link the master sheet and ISO folders",
          primaryHandler: "run_setup",
        };
      }
      if (!input.folderStructureOk) {
        return {
          label: "Repair folder structure, then run setup again",
          primaryHandler: "repair_folders",
        };
      }
      return {
        label: "Run setup to sync this company into the app",
        primaryHandler: "run_setup",
      };
    case "Ready for health check":
      return {
        label: "Run a workspace health check, then re-sync from the company sheet",
        primaryHandler: "health_check",
      };
    case "Needs attention":
      return {
        label: "Workspace is linked but needs attention — review health check results",
        detail: "Re-check workspace or repair folders without re-running full setup.",
        primaryHandler: "repair_workspace",
      };
    case "Live":
      return {
        label: "Company is live — invite field users from User management",
        detail:
          input.healthCheckRun && !input.workspaceHealthOk
            ? "Workspace health needs attention — re-check when convenient."
            : undefined,
        primaryHandler: "none",
      };
    case "Failed":
      return {
        label: "Repair folder structure or workspace setup, then re-run health check",
        primaryHandler: "repair_workspace",
      };
    case "Archived":
      return {
        label: "Archived workspace — select another company",
        primaryHandler: "none",
      };
    default:
      return { label: "Review setup checklist below", primaryHandler: "none" };
  }
}

export function resolveCompanyWorkspaceStatus(input: {
  folderName: string;
  masterSheetId?: string;
  isSelected?: boolean;
  syncState?: string;
  isProvisioning?: boolean;
  setupFailed?: boolean;
  onboardingVerified?: boolean;
  responseSheetVerified?: boolean;
  workspaceHealthOk?: boolean;
  healthCheckRun?: boolean;
  registryStatus?: string;
}): CompanySetupStatusLabel {
  return resolveCompanySetupStatus({
    folderName: input.folderName,
    hasCompanyFolder: true,
    masterSheetId: input.masterSheetId,
    syncState: input.isSelected ? input.syncState : undefined,
    isProvisioning: input.isProvisioning,
    setupFailed: input.setupFailed,
    onboardingVerified: input.onboardingVerified,
    responseSheetVerified: input.responseSheetVerified,
    workspaceHealthOk: input.workspaceHealthOk,
    healthCheckRun: input.healthCheckRun,
    registryStatus: input.registryStatus,
  });
}
