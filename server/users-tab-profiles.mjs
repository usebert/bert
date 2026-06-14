/**
 * Canonical Users tab → company profile mapping for workbook-scoped reads.
 * Every row with Email + Name in a company workbook Users tab belongs to that company.
 */
import { parseRoleForClient, isExcludedCompanyProfileStatus } from "../shared/schedule-assignees.mjs";
import { parseCompanyAreas, normalizeUserStatus } from "./company-users.mjs";
import {
  backfillRowCompanyFields,
  buildUsersTabRowObject,
  normalizeUsersTabRowObject,
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
  resolvedProfileCompanyFolderId,
  isWorkbookScopedCompanyContext,
  rowPassesCompanyProfileContext,
  sanitizeUserRecordForClient,
} from "./users-tab-schema.mjs";

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

export function mapUsersTabRecordToProfileRow(record, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const filled = backfillRowCompanyFields(record, companyContext);
  const companyAreasRaw = pickRowValue(filled, "CompanyAreas", "Company Areas", "companyAreas");
  const rowCompanyId = pickRowCompanyId(filled) || companyFolderId;
  const rowCompanyFolderId = pickRowCompanyFolderId(filled) || rowCompanyId;
  return {
    email: pickRowValue(filled, "Email", "email"),
    name: pickRowValue(filled, "Name", "name", "Full Name"),
    role: pickRowValue(filled, "Role", "role"),
    accessLevel: pickRowValue(filled, "AccessLevel", "Access Level", "accessLevel"),
    status: pickRowValue(filled, "Status", "status"),
    company: pickRowCompanyName(filled),
    companyId: rowCompanyId,
    companyFolderId: rowCompanyFolderId,
    companyAreas: parseCompanyAreas(companyAreasRaw),
    companyAreasRaw,
  };
}

/**
 * Listable profile gate — workbook rows: email + name + non-deleted status only.
 */
export function isListableUsersTabProfileRow(row, companyContext = {}) {
  const email = safeLower(row.email || row.Email);
  if (!email || !email.includes("@")) {
    return false;
  }
  const name = String(row.name || row.Name || "").trim();
  if (!name) {
    return false;
  }
  const status = normalizeUserStatus(row.status || row.Status);
  if (isExcludedCompanyProfileStatus(status)) {
    return false;
  }
  if (isWorkbookScopedCompanyContext(companyContext)) {
    return true;
  }
  return rowPassesCompanyProfileContext(row, companyContext);
}

export function mapUsersTabProfileMember(row, companyContext = {}) {
  if (!isListableUsersTabProfileRow(row, companyContext)) {
    return null;
  }
  const email = safeLower(row.email || row.Email);
  const name = String(row.name || row.Name || "").trim();
  const status = normalizeUserStatus(row.status || row.Status);
  const companyAreas = Array.isArray(row.companyAreas)
    ? row.companyAreas
    : parseCompanyAreas(row.companyAreasRaw || row.CompanyAreas || row.companyAreas || "");
  const resolvedFolderId = resolvedProfileCompanyFolderId(row, companyContext);
  return sanitizeUserRecordForClient({
    email,
    name,
    role: parseRoleForClient(row.role || row.Role || row.accessLevel || row.AccessLevel || "User"),
    accessLevel: String(row.accessLevel || row.AccessLevel || "").trim(),
    status,
    company: row.company || row.Company || "",
    companyId: resolvedFolderId,
    companyFolderId: resolvedFolderId,
    companyAreas,
    companyAreasRaw: row.companyAreasRaw || String(row.CompanyAreas || ""),
  });
}

/**
 * Map sanitized Users tab records to all listable company profiles (no PasswordHash).
 */
export function listableProfilesFromUsersTabRecords(records, companyContext = {}) {
  const rawUsers = (Array.isArray(records) ? records : []).map((record) =>
    mapUsersTabRecordToProfileRow(record, companyContext),
  );
  const members = [];
  const seen = new Set();
  for (const row of rawUsers) {
    const member = mapUsersTabProfileMember(row, companyContext);
    if (!member || seen.has(member.email)) {
      continue;
    }
    seen.add(member.email);
    members.push(member);
  }
  const activeOnlyCount = members.filter((member) => normalizeUserStatus(member.status) === "ACTIVE").length;
  return {
    members,
    totalSheetRows: rawUsers.length,
    profilesReturned: members.length,
    activeOnlyCount,
    activeSheetUsers: members.length,
  };
}

/** Parse raw header + row arrays (fixture/live sheet values) into listable company profiles. */
export function listProfilesFromUsersTabRows(headers, dataRows, companyContext = {}) {
  const headerRow = Array.isArray(headers) ? headers : [];
  const records = (Array.isArray(dataRows) ? dataRows : []).map((row) =>
    normalizeUsersTabRowObject(buildUsersTabRowObject(headerRow, row)),
  );
  return listableProfilesFromUsersTabRecords(records, companyContext);
}
