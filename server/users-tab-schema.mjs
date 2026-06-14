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
  return pickField(obj, "CompanyId", "CompanyFolderId", "Company ID", "companyId", "companyFolderId");
}

export function pickRowCompanyFolderId(obj) {
  return pickField(obj, "CompanyFolderId", "CompanyId", "Company ID", "companyFolderId", "companyId");
}

export function pickRowCompanyName(obj) {
  return pickField(obj, "Company", "company", "companyName");
}

export function backfillRowCompanyFields(obj, companyContext = {}) {
  const folderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyName = String(companyContext.companyName || "").trim();
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const next = { ...obj };
  if (!pickRowCompanyName(obj) && companyName) {
    next.Company = companyName;
  }
  const rowCompanyId = pickRowCompanyId(next);
  const rowFolderId = pickRowCompanyFolderId(next) || rowCompanyId;
  const legacyWorkbookId =
    folderId &&
    masterSheetId &&
    rowCompanyId &&
    rowCompanyId !== folderId &&
    rowFolderId !== folderId &&
    (rowCompanyId === masterSheetId || rowFolderId === masterSheetId);
  if (!rowCompanyId && folderId) {
    next.CompanyId = folderId;
    next.CompanyFolderId = folderId;
  } else if (legacyWorkbookId) {
    next.CompanyId = folderId;
    next.CompanyFolderId = folderId;
  }
  return next;
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
  return false;
}

export function rowPointsToOtherCompany(row, companyContext = {}) {
  return !rowMatchesCompanyContext(row, companyContext);
}
