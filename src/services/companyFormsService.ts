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
  folderLookupFailed?: boolean;
};

/** UI-facing load outcome — empty only when the backend confirms a resolved folder with zero forms. */
export type CompanyGoogleFormsLoadStatus =
  | "idle"
  | "found"
  | "empty"
  | "folder_not_found"
  | "permission_denied"
  | "error";

/** @deprecated Prefer CompanyGoogleFormsLoadStatus in new UI. */
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
  message?: string;
  forms?: CompanyGoogleForm[];
  formsFound?: number;
  googleFormsFolder?: { id: string; name: string } | null;
  diagnostics?: CompanyGoogleFormsDiagnostics;
  permissionError?: string;
  companyFolderId?: string;
  synced?: number;
};

export const COMPANY_GOOGLE_FORMS_LOAD_TIMEOUT_MS = 90_000;
export const COMPANY_GOOGLE_FORMS_LOADING_MESSAGE = "Loading Google Forms…";
export const COMPANY_GOOGLE_FORMS_USER_MESSAGE = "Could not load Google Forms.";
export const COMPANY_GOOGLE_FORMS_LOAD_TIMEOUT_MESSAGE =
  "Loading Google Forms timed out. Try again — if it keeps failing, ask your operator to check the company Google Forms folder.";
export const COMPANY_GOOGLE_FORMS_FOLDER_NOT_FOUND_MESSAGE =
  "Could not find a Google Forms folder in this company workspace.";
export const COMPANY_GOOGLE_FORMS_PERMISSION_MESSAGE = "BERT cannot access the Google Forms folder.";
export const COMPANY_GOOGLE_FORMS_SYNCING_MESSAGE = "Syncing Google Forms to your company workbook…";
export const COMPANY_GOOGLE_FORMS_SYNC_USER_MESSAGE = "Could not sync Google Forms.";
export const COMPANY_GOOGLE_FORMS_SYNC_TIMEOUT_MESSAGE =
  "Syncing Google Forms timed out. Try again when your connection is stable.";

type JsonResponse = Record<string, unknown> & CompanyGoogleFormsResponse;

function mapApiStatusToLoadStatus(
  payload: CompanyGoogleFormsResponse,
  forms: CompanyGoogleForm[],
): CompanyGoogleFormsLoadStatus {
  if (payload.ok === false || payload.ok === undefined) {
    if (payload.status === "folder_lookup_failed") {
      return "folder_not_found";
    }
    if (payload.status === "permission_denied") {
      return "permission_denied";
    }
    return "error";
  }
  if (forms.length > 0) {
    return "found";
  }
  if (payload.googleFormsFolder?.id || payload.status === "found" || payload.status === "created") {
    return "empty";
  }
  return forms.length === 0 ? "empty" : "found";
}

function friendlyLoadError(
  status: CompanyGoogleFormsLoadStatus,
  payload: CompanyGoogleFormsResponse,
): string | undefined {
  if (status === "folder_not_found") {
    return payload.message || payload.error || COMPANY_GOOGLE_FORMS_FOLDER_NOT_FOUND_MESSAGE;
  }
  if (status === "permission_denied") {
    return payload.message || payload.error || COMPANY_GOOGLE_FORMS_PERMISSION_MESSAGE;
  }
  if (status === "error") {
    return payload.message || payload.error || COMPANY_GOOGLE_FORMS_USER_MESSAGE;
  }
  return undefined;
}

async function parseJsonResponse(response: Response): Promise<JsonResponse> {
  return (await response.json()) as JsonResponse;
}

export type FetchCompanyGoogleFormsResult = {
  ok: boolean;
  forms: CompanyGoogleForm[];
  status: CompanyGoogleFormsLoadStatus;
  loadError?: string;
  companyFolderId?: string;
  synced?: number;
};

/** Live Google Forms from the selected company folder — session-scoped company id on URL path only. */
export async function fetchCompanyGoogleForms(
  companyId: string,
  options?: { signal?: AbortSignal },
): Promise<FetchCompanyGoogleFormsResult> {
  const companyFolderId = String(companyId || "").trim();
  if (!companyFolderId) {
    return {
      ok: false,
      forms: [],
      status: "error",
      loadError: COMPANY_GOOGLE_FORMS_USER_MESSAGE,
    };
  }

  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/google-forms`),
      {
        credentials: "include",
        signal: options?.signal,
      },
    );
    const payload = await parseJsonResponse(response);
    const forms = Array.isArray(payload.forms) ? payload.forms : [];
    const status = mapApiStatusToLoadStatus(payload, forms);
    const loadError =
      !response.ok || payload.ok === false ? friendlyLoadError(status, payload) : undefined;

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        forms: [],
        status,
        loadError,
        companyFolderId: payload.companyFolderId || companyFolderId,
      };
    }

    return {
      ok: true,
      forms,
      status,
      companyFolderId: payload.companyFolderId || companyFolderId,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      forms: [],
      status: "error",
      loadError: error instanceof Error ? error.message : COMPANY_GOOGLE_FORMS_USER_MESSAGE,
    };
  }
}

export type CreateBertCheckFromGoogleFormResult = {
  ok: boolean;
  alreadyExists?: boolean;
  template?: {
    id: string;
    name: string;
    active: boolean;
    source: "Google Drive" | "Built in app";
    category?: string;
    language?: string;
    defaultLanguage?: string;
    translationStatus?: string;
    questions: Array<{
      id: string;
      text: string;
      riskLevel: string;
      riskCategory: string;
      autoActionRequired: boolean;
      requiresPhotoEvidence: boolean;
      requiresManagerReview: boolean;
    }>;
    googleForm?: {
      formId: string;
      driveFileId?: string;
      responderUrl?: string;
      syncStatus?: string;
      notes?: string;
    };
  };
  error?: string;
};

/** Creates a native BERT check template from a synced company Google Form. */
export async function createBertCheckFromGoogleForm(
  companyId: string,
  formId: string,
  options?: { signal?: AbortSignal },
): Promise<CreateBertCheckFromGoogleFormResult> {
  const companyFolderId = String(companyId || "").trim();
  const normalizedFormId = String(formId || "").trim();
  if (!companyFolderId || !normalizedFormId) {
    return { ok: false, error: "Company and form id are required." };
  }

  try {
    const response = await fetch(
      apiUrl(
        `/api/companies/${encodeURIComponent(companyFolderId)}/google-forms/${encodeURIComponent(normalizedFormId)}/create-bert-check`,
      ),
      {
        method: "POST",
        credentials: "include",
        signal: options?.signal,
      },
    );
    const payload = (await parseJsonResponse(response)) as CreateBertCheckFromGoogleFormResult;
    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.error || "Could not create BERT check from Google Form.",
      };
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create BERT check from Google Form.",
    };
  }
}

/** Lists Drive forms and writes GoogleFormTemplates tab for the session company. */
export async function syncCompanyGoogleForms(
  companyId: string,
  options?: { signal?: AbortSignal },
): Promise<FetchCompanyGoogleFormsResult> {
  const companyFolderId = String(companyId || "").trim();
  if (!companyFolderId) {
    return {
      ok: false,
      forms: [],
      status: "error",
      loadError: COMPANY_GOOGLE_FORMS_SYNC_USER_MESSAGE,
    };
  }

  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/google-forms/sync`),
      {
        method: "POST",
        credentials: "include",
        signal: options?.signal,
      },
    );
    const payload = await parseJsonResponse(response);
    const forms = Array.isArray(payload.forms) ? payload.forms : [];
    const status = mapApiStatusToLoadStatus(payload, forms);
    const loadError =
      !response.ok || payload.ok === false ? friendlyLoadError(status, payload) : undefined;

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        forms: [],
        status,
        loadError: loadError || COMPANY_GOOGLE_FORMS_SYNC_USER_MESSAGE,
        companyFolderId: payload.companyFolderId || companyFolderId,
      };
    }

    return {
      ok: true,
      forms,
      status,
      companyFolderId: payload.companyFolderId || companyFolderId,
      synced: typeof payload.synced === "number" ? payload.synced : forms.length,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      forms: [],
      status: "error",
      loadError: error instanceof Error ? error.message : COMPANY_GOOGLE_FORMS_SYNC_USER_MESSAGE,
    };
  }
}

/** @deprecated Use fetchCompanyGoogleForms — legacy object export for folder-inspection callers. */
export const companyFormsService = {
  async listCompanyGoogleForms(companyFolderId: string) {
    const result = await fetchCompanyGoogleForms(companyFolderId);
    if (!result.ok) {
      throw new Error(result.loadError || COMPANY_GOOGLE_FORMS_USER_MESSAGE);
    }
    return {
      ok: true,
      forms: result.forms,
      formsFound: result.forms.length,
      status: result.status,
    } satisfies CompanyGoogleFormsResponse;
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
  if (
    inspection.googleFormsStatus === "folder_not_found" ||
    inspection.googleFormsStatus === "folder_lookup_failed"
  ) {
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
