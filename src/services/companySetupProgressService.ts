import { apiUrl } from "../config/apiBase";

export type CompanySetupProgressResult = {
  ok: boolean;
  companyId: string;
  status: "LIVE" | "NEEDS_ATTENTION";
  currentStep: string;
  completedSteps: string[];
  failedStep: string;
  blockers: string[];
  message: string;
  technicalError: string;
  errorCode?: string;
  masterSheetId?: string;
  legacyFolderConfig?: Record<string, string>;
  folderIds?: Record<string, string>;
  registryStatus?: string;
  healthStatus?: string;
  setupWarnings?: string[];
  setupBlockers?: string[];
  validation?: {
    ok: boolean;
    missingTabs?: string[];
    folders?: Record<string, boolean>;
  } | null;
};

export type CompleteSetupResult = {
  ok: boolean;
  status: "LIVE" | "NEEDS_ATTENTION";
  companyId: string;
  companyName: string;
  failedStep: string;
  reason: string;
  userMessage: string;
  technicalError: string;
  completedSteps: string[];
  warnings: string[];
  reasonDetail?: string;
  masterSheetId?: string;
  legacyFolderConfig?: Record<string, string>;
  folderIds?: Record<string, string>;
  registryStatus?: string;
  validation?: CompanySetupProgressResult["validation"];
};

export const COMPANY_SETUP_DID_NOT_FINISH_MESSAGE = "Setup could not finish.";
export const COMPANY_SETUP_SUCCESS_MESSAGE = "Company is Live.";
export const COMPANY_SETUP_SUCCESS_DETAIL = "You can now invite users.";

export const COMPANY_SETUP_STEP_LABELS: Record<string, string> = {
  resolve_registry: "Resolve company registry record",
  ensure_company_folder: "Ensure company folder",
  ensure_folder_structure: "Ensure standard folder structure",
  ensure_master_sheet: "Ensure company master sheet",
  ensure_required_tabs: "Ensure required tabs",
  ensure_companyfolders_mapping: "Ensure CompanyFolders mapping",
  ensure_first_admin: "Ensure first admin",
  verify_workbook_read_write: "Verify workbook read/write",
  workspace_health_check: "Verify workbook read/write",
  mark_live: "Persist status LIVE if ready",
  request_timeout: "Setup request timed out",
  unknown: "Unknown step",
};

const SETUP_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

async function postCompleteSetup(
  workspaceId: string,
  body: { companyName?: string; masterSheetId?: string },
): Promise<CompleteSetupResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SETUP_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      apiUrl(`/api/godmode/companies/${encodeURIComponent(workspaceId)}/complete-setup`),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          companyId: workspaceId,
          companyFolderId: workspaceId,
          companyName: body.companyName || "",
          masterSheetId: body.masterSheetId || "",
        }),
      },
    );

    const payload = (await response.json()) as CompleteSetupResult & {
      error?: string;
      masterSheetId?: string;
      legacyFolderConfig?: Record<string, string>;
      registryStatus?: string;
      validation?: CompanySetupProgressResult["validation"];
    };

    if (!response.ok) {
      return {
        ok: false,
        companyId: payload.companyId || workspaceId,
        companyName: payload.companyName || body.companyName || "",
        status: payload.status || "NEEDS_ATTENTION",
        completedSteps: payload.completedSteps || [],
        failedStep: payload.failedStep || "",
        reason: payload.reason || "UNKNOWN",
        userMessage: payload.userMessage || COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
        technicalError: payload.technicalError || payload.error || "",
        warnings: payload.warnings || [],
        reasonDetail: payload.reasonDetail,
      };
    }

    return {
      ...payload,
      companyId: payload.companyId || workspaceId,
      companyName: payload.companyName || body.companyName || "",
      userMessage: payload.userMessage || (payload.ok ? COMPANY_SETUP_SUCCESS_MESSAGE : COMPANY_SETUP_DID_NOT_FINISH_MESSAGE),
      technicalError: payload.technicalError || "",
      warnings: payload.warnings || [],
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        companyId: workspaceId,
        companyName: body.companyName || "",
        status: "NEEDS_ATTENTION",
        completedSteps: [],
        failedStep: "request_timeout",
        reason: "GOOGLE_TIMEOUT",
        userMessage: COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
        technicalError: "Company setup request timed out.",
        warnings: [],
        reasonDetail: "A Google operation timed out. Try again in a moment.",
      };
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function postRepairSetup(
  companyId: string,
  body: { companyName?: string; masterSheetId?: string },
): Promise<CompanySetupProgressResult> {
  const result = await postCompleteSetup(companyId, body);
  return {
    ok: result.ok,
    companyId: result.companyId,
    status: result.status,
    currentStep: result.failedStep,
    completedSteps: result.completedSteps,
    failedStep: result.failedStep,
    blockers: [],
    message: result.userMessage,
    technicalError: result.technicalError,
    errorCode: result.reason,
    registryStatus: result.registryStatus,
    setupWarnings: result.warnings,
    masterSheetId: result.masterSheetId,
    legacyFolderConfig: result.legacyFolderConfig,
    folderIds: result.folderIds,
    validation: result.validation,
  };
}

export const companySetupProgressService = {
  async completeSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompleteSetupResult> {
    const companyId = String(input.companyId || "").trim();
    if (!companyId) {
      throw new Error("Company folder ID is required.");
    }
    return postCompleteSetup(companyId, input);
  },

  /** @deprecated Delegates to completeSetup — canonical path is complete-setup. */
  async repairSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    return postRepairSetup(input.companyId, input);
  },

  /** @deprecated Delegates to completeSetup. */
  async runSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    return companySetupProgressService.repairSetup(input);
  },
};
