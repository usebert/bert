import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import { sanitizeCompanyFolderId, sanitizeGoogleSpreadsheetId } from "../utils/googleDriveId";

export type StructureEntity = {
  id: string;
  name: string;
  status: "active" | "inactive" | string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  siteId?: string;
  departmentId?: string;
};

export type CompanyStructurePayload = {
  ok: boolean;
  error?: string;
  details?: string;
  sites?: StructureEntity[];
  departments?: StructureEntity[];
  areas?: StructureEntity[];
  site?: StructureEntity;
  department?: StructureEntity;
  area?: StructureEntity;
  masterSheetId?: string;
  companyFolderId?: string;
};

export type PersonAccessPayload = {
  ok: boolean;
  error?: string;
  details?: string;
  access?: {
    siteIds: string[];
    departmentIds: string[];
    areaIds: string[];
    allSites: boolean;
    allDepartments: boolean;
    allAreas: boolean;
  };
  accessSummary?: string;
  user?: {
    email: string;
    name: string;
    role: string;
    status: string;
    companyAreas: string[];
    siteIds: string[];
    departmentIds: string[];
    areaIds: string[];
    companyFolderId?: string;
  };
};

function structurePath(companyFolderId: string, suffix = "") {
  return `/api/companies/${encodeURIComponent(companyFolderId)}/structure${suffix}`;
}

async function parseStructureResponse(response: Response): Promise<CompanyStructurePayload> {
  const data = (await response.json().catch(() => ({}))) as CompanyStructurePayload;
  if (!response.ok || data.ok === false) {
    const safeError = String(data.error || "").trim();
    const safeDetail = String(data.details || "").trim();
    throw new Error(safeError || safeDetail || "Company structure request failed.");
  }
  return data;
}

export async function fetchCompanyStructure(companyFolderId: string, masterSheetId?: string) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  if (!folderId) {
    throw new Error("Company folder ID is required.");
  }
  const params = new URLSearchParams();
  const sheetId = sanitizeGoogleSpreadsheetId(masterSheetId);
  if (sheetId) {
    params.set("masterSheetId", sheetId);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const result = await fetchJson<CompanyStructurePayload>(apiUrl(`${structurePath(folderId)}${query}`));
  if (!result.ok) {
    throw new Error(result.message || "Could not load company structure.");
  }
  if (!result.response.ok || result.data.ok === false) {
    throw new Error(result.data.error || "Could not load company structure.");
  }
  return result.data;
}

export async function createCompanySite(
  companyFolderId: string,
  payload: { name: string; masterSheetId?: string },
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const response = await fetch(apiUrl(structurePath(folderId, "/sites")), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseStructureResponse(response);
}

export async function createCompanyDepartment(
  companyFolderId: string,
  payload: { name: string; masterSheetId?: string },
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const normalizedName = payload.name.trim();
  const response = await fetch(apiUrl(structurePath(folderId, "/departments")), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      name: normalizedName,
      departmentName: normalizedName,
    }),
  });
  return parseStructureResponse(response);
}

export async function createCompanyStructureArea(
  companyFolderId: string,
  payload: { name: string; siteId?: string; departmentId?: string; masterSheetId?: string },
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const response = await fetch(apiUrl(structurePath(folderId, "/areas")), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseStructureResponse(response);
}

export async function archiveCompanySite(
  companyFolderId: string,
  siteId: string,
  payload: { masterSheetId?: string; status?: "active" | "inactive" } = {},
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const response = await fetch(
    apiUrl(`${structurePath(folderId, `/sites/${encodeURIComponent(siteId)}`)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: payload.status || "inactive", masterSheetId: payload.masterSheetId }),
    },
  );
  return parseStructureResponse(response);
}

export async function archiveCompanyDepartment(
  companyFolderId: string,
  departmentId: string,
  payload: { masterSheetId?: string; status?: "active" | "inactive" } = {},
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const response = await fetch(
    apiUrl(`${structurePath(folderId, `/departments/${encodeURIComponent(departmentId)}`)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: payload.status || "inactive", masterSheetId: payload.masterSheetId }),
    },
  );
  return parseStructureResponse(response);
}

export async function archiveCompanyStructureArea(
  companyFolderId: string,
  areaId: string,
  payload: { masterSheetId?: string; status?: "active" | "inactive" } = {},
) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const response = await fetch(
    apiUrl(`${structurePath(folderId, `/areas/${encodeURIComponent(areaId)}`)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: payload.status || "inactive", masterSheetId: payload.masterSheetId }),
    },
  );
  return parseStructureResponse(response);
}

export async function updatePersonAccess(
  companyFolderId: string,
  personId: string,
  payload: {
    masterSheetId?: string;
    allSites?: boolean;
    allDepartments?: boolean;
    allAreas?: boolean;
    siteIds?: string[];
    departmentIds?: string[];
    areaIds?: string[];
  },
): Promise<PersonAccessPayload> {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const email = personId.trim().toLowerCase();
  if (!folderId || !email) {
    return { ok: false, error: "Company folder and person email are required." };
  }
  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(folderId)}/people/${encodeURIComponent(email)}/access`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = (await response.json().catch(() => ({}))) as PersonAccessPayload;
  if (!response.ok || data.ok === false) {
    return { ok: false, error: data.error || "Could not update person access.", details: data.details };
  }
  return data;
}
