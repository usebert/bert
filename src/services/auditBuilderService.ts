import { apiUrl } from "../config/apiBase";
import type {
  AuditBuilderInstance,
  AuditBuilderTemplateDraft,
  AuditBuilderTemplateRecord,
  AuditBuilderTemplateStatus,
} from "../types/auditBuilder";
import { parseJsonApiResponse } from "../utils/parseJsonApiResponse";

type RequestOptions = {
  masterSheetId?: string;
  companyFolderId?: string;
  devApiHeaders?: Record<string, string>;
};

export const TEMPLATE_USED_WARNING =
  "This template has already been used. Saving changes will create a new version for future audits. Existing audit records will not be changed.";

function buildHeaders(devApiHeaders?: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    ...(devApiHeaders || {}),
  };
}

export async function generateAuditTemplateFromText(
  text: string,
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateDraft> {
  const response = await fetch(apiUrl("/api/audits/templates/generate-from-text"), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ text, masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateDraft; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to generate audit template.");
  }
  return data.template;
}

export async function saveAuditBuilderTemplate(
  template: AuditBuilderTemplateDraft & { id?: string },
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const response = await fetch(apiUrl("/api/audits/templates"), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ ...template, masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateRecord; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to save audit template.");
  }
  return data.template;
}

export async function listAuditBuilderTemplates(
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord[]> {
  const query = options.masterSheetId ? `?masterSheetId=${encodeURIComponent(options.masterSheetId)}` : "";
  const response = await fetch(apiUrl(`/api/audits/templates${query}`), {
    credentials: "include",
    headers: options.devApiHeaders || {},
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; templates?: AuditBuilderTemplateRecord[]; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to list audit templates.");
  }
  return data.templates || [];
}

export async function getAuditBuilderTemplate(
  templateId: string,
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const query = options.masterSheetId ? `?masterSheetId=${encodeURIComponent(options.masterSheetId)}` : "";
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}${query}`), {
    credentials: "include",
    headers: options.devApiHeaders || {},
  });
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    template?: AuditBuilderTemplateRecord;
    error?: string;
  }>(response);
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to load audit template.");
  }
  return data.template;
}

export async function updateAuditBuilderTemplate(
  templateId: string,
  template: AuditBuilderTemplateDraft & { status?: AuditBuilderTemplateStatus },
  options: RequestOptions & { createNewVersion?: boolean } = {},
): Promise<AuditBuilderTemplateRecord> {
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}`), {
    method: "PATCH",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({
      ...template,
      masterSheetId: options.masterSheetId,
      create_new_version: options.createNewVersion === true,
    }),
  });
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    template?: AuditBuilderTemplateRecord;
    error?: string;
    is_used?: boolean;
    requires_new_version?: boolean;
  }>(response);
  if (!response.ok || !data.ok || !data.template) {
    const error = new Error(data.error || "Unable to update audit template.") as Error & {
      isUsed?: boolean;
      requiresNewVersion?: boolean;
    };
    error.isUsed = data.is_used;
    error.requiresNewVersion = data.requires_new_version;
    throw error;
  }
  return data.template;
}

export async function createAuditTemplateNewVersion(
  templateId: string,
  template: AuditBuilderTemplateDraft & { status?: AuditBuilderTemplateStatus; reason?: string },
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const path = companyFolderId
    ? `/api/companies/${encodeURIComponent(companyFolderId)}/audit-templates/${encodeURIComponent(templateId)}/revise`
    : `/api/audits/templates/${encodeURIComponent(templateId)}/new-version`;
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ ...template, masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateRecord; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to create template version.");
  }
  return data.template;
}

export async function copyAuditBuilderTemplate(
  templateId: string,
  input: { title: string; reason?: string; confirmArchivedTitle?: boolean },
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const path = companyFolderId
    ? `/api/companies/${encodeURIComponent(companyFolderId)}/audit-templates/${encodeURIComponent(templateId)}/copy`
    : `/api/audits/templates/${encodeURIComponent(templateId)}/copy`;
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({
      title: input.title,
      reason: input.reason || "",
      confirmArchivedTitle: input.confirmArchivedTitle === true,
      masterSheetId: options.masterSheetId,
    }),
  });
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    template?: AuditBuilderTemplateRecord;
    error?: string;
    message?: string;
    archivedConflict?: boolean;
  }>(response);
  if (!response.ok || !data.ok || !data.template) {
    const error = new Error(data.error || data.message || "Unable to copy audit template.") as Error & {
      archivedConflict?: boolean;
      code?: string;
    };
    error.archivedConflict = data.archivedConflict === true;
    throw error;
  }
  return data.template;
}

export async function copyGoogleFormTemplateMetadata(
  templateId: string,
  input: { title: string; reason?: string; confirmArchivedTitle?: boolean },
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const companyFolderId = String(options.companyFolderId || "").trim();
  if (!companyFolderId) {
    throw new Error("Company folder is required to copy a Google Form template.");
  }
  const response = await fetch(
    apiUrl(
      `/api/companies/${encodeURIComponent(companyFolderId)}/google-form-templates/${encodeURIComponent(templateId)}/copy`,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(options.devApiHeaders),
      body: JSON.stringify({
        title: input.title,
        reason: input.reason || "",
        confirmArchivedTitle: input.confirmArchivedTitle === true,
        masterSheetId: options.masterSheetId,
      }),
    },
  );
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    template?: AuditBuilderTemplateRecord;
    error?: string;
    message?: string;
    copyNote?: string;
  }>(response);
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || data.message || "Unable to copy Google Form template.");
  }
  return data.template;
}

/** @deprecated Prefer copyAuditBuilderTemplate with an explicit new title. */
export async function duplicateAuditBuilderTemplate(
  templateId: string,
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}/duplicate`), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateRecord; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to duplicate audit template.");
  }
  return data.template;
}

export type AuditTemplateRevisionSummary = {
  id: string;
  template_name: string;
  form_number: string;
  revision_number: number;
  revision_id?: string;
  status: string;
  revision_label?: string;
  revision_reason?: string;
  copy_reason?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  superseded_by_revision_id?: string;
  supersedes_revision_id?: string;
  is_active?: boolean;
  is_superseded?: boolean;
};

export async function listAuditTemplateRevisions(
  templateId: string,
  options: RequestOptions & { formNumber?: string } = {},
): Promise<{ formNumber: string; revisions: AuditTemplateRevisionSummary[]; activeRevisionId?: string }> {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const params = new URLSearchParams();
  if (options.masterSheetId) params.set("masterSheetId", options.masterSheetId);
  if (options.formNumber) params.set("formNumber", options.formNumber);
  const query = params.toString();
  const path = companyFolderId
    ? `/api/companies/${encodeURIComponent(companyFolderId)}/audit-templates/${encodeURIComponent(templateId)}/revisions`
    : `/api/audits/templates/${encodeURIComponent(templateId)}/revisions`;
  const response = await fetch(apiUrl(`${path}${query ? `?${query}` : ""}`), {
    credentials: "include",
    headers: options.devApiHeaders || {},
  });
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    formNumber?: string;
    revisions?: AuditTemplateRevisionSummary[];
    activeRevisionId?: string;
    error?: string;
  }>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to load revision history.");
  }
  return {
    formNumber: data.formNumber || options.formNumber || "",
    revisions: data.revisions || [],
    activeRevisionId: data.activeRevisionId,
  };
}

export async function restoreAuditTemplateAsRevision(
  templateId: string,
  options: RequestOptions & { reason?: string } = {},
): Promise<AuditBuilderTemplateRecord> {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const path = companyFolderId
    ? `/api/companies/${encodeURIComponent(companyFolderId)}/audit-templates/${encodeURIComponent(templateId)}/restore-as-revision`
    : `/api/audits/templates/${encodeURIComponent(templateId)}/restore-as-revision`;
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({
      masterSheetId: options.masterSheetId,
      reason: options.reason || "",
    }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateRecord; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to restore as a new revision.");
  }
  return data.template;
}

export async function archiveAuditBuilderTemplate(
  templateId: string,
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}/archive`), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{ ok?: boolean; template?: AuditBuilderTemplateRecord; error?: string }>(
    response,
  );
  if (!response.ok || !data.ok || !data.template) {
    throw new Error(data.error || "Unable to archive audit template.");
  }
  return data.template;
}

export async function startAuditFromTemplate(
  templateId: string,
  options: RequestOptions = {},
): Promise<{ instance: AuditBuilderInstance; template: AuditBuilderTemplateRecord }> {
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}/start`), {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(options.devApiHeaders),
    body: JSON.stringify({ masterSheetId: options.masterSheetId }),
  });
  const data = await parseJsonApiResponse<{
    ok?: boolean;
    instance?: AuditBuilderInstance;
    template?: AuditBuilderTemplateRecord;
    error?: string;
  }>(response);
  if (!response.ok || !data.ok || !data.instance || !data.template) {
    throw new Error(data.error || "Unable to start audit.");
  }
  return { instance: data.instance, template: data.template };
}
