import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import type { AreaAuditMapping } from "../utils/areaAuditMapping";
import type { AuditAccessLevel } from "../types/auditsScreenProps";

export const COMPANY_AUDIT_MAPPING_LOAD_TIMEOUT_MS = 90_000;
export const COMPANY_AUDIT_MAPPING_LOAD_TIMEOUT_MESSAGE =
  "Loading audit templates timed out before the server finished reading your company workbook. Try again — if it keeps failing, check the AuditTemplates tab in your BERT Master Sheet.";

export type AuditTemplateRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  defaultFrequency: string;
  createdAt: string;
  googleFormId?: string;
  googleFormTemplateStatus?: string;
  language?: string;
  defaultLanguage?: string;
  translationStatus?: string;
  formNumber?: string;
  revisionNumber?: number;
  revisionId?: string;
  supersedesRevisionId?: string;
  supersededByRevisionId?: string;
  revisionReason?: string;
  copyReason?: string;
};

export type CompanyAuditMappingPayload = {
  ok: boolean;
  error?: string;
  auditTemplates?: AuditTemplateRow[];
  areaAudits?: AreaAuditMapping[];
  userAreaAccess?: Array<{ email: string; areaId: string; access: string }>;
  userAuditAccess?: Array<{ email: string; auditId: string; access: string; uiAccess?: AuditAccessLevel }>;
  schedules?: Array<{
    scheduleId: string;
    areaId: string;
    auditId: string;
    auditName: string;
    frequency: string;
    nextDueDate: string;
    assignedRole: string;
    assignedUser: string;
    companyFolderId: string;
  }>;
};

async function parseMappingResponse(response: Response): Promise<CompanyAuditMappingPayload> {
  const data = (await response.json().catch(() => ({}))) as CompanyAuditMappingPayload;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Company audit mapping request failed.");
  }
  return data;
}

export async function fetchCompanyAuditMapping(masterSheetId: string, options?: { signal?: AbortSignal }) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), COMPANY_AUDIT_MAPPING_LOAD_TIMEOUT_MS);
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    const result = await fetchJson<CompanyAuditMappingPayload>(
      `/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}`,
      { signal: controller.signal },
    );
    if (!result.ok) {
      if (controller.signal.aborted) {
        throw new Error(COMPANY_AUDIT_MAPPING_LOAD_TIMEOUT_MESSAGE);
      }
      throw new Error(result.message || "Company audit mapping request failed.");
    }
    if (!result.response.ok || result.data.ok === false) {
      throw new Error(result.data.error || "Company audit mapping request failed.");
    }
    return result.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(COMPANY_AUDIT_MAPPING_LOAD_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function saveAreaAuditsForArea(masterSheetId: string, areaId: string, enabledAuditIds: string[]) {
  const response = await fetch(
    apiUrl(`/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}/area-audits`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ areaId, enabledAuditIds }),
    },
  );
  return parseMappingResponse(response);
}

export async function syncAuditTemplatesToSheet(
  masterSheetId: string,
  templates: Array<{
    id: string;
    name: string;
    active?: boolean;
    source?: string;
    category?: string;
    language?: string;
    defaultLanguage?: string;
    translationStatus?: string;
    googleFormId?: string;
    googleForm?: { formId?: string; syncStatus?: string };
    googleFormTemplateStatus?: string;
  }>,
) {
  const response = await fetch(
    apiUrl(`/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}/audit-templates`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates }),
    },
  );
  return parseMappingResponse(response);
}

export async function saveUserAreaAccessRows(
  masterSheetId: string,
  rows: Array<{ email: string; areaId: string; access?: string }>,
) {
  const response = await fetch(
    apiUrl(`/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}/user-area-access`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    },
  );
  return parseMappingResponse(response);
}

export async function saveUserAuditAccessRows(
  masterSheetId: string,
  rows: Array<{ email: string; auditId: string; access: AuditAccessLevel | string }>,
) {
  const response = await fetch(
    apiUrl(`/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}/user-audit-access`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    },
  );
  return parseMappingResponse(response);
}
