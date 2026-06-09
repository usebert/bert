/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import { parseCompanyAreas, sanitizeUsersTabRecords, migrateUsersTabColumns } from "./company-users.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";

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
    companyId: pickRowValue(row, "Company ID", "CompanyId", "companyId") || companyFolderId,
    companyAreas: parseCompanyAreas(companyAreasRaw),
    companyAreasRaw,
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

export async function getAssignableUsers(auth, masterSheetId, deps, options = {}) {
  const users = await getCompanyUsers(auth, masterSheetId, deps, options);
  const companyId = String(options.companyId || options.companyFolderId || "").trim();
  const selectedArea = String(options.selectedArea || "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const mapped = users.map((row) => ({
    email: row.email || row.Email,
    name: row.name || row.Name,
    role: row.role || row.Role,
    accessLevel: row.accessLevel || row.AccessLevel,
    status: row.status || row.Status,
    companyId: row.companyId || row["Company ID"] || companyId,
    companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : parseCompanyAreas(row.companyAreasRaw || row.CompanyAreas || ""),
    companyAreasRaw: row.companyAreasRaw || String(row.CompanyAreas || ""),
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
