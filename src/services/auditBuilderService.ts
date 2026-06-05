import { apiUrl } from "../config/apiBase";
import type {
  AuditBuilderInstance,
  AuditBuilderTemplateDraft,
  AuditBuilderTemplateRecord,
} from "../types/auditBuilder";
import { parseJsonApiResponse } from "../utils/parseJsonApiResponse";

type RequestOptions = {
  masterSheetId?: string;
  devApiHeaders?: Record<string, string>;
};

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
