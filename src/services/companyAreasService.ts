import { apiUrl } from "../config/apiBase";
import type { Site } from "../types/adminScreenProps";

export type CompanyAreasPayload = {
  ok: boolean;
  error?: string;
  areas?: Site[];
  area?: Site;
  areaRestrictionsEnabled?: boolean;
};

async function parseAreasResponse(response: Response): Promise<CompanyAreasPayload> {
  const data = (await response.json().catch(() => ({}))) as CompanyAreasPayload;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Company areas request failed.");
  }
  return data;
}

export async function fetchCompanyAreas(masterSheetId: string, companyFolderId?: string) {
  const query = companyFolderId ? `?companyFolderId=${encodeURIComponent(companyFolderId)}` : "";
  const response = await fetch(apiUrl(`/api/company-areas/${encodeURIComponent(masterSheetId)}${query}`), {
    credentials: "include",
  });
  return parseAreasResponse(response);
}

export async function createCompanyArea(
  masterSheetId: string,
  payload: { name: string; createdBy?: string },
) {
  const response = await fetch(apiUrl(`/api/company-areas/${encodeURIComponent(masterSheetId)}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseAreasResponse(response);
}

export async function updateCompanyArea(
  masterSheetId: string,
  areaId: string,
  payload: { name?: string; status?: "active" | "archived"; areaRestrictionsEnabled?: boolean },
) {
  const response = await fetch(
    apiUrl(`/api/company-areas/${encodeURIComponent(masterSheetId)}/${encodeURIComponent(areaId)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return parseAreasResponse(response);
}

export async function setAreaRestrictionsEnabled(masterSheetId: string, areaRestrictionsEnabled: boolean) {
  const response = await fetch(
    apiUrl(`/api/company-areas/${encodeURIComponent(masterSheetId)}/config/restrictions`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ areaRestrictionsEnabled }),
    },
  );
  return parseAreasResponse(response);
}
