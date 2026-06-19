/**
 * Users tab row schema — shifted legacy detection, header-name remapping, client sanitization.
 * Kept separate from company-users.mjs to avoid circular imports with users-tab-reader.
 */
import { isUserAuthScryptHash } from "./userauth-password.mjs";

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function pickField(obj, ...keys) {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) {
      return String(obj[key]).trim();
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keys.some((key) => safeLower(k) === safeLower(key)) && String(v || "").trim()) {
      return String(v).trim();
    }
  }
  return "";
}

function headerMatchesAlias(header, alias) {
  return safeLower(header) === safeLower(alias);
}

/** First matching column index (left-to-right) for canonical reads like Email/Name. */
function firstHeaderIndex(headers, ...aliases) {
  const list = Array.isArray(headers) ? headers : [];
  for (let index = 0; index < list.length; index += 1) {
    const header = String(list[index] || "").trim();
    if (!header) {
      continue;
    }
    if (aliases.some((alias) => headerMatchesAlias(header, alias))) {
      return index;
    }
  }
  return -1;
}

/** Last matching column index (right-to-left) — appended CompanyId/CompanyFolderId win on wide sheets. */
function lastHeaderIndex(headers, ...aliases) {
  const list = Array.isArray(headers) ? headers : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const header = String(list[index] || "").trim();
    if (!header) {
      continue;
    }
    if (aliases.some((alias) => headerMatchesAlias(header, alias))) {
      return index;
    }
  }
  return -1;
}

function cellAt(headers, row, index) {
  if (index < 0) {
    return "";
  }
  return String((Array.isArray(row) ? row[index] : undefined) ?? "").trim();
}

function pickFirstByHeaders(headers, row, ...aliases) {
  return cellAt(headers, row, firstHeaderIndex(headers, ...aliases));
}

function pickLastByHeaders(headers, row, ...aliases) {
  for (const alias of aliases) {
    const value = cellAt(headers, row, lastHeaderIndex(headers, alias));
    if (value) {
      return value;
    }
  }
  return "";
}

function companyNamesMatch(left, right) {
  const a = safeLower(left);
  const b = safeLower(right);
  return Boolean(a && b && a === b);
}

/**
 * Build a Users tab row object by header name — first canonical match for identity cols,
 * last non-empty match for duplicate CompanyId / CompanyFolderId / legacy Company ID cols.
 */
export function buildUsersTabRowObject(headers, row) {
  const headerRow = (Array.isArray(headers) ? headers : []).map((value, index) =>
    String(value || `Column ${index + 1}`).trim(),
  );
  const dataRow = Array.isArray(row) ? row : [];
  const raw = headerRow.reduce((accumulator, header, index) => {
    accumulator[header] = cellAt(headerRow, dataRow, index);
    return accumulator;
  }, {});

  const companyFolderId = pickLastByHeaders(headerRow, dataRow, "CompanyFolderId", "companyFolderId");
  const companyId =
    pickLastByHeaders(headerRow, dataRow, "CompanyId", "companyId") ||
    pickLastByHeaders(headerRow, dataRow, "Company ID", "companyId");
  const company = pickLastByHeaders(headerRow, dataRow, "Company", "company", "companyName");

  return {
    ...raw,
    Email: pickFirstByHeaders(headerRow, dataRow, "Email", "email"),
    Name:
      pickFirstByHeaders(headerRow, dataRow, "Name", "name") ||
      pickFirstByHeaders(headerRow, dataRow, "Full Name", "Full name"),
    Role: pickFirstByHeaders(headerRow, dataRow, "Role", "role"),
    AccessLevel: pickFirstByHeaders(headerRow, dataRow, "AccessLevel", "Access Level", "accessLevel"),
    Status: pickFirstByHeaders(headerRow, dataRow, "Status", "status"),
    CompanyAreas: pickFirstByHeaders(headerRow, dataRow, "CompanyAreas", "Company Areas", "companyAreas"),
    PasswordHash: pickFirstByHeaders(headerRow, dataRow, "PasswordHash", "passwordHash"),
    CreatedAt: pickFirstByHeaders(headerRow, dataRow, "CreatedAt", "Created At", "createdAt"),
    UpdatedAt: pickFirstByHeaders(headerRow, dataRow, "UpdatedAt", "Updated At", "updatedAt"),
    Company: company,
    CompanyId: companyId,
    CompanyFolderId: companyFolderId || companyId,
    "Company ID": pickLastByHeaders(headerRow, dataRow, "Company ID"),
  };
}

export function isPasswordHash(value) {
  return isUserAuthScryptHash(value);
}

function looksLikePasswordHash(value) {
  const s = String(value || "").trim();
  return s.startsWith("scrypt$") || isUserAuthScryptHash(s);
}

export function isValidCompanyUserEmail(email) {
  const normalized = safeLower(email);
  return normalized.includes("@") && normalized.length > 3 && !/\s/.test(normalized);
}

export function normalizeUserStatus(value) {
  const s = safeLower(value);
  if (s === "inactive" || s === "disabled") {
    return "INACTIVE";
  }
  if (s === "invited" || s === "pending") {
    return "INVITED";
  }
  if (s === "active" || !s) {
    return "ACTIVE";
  }
  return s.toUpperCase();
}

export function parseRoleFromUsersSheet(raw) {
  const r = safeLower(raw).replace(/\s+/g, " ");
  if (r === "master") {
    return "Master";
  }
  if (r === "admin" || r === "administrator" || r === "owner" || r === "company admin") {
    return "Admin";
  }
  if (r === "manager") {
    return "Manager";
  }
  if (r === "auditor") {
    return "Auditor";
  }
  if (r === "user") {
    return "User";
  }
  return "";
}

export function isShiftedLegacyUsersRow(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const emailHeaderCol = pickField(obj, "Email");
  if (isValidCompanyUserEmail(emailHeaderCol)) {
    return false;
  }
  const emailInRoleCol = pickField(obj, "Role");
  if (!isValidCompanyUserEmail(emailInRoleCol)) {
    return false;
  }
  const statusInCreatedAt = normalizeUserStatus(pickField(obj, "CreatedAt"));
  const hashInUpdatedAt = looksLikePasswordHash(pickField(obj, "UpdatedAt"));
  return statusInCreatedAt === "ACTIVE" || hashInUpdatedAt;
}

export function normalizeRoleForSheetRepair(role) {
  const r = safeLower(role).replace(/\s+/g, " ");
  if (r === "admin" || r === "administrator" || r === "owner" || r === "company admin") {
    return "Company Admin";
  }
  if (r === "master") {
    return "Master";
  }
  if (r === "manager") {
    return "Manager";
  }
  if (r === "auditor") {
    return "Auditor";
  }
  if (r === "user") {
    return "User";
  }
  const parsed = parseRoleFromUsersSheet(role);
  if (parsed === "Admin") {
    return "Company Admin";
  }
  return parsed || String(role || "").trim();
}

export function remapShiftedLegacyUsersRow(obj) {
  if (!isShiftedLegacyUsersRow(obj)) {
    return { ...obj };
  }
  const passwordHash = looksLikePasswordHash(pickField(obj, "UpdatedAt"))
    ? pickField(obj, "UpdatedAt")
    : pickField(obj, "PasswordHash");
  const createdAtRaw = pickField(obj, "CreatedAt");
  const createdAt =
    createdAtRaw && normalizeUserStatus(createdAtRaw) !== "ACTIVE" ? createdAtRaw : pickField(obj, "InvitedAt");
  return {
    ...obj,
    "User ID": pickField(obj, "User ID") || pickField(obj, "Email"),
    "Company ID": pickField(obj, "Company ID") || pickField(obj, "Name"),
    Email: pickField(obj, "Role"),
    Name: pickField(obj, "AccessLevel") || pickField(obj, "Name"),
    Role: normalizeRoleForSheetRepair(pickField(obj, "Status")),
    AccessLevel: pickField(obj, "CompanyAreas") || pickField(obj, "AccessLevel"),
    CompanyAreas:
      pickField(obj, "PasswordHash") && !looksLikePasswordHash(pickField(obj, "PasswordHash"))
        ? pickField(obj, "PasswordHash")
        : pickField(obj, "CompanyAreas"),
    Status: normalizeUserStatus(pickField(obj, "CreatedAt") || pickField(obj, "Status")),
    PasswordHash: passwordHash,
    CreatedAt: createdAt,
    UpdatedAt:
      pickField(obj, "UpdatedAt") && !looksLikePasswordHash(pickField(obj, "UpdatedAt"))
        ? pickField(obj, "UpdatedAt")
        : obj.UpdatedAt || "",
  };
}

export function normalizeUsersTabRowObject(obj) {
  return remapShiftedLegacyUsersRow(obj);
}

export function rowEmailCandidates(obj) {
  const remapped = remapShiftedLegacyUsersRow(obj);
  return [pickField(remapped, "Email"), pickField(obj, "Email"), pickField(obj, "Role"), pickField(obj, "Name")]
    .map((value) => safeLower(value))
    .filter((value) => isValidCompanyUserEmail(value));
}

export function mapRecordToSheetHeaders(headers, record) {
  return headers.map((header) => String(record?.[header] ?? "").trim());
}

export function sanitizeUserRecordForClient(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const next = { ...record };
  for (const key of Object.keys(next)) {
    if (safeLower(key) === "passwordhash" || safeLower(key) === "password") {
      delete next[key];
    }
  }
  if ("PasswordHash" in next) {
    next.PasswordHash = "";
  }
  if ("passwordHash" in next) {
    next.passwordHash = "";
  }
  return next;
}

export function sanitizeUsersTabRecords(records) {
  return (Array.isArray(records) ? records : []).map(sanitizeUserRecordForClient);
}

export function pickRowCompanyId(obj) {
  return (
    pickField(obj, "CompanyFolderId", "companyFolderId") ||
    pickField(obj, "CompanyId", "companyId") ||
    pickField(obj, "Company ID", "companyId")
  );
}

export function pickRowCompanyFolderId(obj) {
  return (
    pickField(obj, "CompanyFolderId", "companyFolderId") ||
    pickField(obj, "CompanyId", "companyId") ||
    pickField(obj, "Company ID", "companyId")
  );
}

export function pickRowCompanyName(obj) {
  return pickField(obj, "Company", "company", "companyName");
}

/** True when reading rows from a specific company workbook Users tab. */
export function isWorkbookScopedCompanyContext(companyContext = {}) {
  return Boolean(String(companyContext.masterSheetId || "").trim());
}

export function backfillRowCompanyFields(obj, companyContext = {}) {
  const folderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyName = String(companyContext.companyName || "").trim();
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const workbookScoped = isWorkbookScopedCompanyContext(companyContext);
  const next = { ...obj };
  if (!pickRowCompanyName(obj) && companyName) {
    next.Company = companyName;
  }
  const rowCompanyId = pickRowCompanyId(next);
  const rowFolderId = pickRowCompanyFolderId(next) || rowCompanyId;
  const rowCompanyName = pickRowCompanyName(next);
  const nameMatchesContext = companyNamesMatch(rowCompanyName, companyName);
  const legacyWorkbookId =
    folderId &&
    masterSheetId &&
    rowCompanyId &&
    rowCompanyId !== folderId &&
    rowFolderId !== folderId &&
    (rowCompanyId === masterSheetId || rowFolderId === masterSheetId);
  const staleNonFolderId =
    folderId &&
    rowCompanyId &&
    rowCompanyId !== folderId &&
    rowFolderId !== folderId &&
    (nameMatchesContext || workbookScoped);
  if (!rowCompanyId && folderId) {
    next.CompanyId = folderId;
    next.CompanyFolderId = folderId;
  } else if (legacyWorkbookId || staleNonFolderId) {
    next.CompanyId = folderId;
    next.CompanyFolderId = folderId;
  } else if (workbookScoped && folderId && (rowCompanyId !== folderId || rowFolderId !== folderId)) {
    // Rows in this workbook belong to this company — repair stale registry/legacy ids.
    next.CompanyId = folderId;
    next.CompanyFolderId = folderId;
  }
  return next;
}

/**
 * Row explicitly belongs to a different company folder (both id cols agree on another folder).
 * Used only for non-workbook-scoped reads; workbook rows are owned by the sheet's company.
 */
export function rowExplicitlyPointsToOtherCompany(row, companyContext = {}) {
  const folderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!folderId) {
    return false;
  }
  const rowCompanyId = pickRowCompanyId(row);
  if (!rowCompanyId) {
    return false;
  }
  const rowFolderId = pickRowCompanyFolderId(row) || rowCompanyId;
  if (rowCompanyId === folderId || rowFolderId === folderId) {
    return false;
  }
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  if (masterSheetId && (rowCompanyId === masterSheetId || rowFolderId === masterSheetId)) {
    return false;
  }
  const companyName = String(companyContext.companyName || "").trim();
  if (companyNamesMatch(pickRowCompanyName(row), companyName)) {
    return false;
  }
  return rowCompanyId === rowFolderId;
}

/** Blank company cols belong to current context; exclude rows pointing elsewhere. */
export function rowMatchesCompanyContext(row, companyContext = {}) {
  const folderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!folderId) {
    return true;
  }
  const rowCompanyId = pickRowCompanyId(row);
  if (!rowCompanyId) {
    return true;
  }
  const rowFolderId = pickRowCompanyFolderId(row) || rowCompanyId;
  if (rowCompanyId === folderId || rowFolderId === folderId) {
    return true;
  }
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  if (masterSheetId && (rowCompanyId === masterSheetId || rowFolderId === masterSheetId)) {
    return true;
  }
  const companyName = String(companyContext.companyName || "").trim();
  if (companyNamesMatch(pickRowCompanyName(row), companyName)) {
    return true;
  }
  if (isWorkbookScopedCompanyContext(companyContext)) {
    return true;
  }
  return false;
}

export function rowPointsToOtherCompany(row, companyContext = {}) {
  return !rowMatchesCompanyContext(row, companyContext);
}

/** Normalize a mapped profile or raw Users tab row for company backfill/filter helpers. */
export function sheetLikeRowFromProfile(row) {
  if (!row || typeof row !== "object") {
    return {};
  }
  return {
    ...row,
    Email: pickField(row, "Email", "email"),
    Name: pickField(row, "Name", "name", "Full Name"),
    Role: pickField(row, "Role", "role"),
    AccessLevel: pickField(row, "AccessLevel", "Access Level", "accessLevel"),
    Status: pickField(row, "Status", "status"),
    Company: pickField(row, "Company", "company", "companyName"),
    CompanyId: pickField(row, "CompanyId", "Company ID", "companyId"),
    CompanyFolderId: pickField(row, "CompanyFolderId", "Company ID", "companyFolderId"),
    CompanyAreas: pickField(row, "CompanyAreas", "Company Areas", "companyAreas", "companyAreasRaw"),
  };
}

/** Backfill company cols, then apply folder context filter. Workbook reads skip all company-column filtering. */
export function rowPassesCompanyProfileContext(row, companyContext = {}) {
  if (isWorkbookScopedCompanyContext(companyContext)) {
    return true;
  }
  const filled = backfillRowCompanyFields(sheetLikeRowFromProfile(row), companyContext);
  if (rowExplicitlyPointsToOtherCompany(filled, companyContext)) {
    return false;
  }
  return rowMatchesCompanyContext(filled, companyContext);
}

export function resolvedProfileCompanyFolderId(row, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const filled = backfillRowCompanyFields(sheetLikeRowFromProfile(row), companyContext);
  return pickRowCompanyFolderId(filled) || pickRowCompanyId(filled) || companyFolderId;
}
