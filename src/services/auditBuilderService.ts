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
  template: AuditBuilderTemplateDraft & { status?: AuditBuilderTemplateStatus },
  options: RequestOptions = {},
): Promise<AuditBuilderTemplateRecord> {
  const response = await fetch(apiUrl(`/api/audits/templates/${encodeURIComponent(templateId)}/new-version`), {
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
