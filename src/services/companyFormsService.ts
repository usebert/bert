import { apiUrl } from "../config/apiBase";

export type CompanyGoogleForm = {
  formId: string;
  driveFileId: string;
  name: string;
  webViewLink: string;
  createdTime: string;
  modifiedTime: string;
  owners: string[];
  folderId: string;
  folderPath?: string;
  companyId: string;
  companyFolderId: string;
  googleFormsFolderId: string;
};

export type CompanyGoogleFormsDiagnostics = {
  companyFolderId: string;
  googleFormsFolderId: string;
  driveQuery: string;
  formsFound: number;
  permissionError?: string;
  resolvedVia?: string;
};

export type CompanyGoogleFormsStatus =
  | "idle"
  | "loading"
  | "found"
  | "empty"
  | "folder_not_found"
  | "permission_denied"
  | "error";

export type CompanyGoogleFormsResponse = {
  ok?: boolean;
  status?: string;
  error?: string;
  forms?: CompanyGoogleForm[];
  formsFound?: number;
  googleFormsFolder?: { id: string; name: string } | null;
  diagnostics?: CompanyGoogleFormsDiagnostics;
  permissionError?: string;
};

type JsonResponse = Record<string, unknown> & CompanyGoogleFormsResponse;

async function parseResponse<T extends JsonResponse>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok && payload.ok !== true) {
    throw new Error(String(payload.error || "Company Google Forms request failed."));
  }
  return payload;
}

export const companyFormsService = {
  async listCompanyGoogleForms(
    companyFolderId: string,
    options?: { masterSheetId?: string; sync?: boolean; createIfMissing?: boolean },
  ) {
    const params = new URLSearchParams();
    if (options?.masterSheetId) {
      params.set("masterSheetId", options.masterSheetId);
    }
    if (options?.sync) {
      params.set("sync", "1");
    }
    if (options?.createIfMissing) {
      params.set("createIfMissing", "1");
    }
    const query = params.toString();
    const url = apiUrl(
      `/api/company/${encodeURIComponent(companyFolderId)}/google-forms${query ? `?${query}` : ""}`,
    );
    return parseResponse<CompanyGoogleFormsResponse>(await fetch(url, { credentials: "include" }));
  },
};

export function companyGoogleFormsStatusFromInspection(
  inspection: {
    googleFormsStatus?: string;
    googleFormsPermissionError?: string;
    googleFormsFolder?: { id: string; name: string } | null;
    companyGoogleForms?: CompanyGoogleForm[];
    auditForms?: { id: string; name: string }[];
  } | null,
): CompanyGoogleFormsStatus {
  if (!inspection) {
    return "idle";
  }
  if (inspection.googleFormsStatus === "permission_denied" || inspection.googleFormsPermissionError) {
    return "permission_denied";
  }
  if (inspection.googleFormsStatus === "folder_not_found") {
    return "folder_not_found";
  }
  const forms = inspection.companyGoogleForms?.length
    ? inspection.companyGoogleForms
    : (inspection.auditForms || []).map((form) => ({
        formId: form.id,
        driveFileId: form.id,
        name: form.name,
        webViewLink: "",
        createdTime: "",
        modifiedTime: "",
        owners: [],
        folderId: inspection.googleFormsFolder?.id || "",
        companyId: "",
        companyFolderId: "",
        googleFormsFolderId: inspection.googleFormsFolder?.id || "",
      }));
  if (inspection.googleFormsFolder?.id && forms.length === 0) {
    return "empty";
  }
  if (forms.length > 0) {
    return "found";
  }
  if (!inspection.googleFormsFolder?.id) {
    return "folder_not_found";
  }
  return "idle";
}
