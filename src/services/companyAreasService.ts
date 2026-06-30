import { apiUrl } from "../config/apiBase";
import type { Site } from "../types/adminScreenProps";
import { fetchJson } from "../utils/fetchJson";

export type CompanyAreasPayload = {
  ok: boolean;
  error?: string;
  areas?: Site[];
  area?: Site;
  areaRestrictionsEnabled?: boolean;
  defaultFormLanguage?: string;
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
  const path = `/api/company-areas/${encodeURIComponent(masterSheetId)}${query}`;
  const result = await fetchJson<CompanyAreasPayload>(path);
  if (!result.ok) {
    throw new Error(result.message || "Company areas request failed.");
  }
  if (!result.response.ok || result.data.ok === false) {
    throw new Error(result.data.error || "Company areas request failed.");
  }
  return result.data;
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

export async function setDefaultFormLanguage(masterSheetId: string, defaultFormLanguage: string) {
  const response = await fetch(
    apiUrl(`/api/company-areas/${encodeURIComponent(masterSheetId)}/default-form-language`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultFormLanguage }),
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
