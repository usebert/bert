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
};

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
};

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

  async createFromBertTemplate(template: BertTemplateForGoogleForm) {
    const response = await fetch(apiUrl("/api/google-form-templates/create-from-bert"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template }),
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
