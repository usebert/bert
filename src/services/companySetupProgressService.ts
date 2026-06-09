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

export type MakeUsableResult = {
  ok: boolean;
  status: "LIVE" | "NEEDS_ATTENTION";
  companyId: string;
  companyName: string;
  failedStep: string;
  reason: string;
  reasonCode?: string;
  userMessage: string;
  technicalError: string;
  warnings: string[];
  reasonDetail?: string;
  masterSheetId?: string;
  registryStatus?: string;
};

/** @deprecated Use MakeUsableResult */
export type CompleteSetupResult = MakeUsableResult & {
  completedSteps?: string[];
  legacyFolderConfig?: Record<string, string>;
  folderIds?: Record<string, string>;
  validation?: CompanySetupProgressResult["validation"];
};

export const COMPANY_SETUP_DID_NOT_FINISH_MESSAGE = "Could not make company usable.";
export const COMPANY_SETUP_SUCCESS_MESSAGE = "Company is ready. You can now invite users.";
export const COMPANY_SETUP_SUCCESS_DETAIL = "";

export const REGISTRY_WRITE_FAILED_MESSAGE =
  "BERT could not save this company as Live in the company registry.";
export const REGISTRY_VERIFY_FAILED_MESSAGE =
  "BERT saved setup data but could not verify the company is Live in the registry.";

export const MAKE_USABLE_REQUEST_TIMEOUT_MS = 35_000;

export const COMPANY_SETUP_STEP_LABELS: Record<string, string> = {
  ensure_registry: "Ensure company registry record",
  persist_live: "Persist status LIVE",
  ensure_users_tab: "Ensure Users tab",
  connect_google: "Connect Google Workspace",
  select_company: "Select company workspace",
  link_master_sheet: "Link master sheet",
  request_timeout: "Request timed out",
  make_usable: "Make company usable",
  unknown: "Unknown step",
};

const SETUP_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

async function postMakeUsable(
  workspaceId: string,
  body: { companyName?: string; masterSheetId?: string; companyFolderId?: string },
): Promise<MakeUsableResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), MAKE_USABLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      apiUrl(`/api/godmode/companies/${encodeURIComponent(workspaceId)}/make-usable`),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          companyId: workspaceId,
          companyFolderId: body.companyFolderId || workspaceId,
          companyName: body.companyName || "",
          masterSheetId: body.masterSheetId || "",
        }),
      },
    );

    const payload = (await response.json()) as MakeUsableResult & {
      error?: string;
      reasonCode?: string;
    };

    if (!response.ok) {
      const reasonCode = payload.reasonCode || payload.reason || "UNKNOWN";
      const userMessage =
        reasonCode === "REGISTRY_WRITE_FAILED"
          ? REGISTRY_WRITE_FAILED_MESSAGE
          : reasonCode === "REGISTRY_VERIFY_FAILED"
            ? REGISTRY_VERIFY_FAILED_MESSAGE
            : payload.userMessage || COMPANY_SETUP_DID_NOT_FINISH_MESSAGE;
      return {
        ok: false,
        companyId: payload.companyId || workspaceId,
        companyName: payload.companyName || body.companyName || "",
        status: payload.status || "NEEDS_ATTENTION",
        failedStep: payload.failedStep || "",
        reason: reasonCode,
        reasonCode,
        userMessage,
        technicalError: payload.technicalError || payload.error || "",
        warnings: payload.warnings || [],
        reasonDetail: payload.reasonDetail || userMessage,
        registryStatus: payload.registryStatus || "",
      };
    }

    return {
      ...payload,
      companyId: payload.companyId || workspaceId,
      companyName: payload.companyName || body.companyName || "",
      userMessage: payload.userMessage || COMPANY_SETUP_SUCCESS_MESSAGE,
      technicalError: payload.technicalError || "",
      warnings: payload.warnings || [],
      status: payload.status || "LIVE",
      registryStatus: payload.registryStatus || "Live",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        companyId: workspaceId,
        companyName: body.companyName || "",
        status: "NEEDS_ATTENTION",
        failedStep: "request_timeout",
        reason: "GOOGLE_TIMEOUT",
        reasonCode: "GOOGLE_TIMEOUT",
        userMessage: COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
        technicalError: "Make company usable request timed out.",
        warnings: [],
        reasonDetail: "The request timed out after 30 seconds. Try again in a moment.",
      };
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function postCompleteSetup(
  workspaceId: string,
  body: { companyName?: string; masterSheetId?: string },
): Promise<CompleteSetupResult> {
  const result = await postMakeUsable(workspaceId, body);
  return { ...result, completedSteps: result.ok ? ["ensure_registry", "persist_live"] : [] };
}

async function postRepairSetup(
  companyId: string,
  body: { companyName?: string; masterSheetId?: string },
): Promise<CompanySetupProgressResult> {
  const result = await postMakeUsable(companyId, body);
  return {
    ok: result.ok,
    companyId: result.companyId,
    status: result.status,
    currentStep: result.failedStep,
    completedSteps: result.ok ? ["ensure_registry", "persist_live"] : [],
    failedStep: result.failedStep,
    blockers: [],
    message: result.userMessage,
    technicalError: result.technicalError,
    errorCode: result.reason,
    registryStatus: result.registryStatus,
    setupWarnings: result.warnings,
    masterSheetId: result.masterSheetId,
  };
}

export const companySetupProgressService = {
  async makeUsable(input: {
    companyId: string;
    companyFolderId?: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<MakeUsableResult> {
    const companyId = String(input.companyId || "").trim();
    if (!companyId) {
      throw new Error("Company folder ID is required.");
    }
    return postMakeUsable(companyId, input);
  },

  /** @deprecated Use makeUsable — canonical path is make-usable. */
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

  /** @deprecated Delegates to makeUsable. */
  async repairSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    return postRepairSetup(input.companyId, input);
  },

  /** @deprecated Delegates to makeUsable. */
  async runSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    return companySetupProgressService.repairSetup(input);
  },
};
