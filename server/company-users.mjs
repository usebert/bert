/**
 * Company workbook Users tab — login credentials (PasswordHash), roles, and area access.
 * Never expose PasswordHash to API clients; migrate legacy Config UserAuth.* on login.
 */
import { hashPassword, verifyPassword } from "./master-auth.mjs";
import { isUserAuthScryptHash } from "./userauth-password.mjs";
import {
  USERS_TAB,
  USERS_TAB_COLUMNS,
  USERS_TAB_REQUIRED_COLUMNS,
} from "./users-tab-constants.mjs";
import {
  isPasswordHash as schemaIsPasswordHash,
  isShiftedLegacyUsersRow,
  isValidCompanyUserEmail,
  mapRecordToSheetHeaders,
  normalizeRoleForSheetRepair,
  normalizeUserStatus as schemaNormalizeUserStatus,
  normalizeUsersTabRowObject,
  parseRoleFromUsersSheet as schemaParseRoleFromUsersSheet,
  remapShiftedLegacyUsersRow,
  rowEmailCandidates,
  sanitizeUserRecordForClient,
  sanitizeUsersTabRecords,
  backfillRowCompanyFields,
  pickRowCompanyId,
  pickRowCompanyFolderId,
  pickRowCompanyName,
} from "./users-tab-schema.mjs";

export {
  USERS_TAB,
  USERS_TAB_COLUMNS,
  USERS_TAB_REQUIRED_COLUMNS,
  isShiftedLegacyUsersRow,
  isValidCompanyUserEmail,
  normalizeRoleForSheetRepair,
  normalizeUsersTabRowObject,
  remapShiftedLegacyUsersRow,
  sanitizeUserRecordForClient,
  sanitizeUsersTabRecords,
};

export function isPasswordHash(value) {
  return schemaIsPasswordHash(value);
}

export function managerInvitesEnabled(env = process.env) {
  return String(env.BERT_ENABLE_MANAGER_INVITES || "").trim().toLowerCase() === "true";
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseCompanyAreas(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function defaultAccessLevelForRole(role) {
  const r = safeLower(role);
  if (r === "admin" || r === "master") {
    return "full";
  }
  return "operational";
}

export function normalizeUserStatus(value) {
  return schemaNormalizeUserStatus(value);
}

export function parseRoleFromUsersSheet(raw) {
  return schemaParseRoleFromUsersSheet(raw);
}

/** Persisted Users tab Role column — never store platform Master as a company role. */
export function normalizeCompanyUserRoleForSheet(role) {
  const parsed = parseRoleFromUsersSheet(role);
  if (parsed === "Master") {
    return "";
  }
  return parsed;
}

export function validateCompanyUserEditInput(input = {}) {
  const errors = [];
  const name =
    input.name !== undefined && input.name !== null ? String(input.name).trim() : undefined;
  if (name !== undefined && !name) {
    errors.push("name_required");
  }
  let role;
  if (input.role !== undefined && input.role !== null && String(input.role).trim()) {
    role = normalizeCompanyUserRoleForSheet(input.role);
    if (!role) {
      errors.push("invalid_role");
    }
  }
  let status;
  if (input.status !== undefined && input.status !== null && String(input.status).trim()) {
    status = normalizeUserStatus(input.status);
    if (!["ACTIVE", "INACTIVE", "INVITED"].includes(status)) {
      errors.push("invalid_status");
    }
  }
  return { ok: errors.length === 0, errors, name, role, status };
}

export async function updateCompanyUserRecord(auth, spreadsheetId, email, updates, deps) {
  const emailNorm = safeLower(email);
  if (!isValidCompanyUserEmail(emailNorm)) {
    return { ok: false, reason: "invalid_email" };
  }

  const validated = validateCompanyUserEditInput(updates);
  if (!validated.ok) {
    return { ok: false, reason: validated.errors[0] || "invalid_input" };
  }

  if (typeof deps.migrateUsersTabColumns === "function") {
    await deps.migrateUsersTabColumns(auth, spreadsheetId, deps).catch(() => null);
  }

  const match = await findCompanyUsersTabRow(auth, spreadsheetId, emailNorm, deps);
  if (!match) {
    return { ok: false, reason: "user_not_found" };
  }

  const now = new Date().toISOString();
  const patch = { UpdatedAt: now };

  if (validated.name !== undefined) {
    patch.Name = validated.name;
    patch["Full Name"] = validated.name;
  }
  if (validated.role) {
    patch.Role = validated.role;
    patch.AccessLevel = defaultAccessLevelForRole(validated.role);
  }
  if (validated.status) {
    patch.Status = validated.status;
  }
  if (updates.companyAreas !== undefined) {
    const areas = Array.isArray(updates.companyAreas)
      ? updates.companyAreas.map((part) => String(part || "").trim()).filter(Boolean)
      : parseCompanyAreas(updates.companyAreas);
    patch.CompanyAreas = areas.join(", ");
  }

  await writeUsersRowPatch(auth, spreadsheetId, match, patch, deps);

  const rec = await readCompanyUsersTabRecord(auth, spreadsheetId, emailNorm, deps);
  if (!rec) {
    return { ok: false, reason: "user_not_found" };
  }
  return { ok: true, user: rec };
}

function headerIndex(headers, ...names) {
  for (const name of names) {
    const idx = headers.findIndex((h) => safeLower(h) === safeLower(name));
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, idx) => {
    obj[h] = String(row[idx] || "").trim();
  });
  return obj;
}

function pickField(obj, ...keys) {
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

async function resolveUsersTabTitle(auth, spreadsheetId, deps, options = {}) {
  if (deps.usersTabTitle) {
    return String(deps.usersTabTitle).trim();
  }
  if (typeof deps.resolveUsersTab === "function") {
    const resolved = await deps.resolveUsersTab(auth, spreadsheetId, deps, options);
    return String(resolved?.tabTitle || USERS_TAB).trim() || USERS_TAB;
  }
  return USERS_TAB;
}

export async function findCompanyUsersTabRow(auth, spreadsheetId, email, deps) {
  const { getTabValues } = deps;
  const tabTitle = await resolveUsersTabTitle(auth, spreadsheetId, deps, { createIfMissing: false });
  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  if (!rows.length) {
    return null;
  }
  const headers = rows[0].map((cell) => String(cell || "").trim());
  const target = safeLower(email);
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const rawObj = rowToObject(headers, row);
    const obj = normalizeUsersTabRowObject(rawObj);
    const candidates = rowEmailCandidates(rawObj);
    if (!candidates.includes(target)) {
      continue;
    }
    const rowEmail = pickField(obj, "Email") || target;
    const roleRaw = pickField(obj, "Role", "role");
    const fullName =
      pickField(obj, "Name", "name", "Full Name", "Full name") || rowEmail;
    const companyId = pickRowCompanyId(obj) || pickField(obj, "Company ID", "companyId");
    const companyFolderId = pickRowCompanyFolderId(obj) || companyId;
    const companyName = pickRowCompanyName(obj);
    const status = normalizeUserStatus(pickField(obj, "Status", "status"));
    const accessLevel =
      pickField(obj, "AccessLevel", "Access Level", "accessLevel") ||
      defaultAccessLevelForRole(parseRoleFromUsersSheet(roleRaw));
    const companyAreasRaw = pickField(obj, "CompanyAreas", "Company Areas", "companyAreas");
    const updatedAtVal = pickField(obj, "UpdatedAt");
    const passwordHash =
      String(updatedAtVal).startsWith("scrypt$") || isPasswordHash(updatedAtVal)
        ? updatedAtVal
        : pickField(obj, "PasswordHash", "passwordHash");
    return {
      sheetRowIndex: i,
      headers,
      email: safeLower(rowEmail),
      roleRaw,
      name: fullName,
      companyId,
      companyFolderId,
      companyName,
      userId: pickField(obj, "User ID", "userId"),
      status,
      accessLevel,
      companyAreas: parseCompanyAreas(companyAreasRaw),
      companyAreasRaw,
      passwordHash,
      invitedAt: pickField(obj, "InvitedAt", "Invited At"),
      createdAt: pickField(obj, "CreatedAt", "Created At"),
      updatedAt: pickField(obj, "UpdatedAt", "Updated At"),
      rowObject: obj,
      shiftedLegacy: isShiftedLegacyUsersRow(rawObj),
    };
  }
  return null;
}

export async function readCompanyUsersTabRecord(auth, spreadsheetId, email, deps) {
  const row = await findCompanyUsersTabRow(auth, spreadsheetId, email, deps);
  if (!row) {
    return null;
  }
  const role = parseRoleFromUsersSheet(row.roleRaw);
  if (!role) {
    return null;
  }
  return {
    role,
    name: row.name || row.email,
    email: row.email,
    status: row.status,
    accessLevel: row.accessLevel,
    companyAreas: row.companyAreas,
    companyId: row.companyId || row.companyFolderId,
    companyFolderId: row.companyFolderId || row.companyId,
    companyName: row.companyName,
    userId: row.userId,
    passwordHash: row.passwordHash,
    sheetRowIndex: row.sheetRowIndex,
    headers: row.headers,
    rowObject: row.rowObject,
  };
}

async function readUsersTabHeaders(auth, spreadsheetId, deps) {
  const { getTabValues, ensureColumns } = deps;
  const tabTitle = await resolveUsersTabTitle(auth, spreadsheetId, deps, { createIfMissing: true });
  await ensureColumns(auth, spreadsheetId, tabTitle, USERS_TAB_COLUMNS);
  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  const headers = (rows[0] || USERS_TAB_COLUMNS).map((cell) => String(cell || "").trim()).filter(Boolean);
  return { tabTitle, headers, rows };
}

async function writeUsersRowPatch(auth, spreadsheetId, match, patch, deps) {
  const { google, withSheetsQuotaRetry } = deps;
  const { tabTitle, headers } = await readUsersTabHeaders(auth, spreadsheetId, deps);
  const sheetHeaders = match.headers?.length ? match.headers : headers;
  const current = normalizeUsersTabRowObject(match.rowObject || {});
  const nextRecord = { ...current, ...patch };
  const nextRow = mapRecordToSheetHeaders(sheetHeaders, nextRecord);
  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabTitle}!A${match.sheetRowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [nextRow] },
    }),
  );
}

/** Write or update a Users tab row using actual sheet header order (never positional TAB_COLUMNS). */
export async function writeUsersTabRecordByHeaders(auth, spreadsheetId, record, deps, options = {}) {
  const { google, withSheetsQuotaRetry } = deps;
  const emailNorm = safeLower(record.Email || record.email);
  if (!isValidCompanyUserEmail(emailNorm)) {
    return { ok: false, reason: "invalid_email" };
  }
  const { tabTitle, headers, rows } = await readUsersTabHeaders(auth, spreadsheetId, deps);
  const target = emailNorm;
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i += 1) {
    const rawObj = rowToObject(headers, rows[i]);
    if (rowEmailCandidates(rawObj).includes(target)) {
      rowIndex = i;
      break;
    }
  }
  const existingObj = rowIndex >= 0 ? normalizeUsersTabRowObject(rowToObject(headers, rows[rowIndex])) : {};
  const companyContext = options.companyContext || {};
  const withCompany = backfillRowCompanyFields(
    {
      ...existingObj,
      ...record,
      Email: emailNorm,
      Company: record.Company || record.companyName || existingObj.Company || companyContext.companyName || "",
      CompanyId:
        record.CompanyId ||
        record.companyId ||
        existingObj.CompanyId ||
        companyContext.companyFolderId ||
        companyContext.companyId ||
        "",
      CompanyFolderId:
        record.CompanyFolderId ||
        record.companyFolderId ||
        existingObj.CompanyFolderId ||
        companyContext.companyFolderId ||
        companyContext.companyId ||
        "",
    },
    companyContext,
  );
  const nextRecord = withCompany;
  const nextRow = mapRecordToSheetHeaders(headers, nextRecord);
  const sheets = google.sheets({ version: "v4", auth });
  if (rowIndex === -1) {
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabTitle}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [nextRow] },
      }),
    );
  } else {
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabTitle}!A${rowIndex + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [nextRow] },
      }),
    );
  }
  if (options.validate !== false) {
    const verified = await findCompanyUsersTabRow(auth, spreadsheetId, emailNorm, deps);
    if (!verified || !isValidCompanyUserEmail(verified.email)) {
      return { ok: false, reason: "write_validation_failed" };
    }
    if (record.PasswordHash && verified.passwordHash !== String(record.PasswordHash).trim()) {
      return { ok: false, reason: "password_hash_mismatch" };
    }
  }
  return { ok: true, email: emailNorm, updated: rowIndex >= 0, appended: rowIndex === -1 };
}

export async function setCompanyUserPasswordHash(auth, spreadsheetId, email, plainPassword, deps) {
  const emailNorm = safeLower(email);
  let match = await findCompanyUsersTabRow(auth, spreadsheetId, emailNorm, deps);
  const now = new Date().toISOString();
  const hashed = hashPassword(plainPassword);
  if (!match) {
    return { ok: false, reason: "user_not_found" };
  }
  await writeUsersRowPatch(
    auth,
    spreadsheetId,
    match,
    {
      PasswordHash: hashed,
      PasswordUpdatedAt: now,
      Status: "ACTIVE",
      UpdatedAt: now,
    },
    deps,
  );
  const userAuthKey = `UserAuth.${emailNorm}`;
  const { getConfig, updateConfig } = deps;
  const cfg = await getConfig(auth, spreadsheetId);
  if (cfg[userAuthKey]) {
    const next = { ...cfg };
    delete next[userAuthKey];
    await updateConfig(auth, spreadsheetId, next);
  }
  return { ok: true, migratedUserAuth: Boolean(cfg[userAuthKey]) };
}

export async function touchCompanyUserLastLogin(auth, spreadsheetId, email, deps) {
  const match = await findCompanyUsersTabRow(auth, spreadsheetId, email, deps);
  if (!match) {
    return;
  }
  const now = new Date().toISOString();
  await writeUsersRowPatch(auth, spreadsheetId, match, { LastLoginAt: now, UpdatedAt: now }, deps);
}

/**
 * Migrate legacy Config UserAuth.<email> into Users.PasswordHash when the row has no hash yet.
 */
export async function migrateUserAuthToPasswordHash(auth, spreadsheetId, email, deps) {
  const emailNorm = safeLower(email);
  const match = await findCompanyUsersTabRow(auth, spreadsheetId, emailNorm, deps);
  if (!match || match.passwordHash) {
    return { migrated: false };
  }
  const { getConfig } = deps;
  const cfg = await getConfig(auth, spreadsheetId);
  const key = `UserAuth.${emailNorm}`;
  const stored = cfg[key];
  if (!stored || !String(stored).trim()) {
    return { migrated: false };
  }
  const now = new Date().toISOString();
  let hashed = stored;
  if (!isPasswordHash(stored)) {
    hashed = hashPassword(stored);
  }
  await writeUsersRowPatch(
    auth,
    spreadsheetId,
    match,
    {
      PasswordHash: hashed,
      PasswordUpdatedAt: now,
      Status: match.status === "INVITED" ? "ACTIVE" : match.status || "ACTIVE",
      UpdatedAt: now,
    },
    deps,
  );
  const { updateConfig } = deps;
  const next = { ...cfg };
  delete next[key];
  await updateConfig(auth, spreadsheetId, next);
  return { migrated: true };
}

export async function verifyCompanyUserPassword(auth, spreadsheetId, email, plainPassword, deps) {
  const emailNorm = safeLower(email);
  let rec = await readCompanyUsersTabRecord(auth, spreadsheetId, emailNorm, deps);
  if (!rec) {
    return { ok: false, reason: "user_not_found" };
  }
  if (rec.status !== "ACTIVE") {
    return { ok: false, reason: "inactive", status: rec.status };
  }
  if (!rec.passwordHash) {
    await migrateUserAuthToPasswordHash(auth, spreadsheetId, emailNorm, deps);
    rec = await readCompanyUsersTabRecord(auth, spreadsheetId, emailNorm, deps);
  }
  if (!rec?.passwordHash) {
    return { ok: false, reason: "setup_incomplete" };
  }
  const stored = rec.passwordHash;
  if (!isPasswordHash(stored)) {
    if (String(stored) !== String(plainPassword)) {
      return { ok: false, reason: "invalid_credentials" };
    }
    await setCompanyUserPasswordHash(auth, spreadsheetId, emailNorm, plainPassword, deps);
    return { ok: true, migrated: true, rec: await readCompanyUsersTabRecord(auth, spreadsheetId, emailNorm, deps) };
  }
  if (!verifyPassword(plainPassword, stored)) {
    return { ok: false, reason: "invalid_credentials" };
  }
  return { ok: true, rec };
}

export async function companyUserLoginReady(auth, spreadsheetId, email, deps) {
  if (!auth || !spreadsheetId || !email) {
    return false;
  }
  try {
    const rec = await readCompanyUsersTabRecord(auth, spreadsheetId, email, deps);
    if (!rec || rec.status !== "ACTIVE") {
      return false;
    }
    return Boolean(rec.passwordHash && isPasswordHash(rec.passwordHash));
  } catch {
    return false;
  }
}

/**
 * Ensure required Users tab columns exist and backfill Name/Status/etc. from legacy fields.
 */
export async function resolveCompanyUserEmailByHash(auth, spreadsheetId, emailHash, hashEmailFn, deps) {
  const { getTabValues, getConfig } = deps;
  const cfg = await getConfig(auth, spreadsheetId);
  for (const [key, value] of Object.entries(cfg)) {
    if (!key.toLowerCase().startsWith("userauth.") || !String(value || "").trim()) {
      continue;
    }
    const email = safeLower(key.slice("UserAuth.".length));
    if (email && hashEmailFn(email) === emailHash) {
      return email;
    }
  }
  const tabTitle = await resolveUsersTabTitle(auth, spreadsheetId, deps, { createIfMissing: false });
  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  if (!rows.length) {
    return "";
  }
  const headers = rows[0].map((cell) => safeLower(cell));
  const emailIdx = headers.findIndex((h) => h === "email");
  if (emailIdx === -1) {
    return "";
  }
  for (let i = 1; i < rows.length; i += 1) {
    const rowEmail = safeLower(rows[i][emailIdx]);
    if (rowEmail && hashEmailFn(rowEmail) === emailHash) {
      return rowEmail;
    }
  }
  return "";
}

/**
 * Resolve company workspace context for a signed-in company user.
 * Scans LIVE companies in the main registry + fallback registry, matching ACTIVE Users tab rows by email.
 * Invite-stored masterSheetId hints are tried first.
 */
export async function resolveCompanyContextForUser(auth, email, deps) {
  const emailNorm = safeLower(email);
  if (!emailNorm || !auth) {
    return null;
  }

  const {
    findMasterSheetIdsForCompanyLoginEmail,
    readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive,
    migrateUsersTabColumns: migrateColumns,
    readCompanyUsersTabRecord: readUsersRecord,
  } = deps;

  if (typeof findMasterSheetIdsForCompanyLoginEmail !== "function") {
    return null;
  }

  const inviteSheetIds = findMasterSheetIdsForCompanyLoginEmail(emailNorm) || [];
  const registryResult = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
    map: new Map(),
  }));
  const registryMap = registryResult?.map instanceof Map ? registryResult.map : new Map();

  /** @type {Map<string, { companyId: string, companyName: string, companyFolderId: string, masterSheetId: string, registryStatus: string, registrySource: string, priority: number }>} */
  const candidateBySheet = new Map();

  const addCandidate = (candidate, priority) => {
    const masterSheetId = String(candidate.masterSheetId || "").trim();
    if (!masterSheetId) {
      return;
    }
    const existing = candidateBySheet.get(masterSheetId);
    if (!existing || existing.priority > priority) {
      candidateBySheet.set(masterSheetId, { ...candidate, masterSheetId, priority });
    }
  };

  for (const sheetId of inviteSheetIds) {
    let matchedRegistry = false;
    for (const [companyId, record] of registryMap.entries()) {
      const recMaster = String(record.masterSheetId || "").trim();
      if (recMaster !== sheetId) {
        continue;
      }
      matchedRegistry = true;
      addCandidate(
        {
          companyId: String(companyId || record.companyId || "").trim(),
          companyName: String(record.companyName || record.name || "").trim(),
          companyFolderId: String(record.companyFolderId || record.rootFolderId || companyId || "").trim(),
          masterSheetId: recMaster,
          registryStatus: String(record.status || record.registryStatus || "").trim(),
          registrySource: String(record.registrySource || "main"),
        },
        0,
      );
    }
    if (!matchedRegistry) {
      addCandidate(
        {
          companyId: "",
          companyName: "",
          companyFolderId: "",
          masterSheetId: sheetId,
          registryStatus: "",
          registrySource: "invite",
        },
        0,
      );
    }
  }

  for (const [companyId, record] of registryMap.entries()) {
    if (typeof isCompanyRegistryLive === "function" && !isCompanyRegistryLive(record)) {
      continue;
    }
    const masterSheetId = String(record.masterSheetId || "").trim();
    if (!masterSheetId || candidateBySheet.has(masterSheetId)) {
      continue;
    }
    addCandidate(
      {
        companyId: String(companyId || record.companyId || "").trim(),
        companyName: String(record.companyName || record.name || "").trim(),
        companyFolderId: String(record.companyFolderId || record.rootFolderId || companyId || "").trim(),
        masterSheetId,
        registryStatus: String(record.status || record.registryStatus || "").trim(),
        registrySource: String(record.registrySource || "main"),
      },
      1,
    );
  }

  const candidates = [...candidateBySheet.values()].sort((a, b) => a.priority - b.priority);
  for (const candidate of candidates) {
    try {
      if (typeof migrateColumns === "function") {
        await migrateColumns(auth, candidate.masterSheetId, deps);
      }
      const rec =
        typeof readUsersRecord === "function"
          ? await readUsersRecord(auth, candidate.masterSheetId, emailNorm, deps)
          : null;
      if (!rec || rec.status !== "ACTIVE") {
        continue;
      }
      const companyFolderId =
        pickRowCompanyFolderId(rec) ||
        candidate.companyFolderId ||
        candidate.companyId ||
        String(rec.companyId || "").trim();
      const companyName = pickRowCompanyName(rec?.rowObject || rec) || candidate.companyName;
      return {
        companyId: candidate.companyId || companyFolderId,
        companyName,
        companyFolderId,
        masterSheetId: candidate.masterSheetId,
        role: rec.role,
        accessLevel: rec.accessLevel,
        companyAreas: rec.companyAreas,
        registryStatus: candidate.registryStatus,
        registrySource: candidate.registrySource,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function migrateUsersTabCompanyColumns(auth, spreadsheetId, companyContext, deps) {
  const { ensureColumns, getTabValues, google, withSheetsQuotaRetry } = deps;
  const tabTitle = await resolveUsersTabTitle(auth, spreadsheetId, deps, { createIfMissing: true });
  const companyName = String(companyContext?.companyName || "").trim();
  const companyFolderId = String(companyContext?.companyFolderId || companyContext?.companyId || "").trim();
  const { addedColumns } = await ensureColumns(auth, spreadsheetId, tabTitle, USERS_TAB_COLUMNS);
  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  if (rows.length < 2) {
    return { ok: true, addedColumns, backfilled: 0, companyColumnsAdded: addedColumns.length > 0 };
  }
  const headers = rows[0].map((cell) => String(cell || "").trim());
  let backfilled = 0;
  const nextRows = [headers];
  for (let i = 1; i < rows.length; i += 1) {
    const row = [...rows[i]];
    while (row.length < headers.length) {
      row.push("");
    }
    const rawObj = rowToObject(headers, row);
    const obj = normalizeUsersTabRowObject(rawObj);
    const before = JSON.stringify({
      Company: pickRowCompanyName(obj),
      CompanyId: pickRowCompanyId(obj),
      CompanyFolderId: pickRowCompanyFolderId(obj),
    });
    const filled = backfillRowCompanyFields(obj, { companyName, companyFolderId, companyId: companyFolderId });
    const after = JSON.stringify({
      Company: pickRowCompanyName(filled),
      CompanyId: pickRowCompanyId(filled),
      CompanyFolderId: pickRowCompanyFolderId(filled),
    });
    if (before !== after) {
      backfilled += 1;
    }
    nextRows.push(headers.map((header) => String(filled[header] ?? row[headers.indexOf(header)] ?? "").trim()));
  }
  if (backfilled > 0) {
    const sheets = google.sheets({ version: "v4", auth });
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${tabTitle}!A:ZZ`,
      }),
    );
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabTitle}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: nextRows },
      }),
    );
  }
  return { ok: true, addedColumns, backfilled, companyColumnsAdded: addedColumns.length > 0 };
}

export async function migrateUsersTabColumns(auth, spreadsheetId, deps, options = {}) {
  const { ensureColumns, getTabValues, google, withSheetsQuotaRetry, getConfig } = deps;
  const tabTitle = await resolveUsersTabTitle(auth, spreadsheetId, deps, { createIfMissing: true });
  const companyContext = options.companyContext || {};
  if (companyContext.companyFolderId || companyContext.companyId || companyContext.companyName) {
    await migrateUsersTabCompanyColumns(auth, spreadsheetId, companyContext, deps).catch(() => null);
  }
  const { addedColumns } = await ensureColumns(auth, spreadsheetId, tabTitle, USERS_TAB_COLUMNS);
  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  if (rows.length < 2) {
    return { ok: true, addedColumns, backfilled: 0 };
  }
  const headers = rows[0].map((cell) => String(cell || "").trim());
  const emailIdx = headerIndex(headers, "Email");
  if (emailIdx === -1) {
    return { ok: true, addedColumns, backfilled: 0 };
  }
  const cfg = await getConfig(auth, spreadsheetId);
  let backfilled = 0;
  const nextRows = [headers];
  for (let i = 1; i < rows.length; i += 1) {
    const row = [...rows[i]];
    while (row.length < headers.length) {
      row.push("");
    }
    const rawObj = rowToObject(headers, row);
    const obj = normalizeUsersTabRowObject(rawObj);
    const email = pickField(obj, "Email");
    const role = pickField(obj, "Role");
    let changed = false;
    if (!pickField(obj, "Name") && pickField(obj, "Full Name")) {
      obj.Name = pickField(obj, "Full Name");
      changed = true;
    }
    if (!pickField(obj, "Name") && email) {
      obj.Name = email;
      changed = true;
    }
    if (!pickField(obj, "AccessLevel") && role) {
      obj.AccessLevel = defaultAccessLevelForRole(parseRoleFromUsersSheet(role));
      changed = true;
    }
    if (!pickField(obj, "Status")) {
      const authKey = `UserAuth.${safeLower(email)}`;
      const hasAuth = Boolean(cfg[authKey] && String(cfg[authKey]).trim());
      const hasHash = Boolean(pickField(obj, "PasswordHash"));
      obj.Status = hasHash || hasAuth ? "ACTIVE" : "INVITED";
      changed = true;
    }
    if (!pickField(obj, "PasswordHash")) {
      const authKey = `UserAuth.${safeLower(email)}`;
      const stored = cfg[authKey];
      if (stored && String(stored).trim()) {
        obj.PasswordHash = isPasswordHash(stored) ? stored : hashPassword(stored);
        obj.PasswordUpdatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (!pickField(obj, "CreatedAt") && pickField(obj, "Created At")) {
      obj.CreatedAt = pickField(obj, "Created At");
      changed = true;
    }
    if (!pickField(obj, "UpdatedAt") && pickField(obj, "Updated At")) {
      obj.UpdatedAt = pickField(obj, "Updated At");
      changed = true;
    }
    if (!pickField(obj, "InvitedAt") && pickField(obj, "Created At")) {
      obj.InvitedAt = pickField(obj, "Created At");
      changed = true;
    }
    if (changed) {
      backfilled += 1;
    }
    nextRows.push(headers.map((header) => String(obj[header] ?? row[headers.indexOf(header)] ?? "").trim()));
  }
  if (backfilled > 0) {
    const sheets = google.sheets({ version: "v4", auth });
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${tabTitle}!A:ZZ`,
      }),
    );
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabTitle}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: nextRows },
      }),
    );
  }
  return { ok: true, addedColumns, backfilled };
}
