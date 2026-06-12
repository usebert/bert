/**
 * Users tab as sole source of truth for active company users.
 * Invite completion, member listing, and login flow through these helpers.
 */
import {
  defaultAccessLevelForRole,
  findCompanyUsersTabRow,
  migrateUsersTabColumns,
  normalizeUserStatus,
  parseCompanyAreas,
  readCompanyUsersTabRecord,
  sanitizeUserRecordForClient,
  verifyCompanyUserPassword,
} from "./company-users.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { inviteAccessLevelForRole, parseRoleForClient } from "../shared/schedule-assignees.mjs";

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

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
  const email = safeLower(row.email || row.Email);
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

function resolveCompanyUsersDeps(deps) {
  if (typeof deps?.getCompanyUsersDeps === "function") {
    return deps.getCompanyUsersDeps();
  }
  return deps || {};
}

/**
 * ACTIVE users only from the company workbook Users tab — no invites, cache, or session merge.
 */
export async function listActiveUsersFromSheet(auth, deps, companyContext = {}) {
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!auth || !masterSheetId) {
    return [];
  }

  const enrichedDeps = {
    ...deps,
    resolveUsersTab: deps.resolveUsersTab || resolveUsersTab,
    migrateUsersTabColumns: deps.migrateUsersTabColumns || migrateUsersTabColumns,
  };

  if (typeof enrichedDeps.migrateUsersTabColumns === "function" && enrichedDeps.getTabValues) {
    await enrichedDeps.migrateUsersTabColumns(auth, masterSheetId, enrichedDeps).catch(() => null);
  }

  const readResult = await readCompanyUsers(auth, masterSheetId, enrichedDeps, {
    companyFolderId,
    companyId: companyFolderId,
  });
  if (!readResult?.ok || !Array.isArray(readResult.records)) {
    return [];
  }

  const rawUsers = readResult.records.map((row) => mapUsersTabRow(row, companyFolderId));
  const members = [];
  const seen = new Set();
  for (const row of rawUsers) {
    const member = mapActiveCompanyMember(row, companyFolderId);
    if (!member || seen.has(member.email)) {
      continue;
    }
    seen.add(member.email);
    members.push(member);
  }
  return members;
}

/**
 * Login eligibility — ACTIVE Users tab row with verifiable PasswordHash only.
 */
export async function canLoginCompanyUser(auth, email, password, companyContext = {}, deps = {}) {
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const emailNorm = safeLower(email);
  const pwd = String(password || "");
  if (!auth || !masterSheetId || !emailNorm || !pwd) {
    return { ok: false, reason: "missing_fields" };
  }

  const userDeps = resolveCompanyUsersDeps(deps);
  if (typeof userDeps.migrateUsersTabColumns === "function") {
    await userDeps.migrateUsersTabColumns(auth, masterSheetId, userDeps).catch(() => null);
  }

  const row = await findCompanyUsersTabRow(auth, masterSheetId, emailNorm, userDeps).catch(() => null);
  if (!row) {
    return { ok: false, reason: "user_not_found" };
  }

  const login = await verifyCompanyUserPassword(auth, masterSheetId, emailNorm, pwd, userDeps);
  if (!login.ok) {
    return { ok: false, reason: login.reason || "invalid_credentials", status: login.status };
  }

  const rec =
    login.rec || (await readCompanyUsersTabRecord(auth, masterSheetId, emailNorm, userDeps));
  if (!rec || rec.status !== "ACTIVE") {
    return { ok: false, reason: "inactive", status: rec?.status };
  }

  return { ok: true, user: sanitizeUserRecordForClient(rec), migrated: Boolean(login.migrated) };
}

/**
 * Invite acceptance — write ACTIVE Users tab row (preserve CreatedAt), then verify login-ready.
 */
export async function completeInviteToUserRow(auth, invite, formData, deps) {
  const { writeCompanyUsers } = deps;
  if (typeof writeCompanyUsers !== "function") {
    return { ok: false, reason: "write_unavailable" };
  }

  const email = safeLower(invite?.email);
  const masterSheetId = String(invite?.masterSheetId || "").trim();
  const companyFolderId = String(invite?.companyFolderId || invite?.companyId || "").trim();
  const fullName = String(formData?.fullName || formData?.name || "").trim();
  const password = String(formData?.password || "");
  const role = String(invite?.role || "").trim();
  if (!email || !masterSheetId || !companyFolderId || !fullName || password.length < 8 || !role) {
    return { ok: false, reason: "missing_fields" };
  }

  const userDeps = resolveCompanyUsersDeps(deps);
  const existing = await findCompanyUsersTabRow(auth, masterSheetId, email, userDeps).catch(() => null);
  const createdAt =
    String(existing?.createdAt || invite?.createdAt || invite?.sentAt || "").trim() ||
    new Date().toISOString();
  const userId =
    String(existing?.userId || "").trim() ||
    `app-${email.replace(/[^a-z0-9]+/gi, "-")}-${role.toLowerCase()}`;
  const accessLevel =
    String(invite?.accessLevel || "").trim() ||
    defaultAccessLevelForRole(role) ||
    inviteAccessLevelForRole(role);

  const usersResult = await writeCompanyUsers(auth, masterSheetId, companyFolderId, [
    {
      id: userId,
      email,
      role,
      name: fullName,
      password,
      accessLevel,
      companyAreas: String(invite?.companyAreas || "").trim(),
      invitedBy: invite?.invitedBy || "",
      senderEmail: "",
      sentAt: createdAt,
      CreatedAt: createdAt,
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      syncStatus: "Synced",
    },
  ]);

  if (!Number(usersResult?.written || 0)) {
    return { ok: false, reason: "write_failed" };
  }

  const loginCheck = await canLoginCompanyUser(
    auth,
    email,
    password,
    { masterSheetId, companyFolderId },
    deps,
  );
  if (!loginCheck.ok) {
    return { ok: false, reason: loginCheck.reason || "login_not_ready" };
  }

  return { ok: true, user: loginCheck.user };
}
