import { apiUrl } from "../config/apiBase";

export type CompanySetupProgressResult = {
  ok: boolean;
  status: "LIVE" | "NEEDS_ATTENTION";
  currentStep: string;
  completedSteps: string[];
  failedStep: string;
  blockers: string[];
  errorCode: string;
  message: string;
  masterSheetId?: string;
  legacyFolderConfig?: Record<string, string>;
  folderIds?: Record<string, string>;
  registryStatus?: string;
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
  workspace_health_check: "Run workspace health check",
  mark_live: "Mark company LIVE if ready",
  request_timeout: "Setup request timed out",
  unknown: "Unknown step",
};

const SETUP_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const companySetupProgressService = {
  async runSetup(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<CompanySetupProgressResult> {
    const companyId = String(input.companyId || "").trim();
    if (!companyId) {
      throw new Error("Company folder ID is required.");
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SETUP_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl("/api/godmode/company-workspace/run-setup"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          companyId,
          companyFolderId: companyId,
          companyName: input.companyName || "",
          masterSheetId: input.masterSheetId || "",
        }),
      });

      const payload = (await response.json()) as CompanySetupProgressResult & { error?: string };
      if (!response.ok) {
        return {
          ok: false,
          status: payload.status || "NEEDS_ATTENTION",
          currentStep: payload.currentStep || payload.failedStep || "",
          completedSteps: payload.completedSteps || [],
          failedStep: payload.failedStep || "",
          blockers: payload.blockers || [],
          errorCode: payload.errorCode || "SETUP_STEP_FAILED",
          message: payload.message || payload.error || COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
          masterSheetId: payload.masterSheetId,
          legacyFolderConfig: payload.legacyFolderConfig,
          folderIds: payload.folderIds,
          registryStatus: payload.registryStatus,
        };
      }
      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          ok: false,
          status: "NEEDS_ATTENTION",
          currentStep: "",
          completedSteps: [],
          failedStep: "request_timeout",
          blockers: [],
          errorCode: "REQUEST_TIMEOUT",
          message: "Company setup request timed out. Check the setup details below and try again.",
        };
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
};
