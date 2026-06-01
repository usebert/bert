import { apiUrl } from "../config/apiBase";
import type { AreaAuditMapping } from "../utils/areaAuditMapping";
import type { AuditAccessLevel } from "../types/auditsScreenProps";

export type AuditTemplateRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  defaultFrequency: string;
  createdAt: string;
  googleFormId?: string;
  googleFormTemplateStatus?: string;
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

export async function fetchCompanyAuditMapping(masterSheetId: string) {
  const response = await fetch(apiUrl(`/api/company-audit-mapping/${encodeURIComponent(masterSheetId)}`), {
    credentials: "include",
  });
  return parseMappingResponse(response);
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
  templates: Array<{ id: string; name: string; active?: boolean; source?: string; category?: string }>,
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
