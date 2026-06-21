import type { Role } from "../permissions";
import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import { validateCompanyDriveIds } from "../utils/googleDriveId";
import {
  buildLoginFetchDiagnostics,
  companyLoginNetworkError,
  type LoginFetchDiagnostics,
} from "../utils/loginNetworkMessages";

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

export type LoginContextDiagnostics = {
  email?: string;
  failedStep?: string;
  companyName?: string;
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
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
  companyContextValid?: boolean;
  code?: string;
  message?: string;
  diagnostics?: LoginContextDiagnostics;
  networkDiagnostics?: LoginFetchDiagnostics;
  clearClientHints?: boolean;
};

export type CompanySessionResult = {
  ok: boolean;
  user?: CompanyLoginUser;
  company?: CompanyLoginCompany;
  folderPlacementOk?: boolean;
  reasonCode?: string;
  error?: string;
  companyContextValid?: boolean;
  code?: string;
};

export type AppSessionKind = "master" | "company";

export type AppSessionResult = {
  ok: boolean;
  sessionKind?: AppSessionKind;
  user?: CompanyLoginUser;
  company?: CompanyLoginCompany;
  operator?: { email: string; name: string };
  folderPlacementOk?: boolean;
  reasonCode?: string;
  error?: string;
  companyContextValid?: boolean;
  code?: string;
};

/** Fast company login — workbook Users tab company columns; live Drive validation runs after response. */
export async function companyLogin(input: {
  email: string;
  password: string;
  masterSheetId?: string;
  companyFolderId?: string;
}): Promise<CompanyLoginResult> {
  const result = await fetchJson<{
    ok?: boolean;
    user?: CompanyLoginUser;
    company?: CompanyLoginCompany;
    masterSheetId?: string;
    blocker?: string;
    reasonCode?: string;
    error?: string;
    message?: string;
    companyContextValid?: boolean;
    code?: string;
    diagnostics?: LoginContextDiagnostics;
    clearClientHints?: boolean;
  }>(apiUrl("/api/auth/company/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      ...(input.masterSheetId?.trim() ? { masterSheetId: input.masterSheetId.trim() } : {}),
      ...(input.companyFolderId?.trim() ? { companyFolderId: input.companyFolderId.trim() } : {}),
    }),
  });

  if (!result.ok) {
    if (result.code === "NETWORK_UNREACHABLE") {
      const networkDiagnostics = buildLoginFetchDiagnostics(result.diagnostics);
      const message = companyLoginNetworkError();
      return {
        ok: false,
        code: "NETWORK_UNREACHABLE",
        blocker: "network_unreachable",
        error: message,
        message,
        networkDiagnostics,
      };
    }
    return { ok: false, error: result.message, blocker: result.code, code: result.code };
  }

  const payload = result.data;
  if (!result.response.ok || !payload.ok || !payload.user?.email) {
    return {
      ok: false,
      blocker: payload.blocker,
      reasonCode: payload.reasonCode || payload.diagnostics?.reasonCode,
      code: payload.code,
      companyContextValid: payload.companyContextValid,
      diagnostics: payload.diagnostics,
      error: payload.message || payload.error || "Sign in failed.",
      message: payload.message || payload.error,
    };
  }

  if (payload.companyContextValid === false) {
    return {
      ok: false,
      blocker: payload.blocker || "company_context_invalid",
      reasonCode: payload.reasonCode || payload.diagnostics?.reasonCode,
      code: payload.code,
      companyContextValid: false,
      diagnostics: payload.diagnostics,
      error: payload.message || payload.error || "Sign in failed.",
      message: payload.message || payload.error,
    };
  }

  const validatedIds = validateCompanyDriveIds({
    companyFolderId: payload.company?.companyFolderId || payload.company?.companyId,
    masterSheetId: payload.masterSheetId || payload.company?.masterSheetId,
  });
  if (!validatedIds) {
    return {
      ok: false,
      blocker: "login_context_failed",
      code: "COMPANY_CONTEXT_INVALID",
      companyContextValid: false,
      error: payload.message || payload.error || "Sign in failed.",
      message: payload.message || payload.error || "Sign in failed.",
      diagnostics: payload.diagnostics,
    };
  }
  const masterSheetId = validatedIds.masterSheetId;
  const companyId = validatedIds.companyFolderId;
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
    companyContextValid: payload.companyContextValid ?? true,
    clearClientHints: payload.clearClientHints === true,
  };
}

function normalizeMasterSessionCompany(payload: {
  company?: CompanyLoginCompany;
  companyId?: string;
  companyFolderId?: string;
  companyName?: string;
  selectedCompanyName?: string;
  masterSheetId?: string;
}): CompanyLoginCompany | undefined {
  if (payload.company?.companyName || payload.company?.companyId) {
    return payload.company;
  }
  const companyFolderId = String(payload.companyFolderId || payload.companyId || "").trim();
  const companyName = String(payload.companyName || payload.selectedCompanyName || "").trim();
  const masterSheetId = String(payload.masterSheetId || "").trim();
  if (!companyFolderId && !companyName && !masterSheetId) {
    return undefined;
  }
  return {
    companyId: companyFolderId,
    companyFolderId,
    companyName,
    masterSheetId,
  };
}

export async function fetchAppSession(): Promise<AppSessionResult> {
  const result = await fetchJson<{
    ok?: boolean;
    sessionKind?: AppSessionKind;
    operator?: { email: string; name: string };
    user?: CompanyLoginUser;
    company?: CompanyLoginCompany;
    companyId?: string;
    companyFolderId?: string;
    companyName?: string;
    selectedCompanyName?: string;
    masterSheetId?: string;
    folderPlacementOk?: boolean;
    reasonCode?: string;
    error?: string;
    companyContextValid?: boolean;
    code?: string;
  }>(apiUrl("/api/session"), { credentials: "include" });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return {
      ok: false,
      error: payload.error || "No session.",
      code: payload.code,
      companyContextValid: payload.companyContextValid,
      reasonCode: payload.reasonCode,
    };
  }

  if (payload.sessionKind === "master" && payload.operator?.email) {
    const masterCompany = normalizeMasterSessionCompany(payload);
    const validatedIds = masterCompany
      ? validateCompanyDriveIds({
          companyFolderId: masterCompany.companyFolderId || masterCompany.companyId,
          masterSheetId: masterCompany.masterSheetId,
        })
      : null;
    return {
      ok: true,
      sessionKind: "master",
      operator: payload.operator,
      user: payload.user || {
        email: payload.operator.email,
        name: payload.operator.name || payload.operator.email,
        role: "Master",
      },
      company:
        masterCompany && validatedIds
          ? {
              ...masterCompany,
              companyId: validatedIds.companyFolderId,
              companyFolderId: validatedIds.companyFolderId,
              masterSheetId: validatedIds.masterSheetId,
            }
          : masterCompany,
    };
  }

  if (payload.companyContextValid === false) {
    return {
      ok: false,
      error: payload.error || "No session.",
      code: payload.code,
      companyContextValid: false,
      reasonCode: payload.reasonCode,
    };
  }

  const folderPlacementOk = payload.folderPlacementOk ?? payload.company?.folderPlacementOk;
  const reasonCode = payload.reasonCode || payload.company?.reasonCode;
  const validatedIds = validateCompanyDriveIds({
    companyFolderId: payload.company?.companyFolderId || payload.company?.companyId,
    masterSheetId: payload.company?.masterSheetId,
  });
  if (payload.sessionKind === "company" && payload.user?.email && !validatedIds) {
    return {
      ok: false,
      error: payload.error || "No session.",
      code: payload.code || "COMPANY_CONTEXT_INVALID",
      companyContextValid: false,
      reasonCode: reasonCode || "COMPANY_CONTEXT_INVALID",
    };
  }

  return {
    ok: true,
    sessionKind: payload.sessionKind,
    user: payload.user,
    company: payload.company && validatedIds
      ? {
          ...payload.company,
          companyId: validatedIds.companyFolderId,
          companyFolderId: validatedIds.companyFolderId,
          masterSheetId: validatedIds.masterSheetId,
        }
      : payload.company,
    operator: payload.operator,
    folderPlacementOk,
    reasonCode,
    companyContextValid: payload.companyContextValid ?? true,
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
    companyContextValid?: boolean;
    code?: string;
  }>(apiUrl("/api/auth/company/session"), { credentials: "include" });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return {
      ok: false,
      error: payload.error || "No company session.",
      code: payload.code,
      companyContextValid: payload.companyContextValid,
      reasonCode: payload.reasonCode,
    };
  }

  if (payload.companyContextValid === false) {
    return {
      ok: false,
      error: payload.error || "No company session.",
      code: payload.code,
      companyContextValid: false,
      reasonCode: payload.reasonCode,
    };
  }

  const folderPlacementOk = payload.folderPlacementOk ?? payload.company?.folderPlacementOk;
  const reasonCode = payload.reasonCode || payload.company?.reasonCode;
  const validatedIds = validateCompanyDriveIds({
    companyFolderId: payload.company?.companyFolderId || payload.company?.companyId,
    masterSheetId: payload.company?.masterSheetId,
  });
  if (!validatedIds) {
    return {
      ok: false,
      error: payload.error || "No company session.",
      code: payload.code || "COMPANY_CONTEXT_INVALID",
      companyContextValid: false,
      reasonCode: reasonCode || "COMPANY_CONTEXT_INVALID",
    };
  }

  return {
    ok: true,
    user: payload.user,
    company: payload.company
      ? {
          ...payload.company,
          companyId: validatedIds.companyFolderId,
          companyFolderId: validatedIds.companyFolderId,
          masterSheetId: validatedIds.masterSheetId,
        }
      : undefined,
    folderPlacementOk,
    reasonCode,
    companyContextValid: payload.companyContextValid ?? true,
  };
}

export async function companyLogout(): Promise<void> {
  await fetch(apiUrl("/api/auth/company/logout"), { method: "POST", credentials: "include" });
}
