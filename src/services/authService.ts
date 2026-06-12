import type { Role } from "../permissions";
import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";

export type CompanyLoginUser = {
  email: string;
  role: Role;
  name: string;
  accessLevel?: string;
  companyAreas?: string[];
};

export type CompanyLoginCompany = {
  companyId: string;
  companyFolderId?: string;
  companyName: string;
  masterSheetId: string;
  registryStatus?: string;
  folderPlacementOk?: boolean;
  reasonCode?: string;
};

export type CompanyLoginResult = {
  ok: boolean;
  user?: CompanyLoginUser;
  company?: CompanyLoginCompany;
  masterSheetId?: string;
  blocker?: string;
  reasonCode?: string;
  error?: string;
};

export type CompanySessionResult = {
  ok: boolean;
  user?: CompanyLoginUser;
  company?: CompanyLoginCompany;
  folderPlacementOk?: boolean;
  reasonCode?: string;
  error?: string;
};

/** Fast company login — workbook Users tab only; no registry/setup gates. */
export async function companyLogin(input: {
  email: string;
  password: string;
  masterSheetId?: string;
}): Promise<CompanyLoginResult> {
  const result = await fetchJson<{
    ok?: boolean;
    user?: CompanyLoginUser;
    company?: CompanyLoginCompany;
    masterSheetId?: string;
    blocker?: string;
    reasonCode?: string;
    error?: string;
  }>(apiUrl("/api/auth/company/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      ...(input.masterSheetId?.trim() ? { masterSheetId: input.masterSheetId.trim() } : {}),
    }),
  });

  if (!result.ok) {
    return { ok: false, error: result.message, blocker: result.code };
  }

  const payload = result.data;
  if (!result.response.ok || !payload.ok || !payload.user?.email) {
    return {
      ok: false,
      blocker: payload.blocker,
      reasonCode: payload.reasonCode,
      error: payload.error || "Sign in failed.",
    };
  }

  const masterSheetId = String(payload.masterSheetId || payload.company?.masterSheetId || "").trim();
  const companyId = String(payload.company?.companyId || "").trim();
  return {
    ok: true,
    user: payload.user,
    company: payload.company
      ? {
          ...payload.company,
          companyId,
          companyFolderId: companyId,
          masterSheetId,
        }
      : undefined,
    masterSheetId,
  };
}

export async function fetchCompanySession(): Promise<CompanySessionResult> {
  const result = await fetchJson<{
    ok?: boolean;
    user?: CompanyLoginUser;
    company?: CompanyLoginCompany;
    folderPlacementOk?: boolean;
    reasonCode?: string;
    error?: string;
  }>(apiUrl("/api/auth/company/session"), { credentials: "include" });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || "No company session." };
  }

  const folderPlacementOk = payload.folderPlacementOk ?? payload.company?.folderPlacementOk;
  const reasonCode = payload.reasonCode || payload.company?.reasonCode;

  return {
    ok: true,
    user: payload.user,
    company: payload.company,
    folderPlacementOk,
    reasonCode,
  };
}

export async function companyLogout(): Promise<void> {
  await fetch(apiUrl("/api/auth/company/logout"), { method: "POST", credentials: "include" });
}
