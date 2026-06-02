import { apiUrl } from "../config/apiBase";

export type GoogleFormTemplateRecord = {
  bertTemplateId: string;
  templateName: string;
  sourceCompanyId: string;
  sourceCompanyName: string;
  category: string;
  googleFormId: string;
  googleFormDriveFileId: string;
  googleFormEditUrl: string;
  googleFormResponderUrl: string;
  parentDriveFolderId: string;
  parentDriveFolderName: string;
  currentDriveFolderId: string;
  currentDriveFolderName: string;
  createdBy: string;
  createdAt: string;
  lastSyncedAt: string;
  syncStatus: string;
  reusableTemplate: string;
  notes: string;
  scope?: string;
  type?: string;
  currentFolderPath?: string;
};

export type GoogleFormTemplatePlacement = "master" | "company";

export type BertTemplateForGoogleForm = {
  id: string;
  name: string;
  category?: string;
  source?: string;
  questions: Array<{
    id?: string;
    text: string;
    fieldType?: string;
    type?: string;
    options?: string[];
  }>;
  sourceCompanyId?: string;
  sourceCompanyName?: string;
  createdBy?: string;
  placement?: GoogleFormTemplatePlacement;
  masterSheetId?: string;
  companyRootFolderId?: string;
};

export const COMPANY_GOOGLE_FORM_STORAGE_PATH = "08 - Audits / Google Forms";

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export const googleFormTemplatesService = {
  async list() {
    const response = await fetch(apiUrl("/api/google-form-templates"), { credentials: "include" });
    return parseJson<{ ok: boolean; templates?: GoogleFormTemplateRecord[]; error?: string }>(response);
  },

  async getLinks(templateId: string) {
    const response = await fetch(apiUrl(`/api/google-form-templates/${encodeURIComponent(templateId)}/links`), {
      credentials: "include",
    });
    return parseJson<{ ok: boolean; template?: GoogleFormTemplateRecord; error?: string }>(response);
  },

  async createFromBertTemplate(
    template: BertTemplateForGoogleForm,
    options: { placement?: GoogleFormTemplatePlacement } = {},
  ) {
    const placement = options.placement || template.placement || "master";
    const response = await fetch(apiUrl("/api/google-form-templates/create-from-bert"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, placement }),
    });
    return parseJson<{
      ok: boolean;
      googleForm?: GoogleFormTemplateRecord;
      error?: string;
      permissionRequired?: boolean;
      scopeHint?: string;
      syncStatus?: string;
      skippedFields?: string[];
      bertTemplateCreated?: boolean;
      placement?: GoogleFormTemplatePlacement;
      storedFolderPath?: string;
      folderPlacementFailed?: boolean;
      userMessage?: string;
    }>(response);
  },

  async moveToTemplateFolder(templateId: string, input: { category?: string; folderId?: string }) {
    const response = await fetch(apiUrl(`/api/google-form-templates/${encodeURIComponent(templateId)}/move`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parseJson<{ ok: boolean; template?: GoogleFormTemplateRecord; error?: string }>(response);
  },

  async copyToCompanyFolder(templateId: string, targetCompanyFolderId: string) {
    const response = await fetch(apiUrl(`/api/google-form-templates/${encodeURIComponent(templateId)}/copy-to-company`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetCompanyFolderId }),
    });
    return parseJson<{
      ok: boolean;
      googleFormEditUrl?: string;
      googleFormResponderUrl?: string;
      error?: string;
    }>(response);
  },
};
