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

export const COMPANY_SETUP_DID_NOT_FINISH_MESSAGE =
  "Setup did not finish. Check the setup details below and try again.";

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

async function postRepairSetup(
  companyId: string,
  body: { companyName?: string; masterSheetId?: string },
): Promise<CompanySetupProgressResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SETUP_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      apiUrl(`/api/godmode/companies/${encodeURIComponent(companyId)}/repair-setup`),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          companyId,
          companyFolderId: companyId,
          companyName: body.companyName || "",
          masterSheetId: body.masterSheetId || "",
        }),
      },
    );

    const payload = (await response.json()) as CompanySetupProgressResult & { error?: string };
    if (!response.ok) {
      return {
        ok: false,
        companyId: payload.companyId || companyId,
        status: payload.status || "NEEDS_ATTENTION",
        currentStep: payload.currentStep || payload.failedStep || "",
        completedSteps: payload.completedSteps || [],
        failedStep: payload.failedStep || "",
        blockers: payload.blockers || [],
        message: payload.message || COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
        technicalError: payload.technicalError || payload.error || "",
        errorCode: payload.errorCode || "SETUP_STEP_FAILED",
        masterSheetId: payload.masterSheetId,
        legacyFolderConfig: payload.legacyFolderConfig,
        folderIds: payload.folderIds,
        registryStatus: payload.registryStatus,
        validation: payload.validation,
      };
    }
    return {
      ...payload,
      companyId: payload.companyId || companyId,
      message: payload.message || "",
      technicalError: payload.technicalError || "",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        companyId,
        status: "NEEDS_ATTENTION",
        currentStep: "",
        completedSteps: [],
        failedStep: "request_timeout",
        blockers: [],
        message: COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
        technicalError: "Company setup request timed out.",
        errorCode: "REQUEST_TIMEOUT",
      };
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const companySetupProgressService = {
  async repairSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    const companyId = String(input.companyId || "").trim();
    if (!companyId) {
      throw new Error("Company folder ID is required.");
    }
    return postRepairSetup(companyId, input);
  },

  /** @deprecated Delegates to repairSetup — canonical path is repair-setup. */
  async runSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    return companySetupProgressService.repairSetup(input);
  },
};
