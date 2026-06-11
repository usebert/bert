/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import {
  isActiveUser,
  parseRoleForClient,
  buildAvailableScheduleAssigneesFromUsers,
} from "../shared/schedule-assignees.mjs";
import {
  parseCompanyAreas,
  sanitizeUsersTabRecords,
  migrateUsersTabColumns,
  normalizeUserStatus,
} from "./company-users.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";

function pickRowValue(row, ...keys) {
  if (!row || typeof row !== "object") {
    return "";
  }
  for (const key of keys) {
    const want = String(key).trim().toLowerCase();
    for (const [rawKey, rawValue] of Object.entries(row)) {
      if (String(rawKey).trim().toLowerCase() === want) {
        return String(rawValue ?? "").trim();
      }
    }
  }
  return "";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function isActiveSessionActor(actor) {
  if (!actor?.email) {
    return false;
  }
  const status = String(actor.status || "active").trim().toLowerCase();
  return status === "active" || status === "";
}

function mapUsersTabRow(row, companyFolderId = "") {
  const companyAreasRaw = pickRowValue(row, "CompanyAreas", "Company Areas", "companyAreas");
  return {
    email: pickRowValue(row, "Email", "email"),
    name: pickRowValue(row, "Name", "name", "Full Name"),
    role: pickRowValue(row, "Role", "role"),
    accessLevel: pickRowValue(row, "AccessLevel", "Access Level", "accessLevel"),
    status: pickRowValue(row, "Status", "status"),
    companyId: companyFolderId || pickRowValue(row, "Company ID", "CompanyId", "companyId"),
    companyFolderId,
    companyAreas: parseCompanyAreas(companyAreasRaw),
    companyAreasRaw,
  };
}

function mapActiveCompanyMember(row, companyFolderId) {
  const email = normalizeEmail(row.email || row.Email);
  if (!email) {
    return null;
  }
  const status = normalizeUserStatus(row.status || row.Status);
  if (status !== "ACTIVE") {
    return null;
  }
  const companyAreas = Array.isArray(row.companyAreas)
    ? row.companyAreas
    : parseCompanyAreas(row.companyAreasRaw || row.CompanyAreas || row.companyAreas || "");
  return {
    email,
    name: String(row.name || row.Name || email.split("@")[0] || email).trim() || email,
    role: parseRoleForClient(row.role || row.Role || row.accessLevel || row.AccessLevel || "User"),
    accessLevel: String(row.accessLevel || row.AccessLevel || "").trim(),
    status: "ACTIVE",
    companyId: companyFolderId,
    companyFolderId,
    companyAreas,
    companyAreasRaw: row.companyAreasRaw || String(row.CompanyAreas || ""),
  };
}

function buildSessionActorMember(actor, companyFolderId) {
  const email = normalizeEmail(actor.email);
  if (!email) {
    return null;
  }
  return {
    email,
    name: String(actor.name || email.split("@")[0] || email).trim() || email,
    role: parseRoleForClient(actor.role || actor.accessLevel || "User"),
    accessLevel: String(actor.accessLevel || "").trim(),
    status: "ACTIVE",
    companyId: companyFolderId,
    companyFolderId,
    companyAreas: Array.isArray(actor.companyAreas) ? actor.companyAreas : [],
    companyAreasRaw: Array.isArray(actor.companyAreas) ? actor.companyAreas.join(", ") : "",
  };
}

export async function getCompanyUsers(auth, masterSheetId, deps, options = {}) {
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId || !auth) {
    throw new Error("masterSheetId and Google auth are required to read company users.");
  }
  const { readCompanySheetById } = deps;
  if (typeof readCompanySheetById !== "function") {
    throw new Error("readCompanySheetById is not configured.");
  }
  if (typeof migrateUsersTabColumns === "function" && deps.getTabValues) {
    await migrateUsersTabColumns(auth, sheetId, deps).catch(() => null);
  }
  const payload = await readCompanySheetById(auth, sheetId);
  if (!payload || payload.ok === false) {
    throw new Error(String(payload?.error || "Unable to read company workbook Users tab."));
  }
  if (!payload.data || !Array.isArray(payload.data.Users)) {
    throw new Error("Company workbook Users tab is missing or unreadable.");
  }
  const rawUsers = payload.data.Users;
  const companyFolderId = String(options.companyFolderId || options.companyId || "").trim();
  return sanitizeUsersTabRecords(rawUsers.map((row) => mapUsersTabRow(row, companyFolderId)));
}

/**
 * Canonical active company members from the Users tab — all roles, companyId = companyFolderId.
 */
export async function listActiveCompanyMembers(auth, deps, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  let masterSheetId = String(companyContext.masterSheetId || "").trim();
  let companyName = String(companyContext.companyName || "").trim();
  const sessionActor = companyContext.sessionActor || null;

  let registryRecord = null;
  if (companyFolderId) {
    registryRecord = await resolveCompanyById(auth, deps, companyFolderId).catch(() => null);
  }

  if (!registryRecord && !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
      diagnostics: {
        currentCompanyId: companyFolderId,
        currentCompanyName: companyName || undefined,
        masterSheetId: "",
        signedInEmail: normalizeEmail(sessionActor?.email || ""),
        activeUsersFound: 0,
        dataSource: "users_tab",
      },
    };
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
    companyName =
      companyName ||
      String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
  }

  const resolvedCompanyId = String(
    companyFolderId ||
      registryRecord?.companyFolderId ||
      registryRecord?.rootFolderId ||
      registryRecord?.companyId ||
      "",
  ).trim();

  if (!masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company master sheet is not configured.",
      message: "Company master sheet is not configured.",
      httpStatus: 404,
      diagnostics: {
        currentCompanyId: resolvedCompanyId,
        currentCompanyName: companyName || undefined,
        masterSheetId: "",
        signedInEmail: normalizeEmail(sessionActor?.email || ""),
        activeUsersFound: 0,
        dataSource: "users_tab",
      },
    };
  }

  try {
    const rawUsers = await getCompanyUsers(auth, masterSheetId, deps, {
      companyFolderId: resolvedCompanyId,
      companyId: resolvedCompanyId,
    });

    const members = [];
    const seen = new Set();
    for (const row of rawUsers) {
      const member = mapActiveCompanyMember(row, resolvedCompanyId);
      if (!member || seen.has(member.email)) {
        continue;
      }
      seen.add(member.email);
      members.push(member);
    }

    if (
      sessionActor &&
      isActiveSessionActor(sessionActor) &&
      (!String(sessionActor.companyId || sessionActor.companyFolderId || "").trim() ||
        String(sessionActor.companyId || sessionActor.companyFolderId || "").trim() === resolvedCompanyId)
    ) {
      const fallbackMember = buildSessionActorMember(sessionActor, resolvedCompanyId);
      if (fallbackMember && !seen.has(fallbackMember.email)) {
        members.unshift(fallbackMember);
      }
    }

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      users: members,
      activeCount: members.length,
      diagnostics: {
        currentCompanyId: resolvedCompanyId,
        currentCompanyName: companyName || undefined,
        masterSheetId,
        signedInEmail: normalizeEmail(sessionActor?.email || ""),
        activeUsersFound: members.length,
        dataSource: "users_tab",
      },
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "USERS_TAB_READ_FAILED",
      error: "Could not load users from the company workbook.",
      message: "Could not load users from the company workbook.",
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
      diagnostics: {
        currentCompanyId: resolvedCompanyId,
        currentCompanyName: companyName || undefined,
        masterSheetId,
        signedInEmail: normalizeEmail(sessionActor?.email || ""),
        activeUsersFound: 0,
        dataSource: "users_tab",
      },
    };
  }
}

export async function getAssignableUsers(auth, masterSheetId, deps, options = {}) {
  const companyId = String(options.companyId || options.companyFolderId || "").trim();
  const selectedArea = String(options.selectedArea || "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const listed = await listActiveCompanyMembers(auth, deps, {
    companyId,
    companyFolderId: String(options.companyFolderId || companyId).trim(),
    masterSheetId,
    companyName: options.companyName,
    sessionActor: options.sessionActor,
  });

  if (!listed.ok) {
    throw new Error(listed.message || listed.error || "Could not load company users.");
  }

  const mapped = listed.users.map((row) => ({
    email: row.email,
    name: row.name,
    role: row.role,
    accessLevel: row.accessLevel,
    status: row.status,
    companyId: row.companyId || companyId,
    companyFolderId: row.companyFolderId || companyId,
    companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : [],
    companyAreasRaw: row.companyAreasRaw || "",
  }));

  const result = buildAvailableScheduleAssigneesFromUsers(mapped, {
    companyId,
    masterSheetId,
    selectedArea,
    includeDiagnostics,
  });

  return {
    users: mapped,
    assignees: result.assignees,
    auditors: result.auditors,
    diagnostics: result.diagnostics,
  };
}
