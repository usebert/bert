/**
 * Shared company user password auth — Users tab PasswordHash column is source of truth.
 * Password reset and login MUST use these helpers (never divergent hash/read paths).
 *
 * Audit: 7oakcottages@gmail.com — legacy auth index paired with wrong "Rock Solid" company;
 * reset wrote Users tab via setCompanyUserPasswordHash while login read stale auth-index hash.
 */
import { hashPassword, verifyPassword } from "./master-auth.mjs";
import {
  findCompanyUsersTabRow,
  isPasswordHash,
  readCompanyUsersTabRecord,
  resolveCompanyContextForUser,
  collectUsersTabLoginDiagnostics,
} from "./company-users.mjs";
import {
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
  rowExplicitlyPointsToOtherCompany,
} from "./users-tab-schema.mjs";
import {
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";
import { isKnownStaleAuthIndexPairing } from "../shared/auth-index-trust.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { readCanonicalCompanyWorkspaceRegistryMap } from "./company-workspace-registry.mjs";

const LIGHT_RESOLVE_OPTS = {
  ensureTabsSync: false,
  ensureStructure: false,
  createIfMissing: false,
  skipFolderPlacementCheck: true,
  preferFolderResolution: true,
};

/** Safe client/server diagnostic codes — never include passwords or hash values. */
export const AUTH_FAILURE_REASON = {
  USER_NOT_FOUND: "USER_NOT_FOUND",
  PASSWORD_MISSING: "PASSWORD_MISSING",
  PASSWORD_HASH_MISSING: "PASSWORD_HASH_MISSING",
  PASSWORD_COMPARE_FAILED: "PASSWORD_COMPARE_FAILED",
  COMPANY_WORKBOOK_NOT_RESOLVED: "COMPANY_WORKBOOK_NOT_RESOLVED",
  WRONG_COMPANY: "WRONG_COMPANY",
  NO_LOGIN_CANDIDATES: "NO_LOGIN_CANDIDATES",
  INACTIVE: "INACTIVE",
};

const AUTH_REASON_TO_DIAGNOSTIC = {
  [AUTH_FAILURE_REASON.USER_NOT_FOUND]: "user_not_found",
  [AUTH_FAILURE_REASON.PASSWORD_MISSING]: "password_missing",
  [AUTH_FAILURE_REASON.PASSWORD_HASH_MISSING]: "password_hash_missing",
  [AUTH_FAILURE_REASON.PASSWORD_COMPARE_FAILED]: "password_compare_failed",
  [AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED]: "company_workbook_not_resolved",
  [AUTH_FAILURE_REASON.WRONG_COMPANY]: "wrong_company",
  [AUTH_FAILURE_REASON.NO_LOGIN_CANDIDATES]: "no_workbook_candidates",
  [AUTH_FAILURE_REASON.INACTIVE]: "inactive",
};

function diagnosticReasonCode(authFailureReason) {
  return AUTH_REASON_TO_DIAGNOSTIC[authFailureReason] || "invalid_credentials";
}

function buildLoginAuthFailure({
  email,
  authFailureReason,
  httpStatus = 401,
  code = "INVALID_CREDENTIALS",
  blocker = "invalid_credentials",
  message = "Email or password is incorrect.",
  attemptCount = 0,
  failedStep = "users_tab_auth",
  usersTabDiagnostics = null,
}) {
  const reasonCode = diagnosticReasonCode(authFailureReason);
  const emailNorm = normalizeUserAuthEmail(email);
  console.warn("[company-auth] login rejected", {
    email: emailNorm || "(missing)",
    reasonCode,
    authFailureReason,
    attemptCount,
    failedStep,
    candidateMasterSheetIds: usersTabDiagnostics?.candidateMasterSheetIds,
  });
  const inactive = authFailureReason === AUTH_FAILURE_REASON.INACTIVE;
  const diagnostics = {
    email: emailNorm,
    reasonCode,
    authFailureReason,
    failedStep,
    attemptCount,
  };
  if (usersTabDiagnostics?.candidateMasterSheetIds?.length) {
    diagnostics.candidateMasterSheetIds = usersTabDiagnostics.candidateMasterSheetIds;
  }
  if (usersTabDiagnostics?.usersTabLookups?.length) {
    diagnostics.usersTabLookups = usersTabDiagnostics.usersTabLookups.map((lookup) => ({
      masterSheetId: lookup.masterSheetId,
      usersTabTitle: lookup.usersTabTitle,
      usersTabRowCount: lookup.usersTabRowCount,
      detectedHeaders: lookup.detectedHeaders,
      emailLikeHeaders: lookup.emailLikeHeaders,
      targetEmailExists: lookup.targetEmailExists,
      targetEmailInEmailLikeColumns: lookup.targetEmailInEmailLikeColumns,
    }));
  }
  return {
    ok: false,
    reason: inactive ? "inactive" : "invalid_credentials",
    httpStatus: inactive ? 403 : httpStatus,
    code: inactive ? undefined : code,
    blocker: inactive ? "inactive" : blocker,
    error: inactive ? "This account is inactive. Contact your company administrator." : message,
    message: inactive ? "This account is inactive. Contact your company administrator." : message,
    authFailureReason,
    reasonCode,
    diagnostics,
  };
}

function classifyVerifyFailure(verifyResult = {}) {
  if (verifyResult.reason === "wrong_company") {
    return AUTH_FAILURE_REASON.WRONG_COMPANY;
  }
  if (verifyResult.reason === "no_password_hash") {
    return AUTH_FAILURE_REASON.PASSWORD_HASH_MISSING;
  }
  if (verifyResult.reason === "inactive") {
    return AUTH_FAILURE_REASON.INACTIVE;
  }
  if (verifyResult.rowFound === false) {
    return AUTH_FAILURE_REASON.USER_NOT_FOUND;
  }
  if (verifyResult.reason === "invalid_credentials") {
    return AUTH_FAILURE_REASON.PASSWORD_COMPARE_FAILED;
  }
  return AUTH_FAILURE_REASON.PASSWORD_COMPARE_FAILED;
}

function classifyContextFailure(reason = "") {
  const normalized = String(reason || "").trim();
  if (normalized === "user_not_found") {
    return AUTH_FAILURE_REASON.USER_NOT_FOUND;
  }
  if (normalized === "company_folder_missing" || normalized === "company_context_failed") {
    return AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED;
  }
  return AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED;
}

function resolveUsersTabReaders(deps = {}) {
  return {
    findRow: typeof deps.findCompanyUsersTabRow === "function" ? deps.findCompanyUsersTabRow : findCompanyUsersTabRow,
    readRecord:
      typeof deps.readCompanyUsersTabRecord === "function" ? deps.readCompanyUsersTabRecord : readCompanyUsersTabRecord,
    writeByHeaders:
      typeof deps.writeUsersTabRecordByHeaders === "function" ? deps.writeUsersTabRecordByHeaders : null,
  };
}

export { hashPassword, verifyPassword };

export function normalizeUserAuthEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function resolveUserAuthCompanyContext(companyContext = {}) {
  return {
    masterSheetId: String(companyContext.masterSheetId || "").trim(),
    companyFolderId: String(companyContext.companyFolderId || companyContext.companyId || "").trim(),
    companyId: String(companyContext.companyId || companyContext.companyFolderId || "").trim(),
    companyName: String(companyContext.companyName || "").trim(),
  };
}

/** Read auth fields from Users tab by Email header — never returned to frontend APIs. */
export async function readUserAuthRowByEmail(auth, companyContext, email, deps) {
  const ctx = resolveUserAuthCompanyContext(companyContext);
  const emailNorm = normalizeUserAuthEmail(email);
  if (!auth || !ctx.masterSheetId || !emailNorm) {
    return null;
  }
  const { readRecord } = resolveUsersTabReaders(deps);
  const rec = await readRecord(auth, ctx.masterSheetId, emailNorm, deps).catch(() => null);
  if (!rec) {
    return null;
  }
  const rowObj = rec.rowObject || rec;
  return {
    email: emailNorm,
    name: rec.name || emailNorm,
    role: rec.role,
    status: rec.status,
    accessLevel: rec.accessLevel,
    companyAreas: rec.companyAreas,
    companyId: rec.companyId || pickRowCompanyId(rowObj),
    companyFolderId: rec.companyFolderId || pickRowCompanyFolderId(rowObj) || rec.companyId,
    companyName: rec.companyName || pickRowCompanyName(rowObj),
    passwordHash: String(rec.passwordHash || "").trim(),
    masterSheetId: ctx.masterSheetId,
    rowObject: rec.rowObject,
  };
}

/** Write PasswordHash to Users tab by header name, read back, and verify hash persisted. */
export async function writeUserPasswordHash(auth, companyContext, email, passwordHash, deps) {
  const ctx = resolveUserAuthCompanyContext(companyContext);
  const emailNorm = normalizeUserAuthEmail(email);
  const hashed = String(passwordHash || "").trim();
  if (!auth || !ctx.masterSheetId || !emailNorm || !hashed) {
    return { ok: false, reason: "missing_context" };
  }
  if (!isPasswordHash(hashed)) {
    return { ok: false, reason: "invalid_hash_format" };
  }

  const { findRow, writeByHeaders } = resolveUsersTabReaders(deps);
  if (typeof writeByHeaders !== "function") {
    return { ok: false, reason: "write_helper_missing" };
  }

  const match = await findRow(auth, ctx.masterSheetId, emailNorm, deps);
  if (!match) {
    return { ok: false, reason: "user_not_found" };
  }

  const now = new Date().toISOString();
  const writeResult = await writeByHeaders(
    auth,
    ctx.masterSheetId,
    {
      Email: emailNorm,
      PasswordHash: hashed,
      PasswordUpdatedAt: now,
      Status: "ACTIVE",
      UpdatedAt: now,
    },
    deps,
    { companyContext: ctx, validate: false },
  );
  if (!writeResult.ok) {
    return { ok: false, reason: writeResult.reason || "write_failed" };
  }

  const saved = await readUserAuthRowByEmail(auth, ctx, emailNorm, deps);
  if (!saved?.passwordHash) {
    return { ok: false, reason: "read_back_missing" };
  }
  if (saved.passwordHash !== hashed) {
    return { ok: false, reason: "password_hash_mismatch" };
  }

  const userAuthKey = `UserAuth.${emailNorm}`;
  const { getConfig, updateConfig } = deps;
  if (typeof getConfig === "function" && typeof updateConfig === "function") {
    const cfg = await getConfig(auth, ctx.masterSheetId).catch(() => ({}));
    if (cfg[userAuthKey]) {
      const next = { ...cfg };
      delete next[userAuthKey];
      await updateConfig(auth, ctx.masterSheetId, next).catch(() => null);
    }
  }

  return { ok: true, email: emailNorm, masterSheetId: ctx.masterSheetId, passwordHashLength: hashed.length };
}

export async function writeUserPasswordPlain(auth, companyContext, email, plainPassword, deps) {
  return writeUserPasswordHash(auth, companyContext, email, hashPassword(String(plainPassword || "")), deps);
}

export async function rebuildAuthIndexFromUsersTab(auth, deps, companyContext, authIndex, email = "") {
  if (!authIndex || typeof authIndex.rebuildCompanyAuthIndexFromSheet !== "function") {
    return { ok: false, reason: "auth_index_unavailable" };
  }
  const ctx = resolveUserAuthCompanyContext(companyContext);
  if (!auth || !ctx.masterSheetId) {
    return { ok: false, reason: "missing_context" };
  }
  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const rebuilt = await authIndex
    .rebuildCompanyAuthIndexFromSheet(auth, { ...deps, getCompanyUsersDeps: () => userDeps }, ctx)
    .catch(() => ({ ok: false, reason: "rebuild_failed" }));
  const emailNorm = normalizeUserAuthEmail(email);
  if (emailNorm && typeof authIndex.upsertEntry === "function") {
    const row = await readUserAuthRowByEmail(auth, ctx, emailNorm, userDeps).catch(() => null);
    if (row?.passwordHash && typeof authIndex.entryFromUsersTabRow === "function") {
      const entry = authIndex.entryFromUsersTabRow(
        {
          ...row,
          email: emailNorm,
          roleRaw: row.role,
          rowObject: row.rowObject,
        },
        ctx,
      );
      if (entry) {
        authIndex.upsertEntry(entry);
      }
    }
  }
  return rebuilt;
}

export async function verifyUserPasswordFromUsersTab(auth, companyContext, email, plainPassword, deps) {
  const ctx = resolveUserAuthCompanyContext(companyContext);
  const row = await readUserAuthRowByEmail(auth, ctx, email, deps);
  if (!row) {
    return { ok: false, reason: "user_not_found", rowFound: false };
  }
  if (String(row.status || "").toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: "inactive", rowFound: true, status: row.status };
  }
  const rowForCompanyCheck = row.rowObject || row;
  if (
    rowExplicitlyPointsToOtherCompany(rowForCompanyCheck, {
      companyFolderId: ctx.companyFolderId || ctx.companyId,
      companyId: ctx.companyId || ctx.companyFolderId,
      masterSheetId: ctx.masterSheetId,
      companyName: ctx.companyName,
    })
  ) {
    return { ok: false, reason: "wrong_company", rowFound: true, status: row.status };
  }
  if (!row.passwordHash) {
    return { ok: false, reason: "no_password_hash", rowFound: true, status: row.status };
  }
  const verifyOk = verifyPassword(String(plainPassword || ""), row.passwordHash);
  return {
    ok: verifyOk,
    verifyOk,
    reason: verifyOk ? undefined : "invalid_credentials",
    rowFound: true,
    status: row.status,
    role: row.role,
    passwordHashPresent: Boolean(row.passwordHash),
    passwordHashPrefix: row.passwordHash.slice(0, 12),
    passwordHashLength: row.passwordHash.length,
    row,
    source: "users_tab",
    masterSheetId: row.masterSheetId,
  };
}

function resolverDeps(deps = {}) {
  if (typeof deps.getCompanyResolverDeps === "function") {
    return deps.getCompanyResolverDeps();
  }
  return deps;
}

function registryLookupDeps(deps = {}, userDeps = {}) {
  const resolver = resolverDeps(deps);
  return {
    ...userDeps,
    ...resolver,
    findMasterSheetIdsForCompanyLoginEmail: deps.findMasterSheetIdsForCompanyLoginEmail,
    readCompanyUsersTabRecord: userDeps.readCompanyUsersTabRecord || readCompanyUsersTabRecord,
    readCanonicalCompanyWorkspaceRegistryMap:
      deps.readCanonicalCompanyWorkspaceRegistryMap ||
      resolver.readCanonicalCompanyWorkspaceRegistryMap ||
      readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive: deps.isCompanyRegistryLive || resolver.isCompanyRegistryLive || isCompanyRegistryLive,
  };
}

function resolveFolderContextFn(deps = {}) {
  return typeof deps.resolveCompanyFromFolder === "function"
    ? deps.resolveCompanyFromFolder
    : resolveCompanyFromFolder;
}

async function resolveFolderFirstContext(auth, deps, companyFolderId, masterSheetId = "") {
  const resolveFn = resolveFolderContextFn(deps);
  const sheetHint = sanitizeGoogleSpreadsheetId(masterSheetId);
  return resolveFn(auth, resolverDeps(deps), companyFolderId, {
    ...LIGHT_RESOLVE_OPTS,
    masterSheetId: sheetHint,
    ...(sheetHint
      ? { createIfMissing: false, preferFolderResolution: false }
      : {}),
  });
}

async function logUsersTabLookupDiagnostics(auth, userDeps, companyContext, email, attemptLabel = "") {
  const ctx = resolveUserAuthCompanyContext(companyContext);
  if (!auth || !ctx.masterSheetId) {
    return null;
  }
  const diagnostics = await collectUsersTabLoginDiagnostics(auth, ctx.masterSheetId, email, userDeps).catch(() => null);
  if (!diagnostics) {
    return null;
  }
  console.info("[company-auth] users tab lookup", {
    attempt: attemptLabel || "login",
    email: normalizeUserAuthEmail(email),
    companyFolderId: ctx.companyFolderId || undefined,
    masterSheetId: ctx.masterSheetId,
    usersTabTitle: diagnostics.usersTabTitle,
    usersTabRowCount: diagnostics.usersTabRowCount,
    detectedHeaders: diagnostics.detectedHeaders,
    emailLikeHeaders: diagnostics.emailLikeHeaders,
    normalizedEmailColumnCandidates: diagnostics.normalizedEmailColumnCandidates,
    targetEmailExists: diagnostics.targetEmailExists,
    targetEmailInEmailLikeColumns: diagnostics.targetEmailInEmailLikeColumns,
  });
  return diagnostics;
}

function buildCompanyContextFromHintedSheet(row, masterSheetId, resolved = null) {
  const hintedSheetId = sanitizeGoogleSpreadsheetId(masterSheetId);
  const rowFolderId = sanitizeCompanyFolderId(
    row?.companyFolderId || pickRowCompanyFolderId(row?.rowObject || row) || row?.companyId || "",
  );
  if (!hintedSheetId || !rowFolderId) {
    return null;
  }
  const companyName = String(
    row?.companyName || pickRowCompanyName(row?.rowObject || row) || resolved?.companyName || "",
  ).trim();
  return {
    // Users tab row was read from the hinted workbook — never override with folder discovery.
    masterSheetId: hintedSheetId,
    companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId) || rowFolderId,
    companyId: sanitizeCompanyFolderId(resolved?.companyId || resolved?.companyFolderId) || rowFolderId,
    companyName,
  };
}

/** Prefer the workbook that actually contains the Users tab row (paired hint before discovered). */
async function pickLoginMasterSheetId(auth, userDeps, email, { pairedSheetId, resolved } = {}) {
  const pairedId = sanitizeGoogleSpreadsheetId(pairedSheetId);
  const resolvedId = sanitizeGoogleSpreadsheetId(resolved?.masterSheetId);
  const candidates = [];
  if (pairedId) {
    candidates.push(pairedId);
  }
  if (resolvedId && resolvedId !== pairedId) {
    candidates.push(resolvedId);
  }
  for (const masterSheetId of candidates) {
    const row = await readUserAuthRowByEmail(auth, { masterSheetId }, email, userDeps).catch(() => null);
    if (row) {
      return masterSheetId;
    }
  }
  // Hinted/paired workbook wins over folder discovery when neither sheet has a matching row yet.
  return pairedId || resolvedId || "";
}

async function collectRegistryLoginSheetIds(auth, deps) {
  const lookupDeps = registryLookupDeps(deps, {});
  const fn = lookupDeps.readCanonicalCompanyWorkspaceRegistryMap;
  if (typeof fn !== "function" || !auth) {
    return [];
  }
  const registryResult = await fn(auth, lookupDeps).catch(() => ({ map: new Map() }));
  const map = registryResult?.map instanceof Map ? registryResult.map : new Map();
  const isLive = lookupDeps.isCompanyRegistryLive;
  const ids = [];
  for (const record of map.values()) {
    if (typeof isLive === "function" && !isLive(record)) {
      continue;
    }
    const id = sanitizeGoogleSpreadsheetId(record.masterSheetId);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

async function logLoginUsersTabDiagnostics(auth, userDeps, email, attempts = [], extraSheetIds = []) {
  const sheetIds = new Set();
  const folderIds = new Set();
  for (const attempt of attempts) {
    if (attempt.type === "sheet_hint" && attempt.masterSheetId) {
      sheetIds.add(attempt.masterSheetId);
    }
    if (attempt.type === "folder") {
      if (attempt.masterSheetId) {
        sheetIds.add(attempt.masterSheetId);
      }
      if (attempt.companyFolderId) {
        folderIds.add(attempt.companyFolderId);
      }
    }
  }
  for (const sheetId of extraSheetIds) {
    if (sheetId) {
      sheetIds.add(sheetId);
    }
  }
  if (!sheetIds.size) {
    return { candidateMasterSheetIds: [], usersTabLookups: [] };
  }
  const diagnostics = [];
  for (const masterSheetId of sheetIds) {
    const usersTab = await collectUsersTabLoginDiagnostics(auth, masterSheetId, email, userDeps).catch(() => null);
    if (usersTab) {
      diagnostics.push(usersTab);
    }
  }
  const payload = {
    email: normalizeUserAuthEmail(email) || "(missing)",
    candidateMasterSheetIds: [...sheetIds],
    resolvedCompanyFolderIds: [...folderIds],
    usersTabLookups: diagnostics,
  };
  console.warn("[company-auth] users tab login diagnostics", payload);
  return payload;
}

function dedupeLoginAttempts(attempts = []) {
  const seen = new Set();
  const out = [];
  for (const attempt of attempts) {
    const key =
      attempt.type === "folder"
        ? `f:${attempt.companyFolderId}:${attempt.masterSheetId || ""}`
        : `s:${attempt.masterSheetId}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(attempt);
  }
  return out;
}

function collectLoginResolutionAttempts(input = {}, deps = {}) {
  const attempts = [];
  const pushFolder = (raw, pairedMasterSheetId = "") => {
    const folderId = sanitizeCompanyFolderId(raw);
    const sheetId = sanitizeGoogleSpreadsheetId(pairedMasterSheetId);
    if (folderId) {
      attempts.push({
        type: "folder",
        companyFolderId: folderId,
        ...(sheetId ? { masterSheetId: sheetId } : {}),
      });
    }
  };
  const pushSheet = (raw) => {
    const sheetId = sanitizeGoogleSpreadsheetId(raw);
    if (sheetId) {
      attempts.push({ type: "sheet_hint", masterSheetId: sheetId });
    }
  };

  const hintedSheetId = sanitizeGoogleSpreadsheetId(input.masterSheetId || input.requestedSheetId);
  const hintedFolderId = sanitizeCompanyFolderId(input.companyFolderId);
  pushSheet(hintedSheetId);
  pushFolder(hintedFolderId, hintedSheetId);

  const email = normalizeUserAuthEmail(input.email);
  const indexEntry =
    typeof deps.authIndex?.lookupByEmail === "function" ? deps.authIndex.lookupByEmail(email) : null;
  if (indexEntry && !isKnownStaleAuthIndexPairing(email, indexEntry.companyName)) {
    const indexSheetId = sanitizeGoogleSpreadsheetId(indexEntry.masterSheetId);
    const indexFolderId = sanitizeCompanyFolderId(indexEntry.companyFolderId || indexEntry.companyId);
    if (indexSheetId) {
      pushSheet(indexSheetId);
    }
    if (indexFolderId) {
      pushFolder(indexFolderId, indexSheetId);
    }
  }
  if (typeof deps.findMasterSheetIdsForCompanyLoginEmail === "function") {
    for (const sheetId of deps.findMasterSheetIdsForCompanyLoginEmail(email) || []) {
      pushSheet(sheetId);
    }
  }
  return dedupeLoginAttempts(attempts);
}

async function companyContextFromSheetHint(auth, deps, masterSheetId, email, userDeps) {
  const hintedSheetId = sanitizeGoogleSpreadsheetId(masterSheetId);
  if (!hintedSheetId) {
    return { ok: false, reason: "missing_context" };
  }
  const row = await readUserAuthRowByEmail(auth, { masterSheetId: hintedSheetId }, email, userDeps);
  if (!row) {
    return { ok: false, reason: "user_not_found" };
  }
  const rowFolderId = sanitizeCompanyFolderId(
    row.companyFolderId || pickRowCompanyFolderId(row.rowObject || row) || row.companyId || "",
  );
  if (!rowFolderId) {
    return { ok: false, reason: "company_folder_missing", row };
  }
  const resolved = await resolveFolderFirstContext(auth, deps, rowFolderId, hintedSheetId);
  const companyContext = buildCompanyContextFromHintedSheet(row, hintedSheetId, resolved);
  if (!companyContext) {
    return { ok: false, reason: "company_context_failed", row, resolved };
  }
  return {
    ok: true,
    companyContext,
    row,
  };
}

/**
 * Company user login — Users tab PasswordHash is verified after folder-first company resolve.
 * Auth index and invite hints only narrow which workbook/folder to read; never authenticate alone.
 */
export async function authenticateCompanyUserLogin(auth, deps = {}, input = {}) {
  const email = normalizeUserAuthEmail(input.email);
  const password = String(input.password || "");
  if (!auth || !email || !password) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: !password
        ? AUTH_FAILURE_REASON.PASSWORD_MISSING
        : AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
      httpStatus: 400,
      code: "MISSING_FIELDS",
      blocker: "missing_fields",
      message: "Email and password are required.",
      failedStep: "input_validation",
    });
  }

  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const attempts = collectLoginResolutionAttempts(input, deps);

  let inactiveHit = false;
  let lastAuthFailureReason = AUTH_FAILURE_REASON.USER_NOT_FOUND;
  let usersTabDiagnostics = null;
  for (const attempt of attempts) {
    let companyContext = {};
    if (attempt.type === "folder") {
      const pairedSheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
      const resolved = await resolveFolderFirstContext(auth, deps, attempt.companyFolderId, pairedSheetId);
      const masterSheetId = await pickLoginMasterSheetId(auth, userDeps, email, { pairedSheetId, resolved });
      if (!masterSheetId) {
        lastAuthFailureReason = AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED;
        continue;
      }
      const rowOnSheet = await readUserAuthRowByEmail(auth, { masterSheetId }, email, userDeps).catch(() => null);
      if (rowOnSheet) {
        const fallback = buildCompanyContextFromHintedSheet(rowOnSheet, masterSheetId, resolved);
        companyContext = fallback || {
          masterSheetId,
          companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId || attempt.companyFolderId),
          companyId: sanitizeCompanyFolderId(
            resolved?.companyId || resolved?.companyFolderId || attempt.companyFolderId,
          ),
          companyName: String(resolved?.companyName || rowOnSheet.companyName || "").trim(),
        };
      } else {
        companyContext = {
          masterSheetId,
          companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId || attempt.companyFolderId),
          companyId: sanitizeCompanyFolderId(
            resolved?.companyId || resolved?.companyFolderId || attempt.companyFolderId,
          ),
          companyName: String(resolved?.companyName || "").trim(),
        };
      }
    } else {
      const hinted = await companyContextFromSheetHint(auth, deps, attempt.masterSheetId, email, userDeps);
      if (!hinted.ok) {
        if (hinted.reason === "inactive") {
          inactiveHit = true;
          lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
        } else {
          lastAuthFailureReason = classifyContextFailure(hinted.reason);
        }
        continue;
      }
      companyContext = hinted.companyContext;
    }

    const verifyResult = await verifyUserPasswordFromUsersTab(auth, companyContext, email, password, userDeps);
    if (!verifyResult.ok) {
      if (verifyResult.rowFound === false) {
        await logUsersTabLookupDiagnostics(auth, userDeps, companyContext, email, attempt.type).catch(() => null);
      }
      if (verifyResult.reason === "inactive") {
        inactiveHit = true;
        lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
      } else {
        lastAuthFailureReason = classifyVerifyFailure(verifyResult);
      }
      continue;
    }

    const row = verifyResult.row;
    const entry = {
      email,
      name: String(row?.name || email).trim() || email,
      role: row?.role || "User",
      accessLevel: row?.accessLevel || "",
      companyId: companyContext.companyFolderId,
      companyFolderId: companyContext.companyFolderId,
      companyName:
        companyContext.companyName || String(pickRowCompanyName(row?.rowObject || row) || "").trim(),
      masterSheetId: companyContext.masterSheetId,
      status: "ACTIVE",
      companyAreas: Array.isArray(row?.companyAreas) ? row.companyAreas : [],
    };

    if (deps.authIndex) {
      await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email).catch(() => null);
      const indexed = deps.authIndex.lookupByEmail?.(email);
      if (indexed) {
        entry.name = indexed.name || entry.name;
        entry.role = indexed.role || entry.role;
        entry.accessLevel = indexed.accessLevel || entry.accessLevel;
        entry.companyAreas = indexed.companyAreas?.length ? indexed.companyAreas : entry.companyAreas;
        entry.companyName = indexed.companyName || entry.companyName;
        entry.masterSheetId = indexed.masterSheetId || entry.masterSheetId;
        entry.companyFolderId = indexed.companyFolderId || entry.companyFolderId;
        entry.companyId = indexed.companyId || entry.companyId;
      }
    }

    return { ok: true, email, row, companyContext, entry };
  }

  const registryContext = await resolveCompanyContextForUser(auth, email, registryLookupDeps(deps, userDeps)).catch(
    () => null,
  );

  if (registryContext?.masterSheetId) {
    const companyContext = {
      masterSheetId: registryContext.masterSheetId,
      companyFolderId: registryContext.companyFolderId,
      companyId: registryContext.companyId || registryContext.companyFolderId,
      companyName: registryContext.companyName,
    };
    const verifyResult = await verifyUserPasswordFromUsersTab(auth, companyContext, email, password, userDeps);
    if (verifyResult.ok) {
      const row = verifyResult.row;
      const entry = {
        email,
        name: String(row?.name || email).trim() || email,
        role: row?.role || registryContext.role || "User",
        accessLevel: row?.accessLevel || registryContext.accessLevel || "",
        companyId: companyContext.companyFolderId,
        companyFolderId: companyContext.companyFolderId,
        companyName: companyContext.companyName,
        masterSheetId: companyContext.masterSheetId,
        status: "ACTIVE",
        companyAreas: Array.isArray(row?.companyAreas)
          ? row.companyAreas
          : Array.isArray(registryContext.companyAreas)
            ? registryContext.companyAreas
            : [],
      };
      if (deps.authIndex) {
        await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email).catch(() => null);
      }
      return { ok: true, email, row, companyContext, entry };
    }
    if (verifyResult.reason === "inactive") {
      inactiveHit = true;
      lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
    } else {
      lastAuthFailureReason = classifyVerifyFailure(verifyResult);
    }
  }

  if (inactiveHit) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: AUTH_FAILURE_REASON.INACTIVE,
      attemptCount: attempts.length,
    });
  }

  if (lastAuthFailureReason === AUTH_FAILURE_REASON.USER_NOT_FOUND) {
    const registrySheetIds = registryContext?.masterSheetId
      ? [registryContext.masterSheetId]
      : await collectRegistryLoginSheetIds(auth, deps).catch(() => []);
    usersTabDiagnostics = await logLoginUsersTabDiagnostics(
      auth,
      userDeps,
      email,
      attempts,
      registrySheetIds,
    ).catch(() => null);
  }

  if (!attempts.length && !registryContext?.masterSheetId) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: AUTH_FAILURE_REASON.NO_LOGIN_CANDIDATES,
      failedStep: "collect_attempts",
      attemptCount: 0,
    });
  }

  return buildLoginAuthFailure({
    email,
    authFailureReason: lastAuthFailureReason,
    attemptCount: attempts.length,
    usersTabDiagnostics,
  });
}

/**
 * Login fallback — Users tab wins over stale/missing auth index.
 * Tries invite-hint sheet IDs first, then optional requested masterSheetId.
 */
export async function attemptUsersTabPasswordLogin(auth, deps, input = {}) {
  const email = normalizeUserAuthEmail(input.email);
  const password = String(input.password || "");
  const requestedSheetId = String(input.requestedSheetId || "").trim();
  const { findMasterSheetIdsForCompanyLoginEmail, authIndex } = deps;

  if (!auth || !email || !password) {
    return { ok: false, reason: "missing_context" };
  }

  const sheetIds = [];
  if (requestedSheetId) {
    sheetIds.push(requestedSheetId);
  }
  if (typeof findMasterSheetIdsForCompanyLoginEmail === "function") {
    for (const sheetId of findMasterSheetIdsForCompanyLoginEmail(email) || []) {
      if (sheetId && !sheetIds.includes(sheetId)) {
        sheetIds.push(sheetId);
      }
    }
  }
  if (!sheetIds.length) {
    return { ok: false, reason: "no_workbook_candidates" };
  }

  for (const masterSheetId of sheetIds) {
    const userDeps = deps.getCompanyUsersDeps?.() || deps;
    const hinted = await companyContextFromSheetHint(auth, deps, masterSheetId, email, userDeps);
    if (!hinted.ok) {
      continue;
    }
    const companyContext = hinted.companyContext;
    const verifyResult = await verifyUserPasswordFromUsersTab(auth, companyContext, email, password, userDeps);
    if (!verifyResult.ok) {
      continue;
    }
    const row = verifyResult.row || hinted.row;
    await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, authIndex, email).catch(() => null);
    const entry =
      typeof authIndex?.lookupByEmail === "function"
        ? authIndex.lookupByEmail(email)
        : typeof authIndex?.entryFromUsersTabRow === "function"
          ? authIndex.entryFromUsersTabRow({ ...row, email, roleRaw: row.role }, companyContext)
          : null;
    return {
      ok: true,
      source: "users_tab",
      row,
      companyContext,
      entry: entry || {
        email,
        name: row.name,
        role: row.role,
        accessLevel: row.accessLevel,
        companyId: companyContext.companyId,
        companyFolderId: companyContext.companyFolderId,
        companyName: companyContext.companyName,
        masterSheetId,
        status: row.status,
        passwordHash: row.passwordHash,
        companyAreas: row.companyAreas,
      },
    };
  }

  return { ok: false, reason: "invalid_credentials" };
}

/**
 * Password reset completion — hash, write by header, read-back verify, rebuild auth index.
 */
export async function completeCompanyPasswordReset(auth, deps, input = {}) {
  const email = normalizeUserAuthEmail(input.email);
  const newPassword = String(input.newPassword || input.password || "");
  const companyContext = resolveUserAuthCompanyContext(input.companyContext || { masterSheetId: input.masterSheetId });
  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;

  if (!auth || !companyContext.masterSheetId || !email || !newPassword) {
    return { ok: false, reason: "missing_context" };
  }

  const hashed = hashPassword(newPassword);
  const writeResult = await writeUserPasswordHash(auth, companyContext, email, hashed, userDeps);
  if (!writeResult.ok) {
    return writeResult;
  }

  const verifyResult = await verifyUserPasswordFromUsersTab(auth, companyContext, email, newPassword, userDeps);
  if (!verifyResult.ok || !verifyResult.verifyOk) {
    return { ok: false, reason: "verify_read_back_failed", writeResult, verifyResult };
  }

  const rebuildResult = await rebuildAuthIndexFromUsersTab(
    auth,
    deps,
    companyContext,
    input.authIndex || deps.authIndex,
    email,
  );

  return {
    ok: true,
    email,
    masterSheetId: companyContext.masterSheetId,
    verifyResult,
    rebuildResult,
  };
}

/** Godmode diagnostics — never returns full PasswordHash. */
export async function debugVerifyUserPassword(auth, deps, input = {}) {
  const companyContext = resolveUserAuthCompanyContext({
    masterSheetId: input.masterSheetId || input.companyId,
    companyFolderId: input.companyFolderId,
    companyId: input.companyId,
  });
  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const verifyResult = await verifyUserPasswordFromUsersTab(
    auth,
    companyContext,
    input.email,
    input.testPassword,
    userDeps,
  );
  return {
    ok: verifyResult.verifyOk === true,
    rowFound: verifyResult.rowFound === true,
    status: verifyResult.status || "",
    role: verifyResult.role || "",
    passwordHashPresent: verifyResult.passwordHashPresent === true,
    passwordHashPrefix: verifyResult.passwordHashPrefix || "",
    passwordHashLength: verifyResult.passwordHashLength || 0,
    verifyOk: verifyResult.verifyOk === true,
    source: "users_tab",
    masterSheetId: companyContext.masterSheetId,
    reason: verifyResult.reason,
  };
}
