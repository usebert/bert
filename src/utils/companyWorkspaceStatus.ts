import { isArchiveOrNonLiveWorkspaceName, getCanonicalCompanyStatus, isCompanyRegistryLive } from "./companyWorkspaceInvite";
import {
  resolveCompanySetupDisplayStatus,
  resolveCompanySetupPhase,
  type CompanySetupDisplayStatus,
} from "./companySetupState";

/** Simplified setup status for the Godmode primary UI. */
export type SimpleCompanySetupStatus = CompanySetupDisplayStatus;

export function resolveSimpleCompanySetupStatus(input: {
  folderName: string;
  hasCompanyFolder: boolean;
  masterSheetId?: string;
  syncState?: string;
  isProvisioning?: boolean;
  setupFailed?: boolean;
  companyLive?: boolean;
  companyUsable?: boolean;
  backgroundWorkRunning?: boolean;
  healthCheckRunning?: boolean;
  workspaceHealthOk?: boolean;
  healthCheckRun?: boolean;
  registryStatus?: string;
}): SimpleCompanySetupStatus {
  const archived = isArchiveOrNonLiveWorkspaceName(input.folderName);
  const hasWorkbook = Boolean(String(input.masterSheetId || "").trim());
  const phase = resolveCompanySetupPhase({
    archived,
    setupFailed: input.setupFailed,
    companyUsable:
      input.companyUsable ??
      (Boolean(input.hasCompanyFolder && hasWorkbook) ||
        Boolean(input.companyLive) ||
        isCompanyRegistryLive({ status: input.registryStatus, registryStatus: input.registryStatus })),
    hasCompanyFolder: input.hasCompanyFolder,
    masterSheetId: input.masterSheetId,
    syncState: input.syncState,
    isProvisioning: input.isProvisioning,
    backgroundWorkRunning: input.backgroundWorkRunning,
    healthCheckRunning: input.healthCheckRunning,
    healthCheckRun: input.healthCheckRun,
    workspaceHealthOk: input.workspaceHealthOk,
  });
  return resolveCompanySetupDisplayStatus(phase);
}

export { simpleSetupStatusBadgeClass } from "./companySetupState";

/** Setup status shown on Godmode company workspace UI (internal detail labels). */
export type CompanySetupStatusLabel =
  | "Not started"
  | "Invited"
  | "Setup in progress"
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
  primaryHandler: "run_setup" | "resync" | "repair_folders" | "repair_workspace" | "open_onboarding" | "invite_users" | "none";
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
      return "Setup in progress";
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
  companyLive?: boolean;
  companyUsable?: boolean;
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
      if (input.companyUsable || input.companyLive) {
        return {
          label: "Invite users from User management",
          primaryHandler: "invite_users",
        };
      }
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
        label: "Make company usable",
        primaryHandler: "run_setup",
      };
    case "Needs attention":
      return {
        label: "Workspace is linked but needs attention — review advanced diagnostics",
        detail: "Health checks run in the background and do not block invites.",
        primaryHandler: "none",
      };
    case "Live":
      return {
        label: "Invite users from User management",
        primaryHandler: "invite_users",
      };
    case "Failed":
      return {
        label: "Could not finish setup — use advanced diagnostics to retry",
        primaryHandler: "none",
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
