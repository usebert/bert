/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import { parseCompanyAreas, sanitizeUsersTabRecords, migrateUsersTabColumns } from "./company-users.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";

function mapUsersTabRow(row, companyFolderId = "") {
  return {
    email: String(row.Email || row.email || "").trim(),
    name: String(row.Name || row.name || row["Full Name"] || "").trim(),
    role: String(row.Role || row.role || "").trim(),
    accessLevel: String(row.AccessLevel || row.accessLevel || "").trim(),
    status: String(row.Status || row.status || "").trim(),
    companyId: String(row["Company ID"] || row.companyId || companyFolderId || "").trim(),
    companyAreas: parseCompanyAreas(String(row.CompanyAreas || row.companyAreas || "")),
    companyAreasRaw: String(row.CompanyAreas || row.companyAreas || "").trim(),
  };
}

export async function getCompanyUsers(auth, masterSheetId, deps, options = {}) {
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId || !auth) {
    return [];
  }
  const { readCompanySheetById } = deps;
  if (typeof readCompanySheetById !== "function") {
    return [];
  }
  if (typeof migrateUsersTabColumns === "function" && deps.getTabValues) {
    await migrateUsersTabColumns(auth, sheetId, deps).catch(() => null);
  }
  const payload = await readCompanySheetById(auth, sheetId);
  const rawUsers = Array.isArray(payload?.data?.Users) ? payload.data.Users : [];
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
