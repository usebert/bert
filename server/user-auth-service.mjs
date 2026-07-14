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
  summarizeUsersTabEmailScanForLoginLog,
} from "./users-tab-schema.mjs";
import {
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";
import { isKnownStaleAuthIndexPairing } from "../shared/auth-index-trust.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import {
  isLoginEmailIdentity,
  normalizeLoginIdentity,
  normalizeUsername,
  resolveUsernameFromUserFields,
} from "../shared/login-username.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import {
  getCanonicalCompanyRegistryRecord,
  readCanonicalCompanyWorkspaceRegistryMap,
} from "./company-workspace-registry.mjs";
import { loginTimingEmailMeta } from "./login-timing.mjs";

const LIGHT_RESOLVE_OPTS = {
  ensureTabsSync: false,
  ensureStructure: false,
  createIfMissing: false,
  skipFolderPlacementCheck: true,
  preferFolderResolution: true,
};

/** Per-candidate Google read budget for stale/wrong workbook hints — not applied to trusted folder candidates. */
export const LOGIN_CANDIDATE_TIMEOUT_MS = 5000;
/** Registry fallback does a LIVE Companies scan + Users tab read; allow more time than folder/sheet hints. */
export const LOGIN_REGISTRY_FALLBACK_TIMEOUT_MS = 20000;

/** Body or session companyFolderId — folder resolve must complete before login rejects or tries registry fallback. */
function resolveTrustedFolderIds(input = {}) {
  const trusted = [];
  const bodyId = sanitizeCompanyFolderId(input.companyFolderId);
  const sessionId = sanitizeCompanyFolderId(input.sessionCompanyFolderId);
  if (bodyId) {
    trusted.push(bodyId);
  }
  if (sessionId && sessionId !== bodyId) {
    trusted.push(sessionId);
  }
  return trusted;
}

function isTrustedFolderCandidate(attempt = {}, trustedFolderIds = []) {
  if (attempt.type !== "folder" || !trustedFolderIds.length) {
    return false;
  }
  const folderId = sanitizeCompanyFolderId(attempt.companyFolderId);
  return Boolean(folderId && trustedFolderIds.includes(folderId));
}

/** sheet_hint reads Users tab first — no blocking folder resolve; skip per-candidate race timeout. */
function isSheetHintCandidate(attempt = {}) {
  return attempt.type === "sheet_hint";
}

/** Suppress timing logs from abandoned stale candidates so success phases cannot appear after 401. */
function createLoginAttemptTimingGuard(loginTiming) {
  let detached = false;
  return {
    detach() {
      detached = true;
    },
    wrapTimingDeps(deps) {
      if (!loginTiming || detached) {
        const { loginTiming: _omit, ...rest } = deps;
        return rest;
      }
      return {
        ...deps,
        loginTiming: {
          logPhase(phase, startMs, meta = {}) {
            if (detached) {
              return;
            }
            loginTiming.logPhase?.(phase, startMs, meta);
          },
          logMark(name, meta = {}) {
            if (detached) {
              return;
            }
            loginTiming.logMark?.(name, meta);
          },
        },
      };
    },
  };
}

function loginCandidateLabel(attempt = {}) {
  if (attempt.type === "folder") {
    return `folder:${attempt.companyFolderId || "?"}:${attempt.masterSheetId || ""}`;
  }
  return `sheet:${attempt.masterSheetId || "?"}`;
}

function loginCandidateTimingMeta(attempt = {}, candidateIndex = 0) {
  return {
    candidateIndex,
    candidateType: attempt.type,
    candidateId: loginCandidateLabel(attempt),
    ...(attempt.companyFolderId ? { companyFolderId: attempt.companyFolderId } : {}),
    ...(attempt.masterSheetId ? { masterSheetId: attempt.masterSheetId } : {}),
  };
}

/**
 * Race a candidate attempt against a hard timeout. On timeout, returns immediately — the
 * losing attempt promise is abandoned (not awaited) so slow Google reads cannot block login.
 */
async function raceLoginCandidateAttempt(
  attemptFn,
  timeoutMs = LOGIN_CANDIDATE_TIMEOUT_MS,
  label = "login_candidate",
) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(attemptFn), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function upsertLoginAuthIndexFromUsersTabRow(authIndex, row, companyContext, email) {
  if (!authIndex || typeof authIndex.upsertEntry !== "function") {
    return;
  }
  const emailNorm = normalizeUserAuthEmail(email);
  let entry = null;
  if (typeof authIndex.entryFromUsersTabRow === "function") {
    entry = authIndex.entryFromUsersTabRow(
      {
        ...row,
        email: emailNorm,
        roleRaw: row?.role,
        rowObject: row?.rowObject,
      },
      companyContext,
    );
  }
  if (!entry) {
    entry = {
      email: emailNorm,
      name: String(row?.name || emailNorm).trim() || emailNorm,
      role: row?.role || "User",
      accessLevel: row?.accessLevel || "",
      companyId: companyContext.companyFolderId,
      companyFolderId: companyContext.companyFolderId,
      companyName: companyContext.companyName,
      masterSheetId: companyContext.masterSheetId,
      status: row?.status || "ACTIVE",
      companyAreas: Array.isArray(row?.companyAreas) ? row.companyAreas : [],
    };
  }
  authIndex.upsertEntry(entry);
}

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
  AMBIGUOUS_USERS_TAB_ROWS: "AMBIGUOUS_USERS_TAB_ROWS",
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
  [AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS]: "ambiguous_users_tab_rows",
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
  folderFirstDiagnostics = null,
  identityDiagnostics = null,
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
    companyFolderIdUsed: folderFirstDiagnostics?.companyFolderIdUsed,
    trustedMasterSheetId: folderFirstDiagnostics?.trustedMasterSheetId,
    staleCandidatesIgnored: folderFirstDiagnostics?.staleCandidatesIgnored,
  });
  const inactive = authFailureReason === AUTH_FAILURE_REASON.INACTIVE;
  const ambiguous = authFailureReason === AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS;
  const ambiguousMessage =
    "Multiple active Users tab rows match this email. Contact your company administrator.";
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
  if (folderFirstDiagnostics) {
    diagnostics.explicitFolderFirst = folderFirstDiagnostics.explicitFolderFirst === true;
    if (folderFirstDiagnostics.companyFolderIdUsed) {
      diagnostics.companyFolderIdUsed = folderFirstDiagnostics.companyFolderIdUsed;
    }
    if (folderFirstDiagnostics.trustedMasterSheetId) {
      diagnostics.trustedMasterSheetId = folderFirstDiagnostics.trustedMasterSheetId;
    }
    if (folderFirstDiagnostics.staleCandidatesIgnored?.length) {
      diagnostics.staleCandidatesIgnored = folderFirstDiagnostics.staleCandidatesIgnored;
    }
  }
  return {
    ok: false,
    reason: inactive ? "inactive" : ambiguous ? "ambiguous_users_tab_rows" : "invalid_credentials",
    httpStatus: inactive ? 403 : ambiguous ? 409 : httpStatus,
    code: inactive || ambiguous ? undefined : code,
    blocker: inactive ? "inactive" : ambiguous ? "ambiguous_users_tab_rows" : blocker,
    error: inactive
      ? "This account is inactive. Contact your company administrator."
      : ambiguous
        ? ambiguousMessage
        : message,
    message: inactive
      ? "This account is inactive. Contact your company administrator."
      : ambiguous
        ? ambiguousMessage
        : message,
    authFailureReason,
    reasonCode,
    diagnostics,
    identityDiagnostics: identityDiagnostics || null,
  };
}

function classifyVerifyFailure(verifyResult = {}) {
  if (verifyResult.reason === "ambiguous_users_tab_rows") {
    return AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS;
  }
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

/**
 * Resolve login identity (email or username) to a canonical company email.
 * Company-scoped username lookup preferred when companyFolderId/masterSheetId known.
 * Auth-index username aliases used for cold login; ambiguous cross-company usernames
 * return no match unless company scope uniquely selects one candidate.
 * Does not rely only on local auth-index byUsername — also derives usernames from
 * indexed emails and searches company Users tabs / LIVE registry when needed.
 */
export async function resolveCompanyLoginIdentity(auth, deps = {}, input = {}) {
  const identity = normalizeLoginIdentity(
    input.email || input.username || input.identity || input.identifier || input.emailOrUsername || "",
  );
  const companyFolderId = sanitizeCompanyFolderId(input.companyFolderId || input.sessionCompanyFolderId || "");
  const masterSheetId = sanitizeGoogleSpreadsheetId(input.masterSheetId || "");
  const diagnostics = {
    authIndexUsernameMatch: false,
    companyScopedUsersTabMatch: false,
  };

  if (!identity) {
    return { ok: false, reason: "missing_identity", email: "", username: "", diagnostics };
  }

  if (isLoginEmailIdentity(identity)) {
    return {
      ok: true,
      email: normalizeUserAuthEmail(identity),
      username: "",
      source: "email",
      diagnostics,
    };
  }

  const username = normalizeUsername(identity);
  if (!username) {
    return { ok: false, reason: "missing_identity", email: "", username: "", diagnostics };
  }

  if (typeof deps.authIndex?.lookupByUsername === "function") {
    const indexed = deps.authIndex.lookupByUsername(username, { companyFolderId });
    if (indexed?.email) {
      diagnostics.authIndexUsernameMatch = true;
      return {
        ok: true,
        email: normalizeUserAuthEmail(indexed.email),
        username,
        source: "auth_index_username",
        companyFolderId: indexed.companyFolderId || "",
        masterSheetId: indexed.masterSheetId || "",
        diagnostics,
      };
    }
  }

  // Fallback when byUsername aliases are missing/stale: derive from indexed emails.
  if (typeof deps.authIndex?.readAllEntries === "function") {
    const derivedMatches = [];
    for (const entry of deps.authIndex.readAllEntries()) {
      const derived = resolveUsernameFromUserFields({
        username: entry.username,
        email: entry.email,
      });
      if (derived !== username) {
        continue;
      }
      const entryFolder = sanitizeCompanyFolderId(entry.companyFolderId || entry.companyId || "");
      if (companyFolderId && entryFolder && entryFolder !== companyFolderId) {
        continue;
      }
      derivedMatches.push(entry);
    }
    const scoped =
      companyFolderId && derivedMatches.length > 1
        ? derivedMatches.filter(
            (entry) => sanitizeCompanyFolderId(entry.companyFolderId || entry.companyId || "") === companyFolderId,
          )
        : derivedMatches;
    if (scoped.length === 1 && scoped[0]?.email) {
      diagnostics.authIndexUsernameMatch = true;
      return {
        ok: true,
        email: normalizeUserAuthEmail(scoped[0].email),
        username,
        source: "auth_index_derived_username",
        companyFolderId: scoped[0].companyFolderId || companyFolderId || "",
        masterSheetId: scoped[0].masterSheetId || "",
        diagnostics,
      };
    }
  }

  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const sheetCandidates = [];
  if (masterSheetId) {
    sheetCandidates.push(masterSheetId);
  }

  if (!sheetCandidates.length && companyFolderId) {
    const getRegistryRecord =
      typeof deps.getCanonicalCompanyRegistryRecord === "function"
        ? deps.getCanonicalCompanyRegistryRecord
        : getCanonicalCompanyRegistryRecord;
    const record = await getRegistryRecord(auth, deps, companyFolderId).catch(() => null);
    const registrySheet = sanitizeGoogleSpreadsheetId(record?.masterSheetId || "");
    if (registrySheet) {
      sheetCandidates.push(registrySheet);
    }
  }

  if (!sheetCandidates.length && companyFolderId && typeof deps.resolveCompanyFromFolder === "function") {
    const resolved = await deps
      .resolveCompanyFromFolder(auth, deps, companyFolderId, { createIfMissing: false })
      .catch(() => null);
    const resolvedSheet = sanitizeGoogleSpreadsheetId(resolved?.masterSheetId || "");
    if (resolvedSheet) {
      sheetCandidates.push(resolvedSheet);
    }
  }

  const uniqueSheets = [...new Set(sheetCandidates.filter(Boolean))];
  for (const sheetId of uniqueSheets) {
    const row = await findCompanyUsersTabRow(auth, sheetId, username, {
      ...userDeps,
      preferredCompanyFolderId: companyFolderId,
      companyFolderId,
    }).catch(() => null);
    if (row?.email) {
      diagnostics.companyScopedUsersTabMatch = true;
      return {
        ok: true,
        email: normalizeUserAuthEmail(row.email),
        username,
        source: "users_tab_username",
        companyFolderId: row.companyFolderId || companyFolderId,
        masterSheetId: sheetId,
        diagnostics,
      };
    }
  }

  // Cold username login: LIVE registry fallback when folder/sheet hints are absent.
  if (!companyFolderId && !uniqueSheets.length) {
    const readRegistryMap =
      typeof deps.readCanonicalCompanyWorkspaceRegistryMap === "function"
        ? deps.readCanonicalCompanyWorkspaceRegistryMap
        : readCanonicalCompanyWorkspaceRegistryMap;
    const registryMap = await readRegistryMap(auth, deps).catch(() => null);
    const liveEntries = Object.values(registryMap || {}).filter(
      (entry) =>
        isCompanyRegistryLive(entry) && sanitizeGoogleSpreadsheetId(entry?.masterSheetId || ""),
    );
    const registryMatches = [];
    for (const entry of liveEntries) {
      const sheetId = sanitizeGoogleSpreadsheetId(entry.masterSheetId);
      const row = await findCompanyUsersTabRow(auth, sheetId, username, {
        ...userDeps,
        preferredCompanyFolderId: sanitizeCompanyFolderId(entry.companyFolderId || entry.companyId || ""),
        companyFolderId: sanitizeCompanyFolderId(entry.companyFolderId || entry.companyId || ""),
      }).catch(() => null);
      if (row?.email) {
        registryMatches.push({
          email: normalizeUserAuthEmail(row.email),
          companyFolderId: sanitizeCompanyFolderId(row.companyFolderId || entry.companyFolderId || entry.companyId || ""),
          masterSheetId: sheetId,
        });
      }
    }
    if (registryMatches.length === 1) {
      diagnostics.companyScopedUsersTabMatch = true;
      return {
        ok: true,
        email: registryMatches[0].email,
        username,
        source: "registry_users_tab_username",
        companyFolderId: registryMatches[0].companyFolderId,
        masterSheetId: registryMatches[0].masterSheetId,
        diagnostics,
      };
    }
  }

  if (uniqueSheets.length || companyFolderId) {
    diagnostics.companyScopedUsersTabMatch = false;
  }

  return { ok: false, reason: "username_not_found", email: "", username, diagnostics };
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
  const tRead = Date.now();
  const preferredFolderId = String(ctx.companyFolderId || ctx.companyId || deps.preferredCompanyFolderId || "").trim();
  let rec;
  try {
    rec = await readRecord(
      auth,
      ctx.masterSheetId,
      emailNorm,
      preferredFolderId ? { ...deps, preferredCompanyFolderId: preferredFolderId } : deps,
    );
  } catch (error) {
    if (error?.reasonCode === "ambiguous_users_tab_rows" || error?.code === "AMBIGUOUS_USERS_TAB_ROWS") {
      throw error;
    }
    rec = null;
  }
  deps.loginTiming?.logPhase?.("users_tab_read", tRead, {
    masterSheetId: ctx.masterSheetId,
    rowFound: Boolean(rec),
  });
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

export async function verifyUserPasswordFromUsersTab(auth, companyContext, email, plainPassword, deps, existingRow = null) {
  const ctx = resolveUserAuthCompanyContext(companyContext);
  let row = existingRow;
  if (!row) {
    try {
      row = await readUserAuthRowByEmail(auth, ctx, email, deps);
    } catch (error) {
      if (error?.reasonCode === "ambiguous_users_tab_rows" || error?.code === "AMBIGUOUS_USERS_TAB_ROWS") {
        return { ok: false, reason: "ambiguous_users_tab_rows", rowFound: true };
      }
      throw error;
    }
  }
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
  const tPassword = Date.now();
  const verifyOk = verifyPassword(String(plainPassword || ""), row.passwordHash);
  deps.loginTiming?.logPhase?.("password_check", tPassword, {
    masterSheetId: row.masterSheetId,
    verifyOk,
  });
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
    // Login discovery must not await Users-tab schema migration (slow / can throw and skip candidates).
    migrateUsersTabColumns: undefined,
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

async function resolveFolderFirstContext(auth, deps, companyFolderId, masterSheetId = "", options = {}) {
  const resolveFn = resolveFolderContextFn(deps);
  const sheetHint =
    options.skipSheetHint === true ? "" : sanitizeGoogleSpreadsheetId(masterSheetId);
  return resolveFn(auth, resolverDeps(deps), companyFolderId, {
    ...LIGHT_RESOLVE_OPTS,
    ...(sheetHint ? { masterSheetId: sheetHint, createIfMissing: false } : {}),
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
  const resolvedSheetId = sanitizeGoogleSpreadsheetId(resolved?.masterSheetId);
  return {
    masterSheetId: resolvedSheetId || hintedSheetId,
    companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId) || rowFolderId,
    companyId: sanitizeCompanyFolderId(resolved?.companyId || resolved?.companyFolderId) || rowFolderId,
    companyName,
  };
}

/** Folder-discovered workbook is authoritative; paired sheet hint only when discovery finds nothing. */
async function pickLoginMasterSheetId(auth, userDeps, email, { pairedSheetId, resolved } = {}) {
  const pairedId = sanitizeGoogleSpreadsheetId(pairedSheetId);
  const resolvedId = sanitizeGoogleSpreadsheetId(resolved?.masterSheetId);
  if (resolvedId) {
    return resolvedId;
  }
  if (pairedId) {
    return pairedId;
  }
  return "";
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
    if (!usersTab) {
      continue;
    }
    let liveEmailScan = null;
    if (typeof userDeps.getTabValues === "function" && usersTab.usersTabTitle) {
      const rows = await userDeps
        .getTabValues(auth, masterSheetId, usersTab.usersTabTitle)
        .catch(() => []);
      if (rows.length) {
        liveEmailScan = summarizeUsersTabEmailScanForLoginLog(rows, email);
      }
    }
    diagnostics.push({
      ...usersTab,
      ...(liveEmailScan
        ? {
            liveHeaders: liveEmailScan.headers,
            liveRowCount: liveEmailScan.rowCount,
            targetEmailColumnHits: liveEmailScan.targetEmailScan.hits,
            targetEmailFoundAnywhere: liveEmailScan.targetEmailScan.found,
          }
        : {}),
    });
  }
  const payload = {
    email: normalizeUserAuthEmail(email) || "(missing)",
    candidateMasterSheetIds: [...sheetIds],
    resolvedCompanyFolderIds: [...folderIds],
    usersTabLookups: diagnostics,
  };
  // TODO(remove): temporary USER_NOT_FOUND investigation — safe fields only.
  console.warn("[company-auth] users tab login diagnostics", payload);
  return payload;
}

function pairedSheetIdsFromFolderAttempts(attempts = []) {
  const paired = new Set();
  for (const attempt of attempts) {
    if (attempt.type === "folder" && attempt.masterSheetId) {
      paired.add(sanitizeGoogleSpreadsheetId(attempt.masterSheetId));
    }
  }
  return paired;
}

/** Safe enum for where login companyFolderId hint originated — never logs the id value. */
export function resolveLoginCompanyFolderIdSource(input = {}, deps = {}, email = "") {
  const bodyFolderId = sanitizeCompanyFolderId(input.companyFolderId);
  if (bodyFolderId) {
    return "body";
  }
  const bodyCompanyId = sanitizeCompanyFolderId(input.companyId);
  if (bodyCompanyId) {
    return "body";
  }
  const sessionFolderId = sanitizeCompanyFolderId(input.sessionCompanyFolderId);
  if (sessionFolderId) {
    return "session";
  }
  const emailNorm = normalizeUserAuthEmail(email || input.email);
  const indexEntry =
    typeof deps.authIndex?.lookupByEmail === "function" ? deps.authIndex.lookupByEmail(emailNorm) : null;
  const indexFolderId = sanitizeCompanyFolderId(indexEntry?.companyFolderId || indexEntry?.companyId);
  if (indexFolderId && !isKnownStaleAuthIndexPairing(emailNorm, indexEntry?.companyName)) {
    return "persisted_hint";
  }
  return "none";
}

function dedupeLoginAttempts(attempts = []) {
  const seen = new Set();
  const folderPairedSheets = pairedSheetIdsFromFolderAttempts(attempts);
  const out = [];
  for (const attempt of attempts) {
    if (attempt.type === "sheet_hint") {
      const sheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
      if (sheetId && folderPairedSheets.has(sheetId)) {
        continue;
      }
    }
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

/** Stale sheet/auth-index/invite hints suppressed when companyFolderId is already known. */
export function collectIgnoredStaleLoginCandidates(input = {}, deps = {}, trustedFolderIds = []) {
  if (!trustedFolderIds.length) {
    return [];
  }
  const ignored = [];
  const hintedSheetId = sanitizeGoogleSpreadsheetId(input.masterSheetId || input.requestedSheetId);
  if (hintedSheetId) {
    ignored.push(`sheet:${hintedSheetId}:session_or_body_masterSheetId`);
  }
  const email = normalizeUserAuthEmail(input.email);
  const indexEntry =
    typeof deps.authIndex?.lookupByEmail === "function" ? deps.authIndex.lookupByEmail(email) : null;
  if (indexEntry) {
    const indexSheetId = sanitizeGoogleSpreadsheetId(indexEntry.masterSheetId);
    const indexFolderId = sanitizeCompanyFolderId(indexEntry.companyFolderId || indexEntry.companyId);
    if (indexFolderId && !trustedFolderIds.includes(indexFolderId)) {
      ignored.push(`folder:${indexFolderId}:auth_index`);
    } else if (indexSheetId) {
      ignored.push(`sheet:${indexSheetId}:auth_index`);
    }
  }
  if (typeof deps.findMasterSheetIdsForCompanyLoginEmail === "function") {
    for (const sheetId of deps.findMasterSheetIdsForCompanyLoginEmail(email) || []) {
      const sanitized = sanitizeGoogleSpreadsheetId(sheetId);
      if (sanitized) {
        ignored.push(`sheet:${sanitized}:invite_hint`);
      }
    }
  }
  return [...new Set(ignored)];
}

export function collectLoginResolutionAttempts(input = {}, deps = {}) {
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
  const sessionFolderId = sanitizeCompanyFolderId(input.sessionCompanyFolderId);
  const trustedFolderIds = resolveTrustedFolderIds(input);
  // Selected company folder is source of truth — when known, only folder candidates are collected.
  if (hintedFolderId) {
    pushFolder(hintedFolderId, trustedFolderIds.length ? "" : hintedSheetId);
  } else if (sessionFolderId) {
    pushFolder(sessionFolderId, trustedFolderIds.length ? "" : hintedSheetId);
  }

  // Users-first: body/session masterSheetId before slow auth-index folder hints.
  if (hintedSheetId && !trustedFolderIds.length) {
    pushSheet(hintedSheetId);
  }

  const email = normalizeUserAuthEmail(input.email);
  const indexEntry =
    typeof deps.authIndex?.lookupByEmail === "function" ? deps.authIndex.lookupByEmail(email) : null;
  if (
    indexEntry &&
    !isKnownStaleAuthIndexPairing(email, indexEntry.companyName) &&
    !trustedFolderIds.length
  ) {
    const indexSheetId = sanitizeGoogleSpreadsheetId(indexEntry.masterSheetId);
    const indexFolderId = sanitizeCompanyFolderId(indexEntry.companyFolderId || indexEntry.companyId);
    if (indexFolderId) {
      pushFolder(indexFolderId, indexSheetId);
    } else if (indexSheetId) {
      pushSheet(indexSheetId);
    }
  }

  if (typeof deps.findMasterSheetIdsForCompanyLoginEmail === "function") {
    for (const sheetId of deps.findMasterSheetIdsForCompanyLoginEmail(email) || []) {
      const sanitized = sanitizeGoogleSpreadsheetId(sheetId);
      if (sanitized && !trustedFolderIds.length) {
        pushSheet(sanitized);
      }
    }
  }
  return dedupeLoginAttempts(attempts);
}

function scheduleSheetHintFolderResolveRefresh(auth, deps, companyFolderId, masterSheetId, timingDeps) {
  const folderId = sanitizeCompanyFolderId(companyFolderId);
  const sheetId = sanitizeGoogleSpreadsheetId(masterSheetId);
  if (!folderId || !sheetId) {
    return;
  }
  const tFolder = Date.now();
  resolveFolderFirstContext(auth, deps, folderId, sheetId)
    .then((resolved) => {
      timingDeps?.loginTiming?.logPhase?.("folder_company_resolve", tFolder, {
        companyFolderId: folderId,
        source: "sheet_hint_background",
        resolved: Boolean(resolved?.masterSheetId || resolved?.companyFolderId),
      });
    })
    .catch(() => null);
}

function buildLoginSuccessEntry(email, row, companyContext, deps) {
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
    upsertLoginAuthIndexFromUsersTabRow(deps.authIndex, row, companyContext, email);
    const indexed = deps.authIndex.lookupByEmail?.(email);
    if (indexed) {
      entry.name = indexed.name || entry.name;
      entry.role = indexed.role || entry.role;
      entry.accessLevel = indexed.accessLevel || entry.accessLevel;
      entry.companyAreas = indexed.companyAreas?.length ? indexed.companyAreas : entry.companyAreas;
      entry.companyName = indexed.companyName || entry.companyName;
    }
  }
  return entry;
}

function buildLoginAttemptFailure(verifyResult, authFailureReason, inactive = false) {
  return {
    ok: false,
    authFailureReason:
      verifyResult?.reason === "inactive" || inactive
        ? AUTH_FAILURE_REASON.INACTIVE
        : authFailureReason || classifyVerifyFailure(verifyResult || {}),
    inactive: verifyResult?.reason === "inactive" || inactive,
    rowFound: verifyResult?.rowFound === true,
  };
}

/** Users tab read + password verify — uses existingRow from same-request cache miss (no second read). */
async function verifyUsersTabLoginAttempt(
  auth,
  deps,
  companyContext,
  email,
  password,
  timingDeps,
  existingRow = null,
  folderFirst = false,
) {
  const verifyResult = await verifyUserPasswordFromUsersTab(
    auth,
    companyContext,
    email,
    password,
    timingDeps,
    existingRow,
  );
  if (!verifyResult.ok) {
    return buildLoginAttemptFailure(verifyResult, classifyVerifyFailure(verifyResult));
  }
  const row = verifyResult.row;
  return {
    ok: true,
    email,
    row,
    companyContext,
    entry: buildLoginSuccessEntry(email, row, companyContext, deps),
    folderFirst,
  };
}

/**
 * sheet_hint — Users tab first; folder resolve is background hint refresh only (never blocks login).
 */
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
  const companyContext = buildCompanyContextFromHintedSheet(row, hintedSheetId, null);
  if (!companyContext) {
    return { ok: false, reason: "company_context_failed", row };
  }
  scheduleSheetHintFolderResolveRefresh(auth, deps, rowFolderId, hintedSheetId, userDeps);
  return {
    ok: true,
    companyContext,
    row,
  };
}

/** sheet_hint path — cache miss row is passed straight into password_check (same request). */
async function tryUsersTabSheetHintLogin(auth, deps, masterSheetId, email, password, userDeps, timingDeps) {
  const hinted = await companyContextFromSheetHint(auth, deps, masterSheetId, email, timingDeps);
  if (!hinted.ok) {
    return {
      ok: false,
      authFailureReason:
        hinted.reason === "inactive"
          ? AUTH_FAILURE_REASON.INACTIVE
          : classifyContextFailure(hinted.reason),
      inactive: hinted.reason === "inactive",
      rowFound: Boolean(hinted.row),
    };
  }
  return verifyUsersTabLoginAttempt(
    auth,
    deps,
    hinted.companyContext,
    email,
    password,
    timingDeps,
    hinted.row,
    false,
  );
}

function buildFolderAttemptCompanyContext(attempt, resolved, masterSheetId, rowOnSheet) {
  const folderWorkbookId = sanitizeGoogleSpreadsheetId(resolved?.masterSheetId) || masterSheetId;
  if (rowOnSheet) {
    const fallback = buildCompanyContextFromHintedSheet(rowOnSheet, folderWorkbookId, resolved);
    return (
      fallback || {
        masterSheetId: folderWorkbookId,
        companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId || attempt.companyFolderId),
        companyId: sanitizeCompanyFolderId(
          resolved?.companyId || resolved?.companyFolderId || attempt.companyFolderId,
        ),
        companyName: String(resolved?.companyName || rowOnSheet.companyName || "").trim(),
      }
    );
  }
  return {
    masterSheetId: folderWorkbookId,
    companyFolderId: sanitizeCompanyFolderId(resolved?.companyFolderId || attempt.companyFolderId),
    companyId: sanitizeCompanyFolderId(
      resolved?.companyId || resolved?.companyFolderId || attempt.companyFolderId,
    ),
    companyName: String(resolved?.companyName || "").trim(),
  };
}

async function resolveFolderLoginContext(
  auth,
  deps,
  attempt,
  email,
  userDeps,
  timingDeps,
  candidateIndex,
  options = {},
) {
  const pairedSheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
  const tFolder = Date.now();
  const resolved = await resolveFolderFirstContext(auth, deps, attempt.companyFolderId, pairedSheetId, {
    skipSheetHint: options.folderFirstStrict === true,
  });
  timingDeps.loginTiming?.logPhase?.("folder_company_resolve", tFolder, {
    companyFolderId: attempt.companyFolderId,
    resolved: Boolean(resolved?.masterSheetId || resolved?.companyFolderId),
    ...loginCandidateTimingMeta(attempt, candidateIndex),
  });
  const masterSheetId = await pickLoginMasterSheetId(auth, userDeps, email, { pairedSheetId, resolved });
  if (!masterSheetId) {
    return {
      ok: false,
      authFailureReason: AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
    };
  }
  const rowOnSheet = await readUserAuthRowByEmail(auth, { masterSheetId }, email, timingDeps).catch(() => null);
  return {
    ok: true,
    companyContext: buildFolderAttemptCompanyContext(attempt, resolved, masterSheetId, rowOnSheet),
    rowOnSheet,
  };
}

async function resolveSingleLoginAttempt(
  auth,
  deps,
  attempt,
  email,
  password,
  userDeps,
  timingDeps,
  candidateIndex,
  options = {},
) {
  if (attempt.type === "sheet_hint") {
    const sheetResult = await tryUsersTabSheetHintLogin(
      auth,
      deps,
      attempt.masterSheetId,
      email,
      password,
      userDeps,
      timingDeps,
    );
    if (!sheetResult.ok && sheetResult.rowFound === false) {
      await logUsersTabLookupDiagnostics(
        auth,
        userDeps,
        { masterSheetId: attempt.masterSheetId },
        email,
        attempt.type,
      ).catch(() => null);
    }
    return sheetResult;
  }

  const folderFirstStrict = options.folderFirstStrict === true;
  const pairedSheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
  if (pairedSheetId && !options.skipPairedSheetUsersFirst && !folderFirstStrict) {
    const pairedResult = await tryUsersTabSheetHintLogin(
      auth,
      deps,
      pairedSheetId,
      email,
      password,
      userDeps,
      timingDeps,
    );
    if (pairedResult.ok) {
      return { ...pairedResult, folderFirst: true };
    }
    // Inactive on a paired sheet hint must not block folder resolve — another workbook
    // under the trusted company folder may own the ACTIVE login row.
    if (pairedResult.inactive && options.stopOnPairedInactive === true) {
      return pairedResult;
    }
  }

  let folderContext = options.folderContext;
  if (!folderContext) {
    folderContext = await resolveFolderLoginContext(
      auth,
      deps,
      attempt,
      email,
      userDeps,
      timingDeps,
      candidateIndex,
      { folderFirstStrict },
    );
  }
  if (!folderContext.ok) {
    return folderContext;
  }

  const folderResult = await verifyUsersTabLoginAttempt(
    auth,
    deps,
    folderContext.companyContext,
    email,
    password,
    timingDeps,
    folderContext.rowOnSheet,
    true,
  );
  if (!folderResult.ok && folderResult.rowFound === false) {
    await logUsersTabLookupDiagnostics(
      auth,
      userDeps,
      folderContext.companyContext,
      email,
      attempt.type,
    ).catch(() => null);
  }
  return folderResult;
}

/**
 * Company user login — Users tab PasswordHash is source of truth.
 * sheet_hint: Users tab read + password verify first; folder resolve is background hint refresh only.
 * folder candidates: folder resolve then Users tab verify. Auth index only narrows candidates.
 */
export async function authenticateCompanyUserLogin(auth, deps = {}, input = {}) {
  const password = String(input.password || "");
  if (!auth || !password) {
    return buildLoginAuthFailure({
      email: normalizeUserAuthEmail(input.email || input.username || ""),
      authFailureReason: !password
        ? AUTH_FAILURE_REASON.PASSWORD_MISSING
        : AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
      httpStatus: 400,
      code: "MISSING_FIELDS",
      blocker: "missing_fields",
      message: "Email or username and password are required.",
      failedStep: "input_validation",
    });
  }

  const resolvedIdentity = await resolveCompanyLoginIdentity(auth, deps, input);
  if (!resolvedIdentity.ok || !resolvedIdentity.email) {
    return buildLoginAuthFailure({
      email: normalizeUserAuthEmail(input.email || input.username || ""),
      authFailureReason: AUTH_FAILURE_REASON.USER_NOT_FOUND,
      httpStatus: 401,
      code: "USER_NOT_FOUND",
      blocker: "user_not_found",
      message: "Email, username, or password is incorrect.",
      failedStep: "identity_resolve",
      identityDiagnostics: resolvedIdentity.diagnostics || null,
    });
  }

  const email = normalizeUserAuthEmail(resolvedIdentity.email);
  // Resolve username → email only; leave workbook discovery to collectLoginResolutionAttempts
  // (auth-index by email / hints), same as a normal email login. Do not force folder-first
  // from identity aliases alone — that can stall on Drive folder resolve during cold login.
  // When username was resolved via company Users tab / LIVE registry, keep sheet/folder hints.
  const resolvedInput = {
    ...input,
    email,
  };
  if (
    resolvedIdentity.masterSheetId &&
    !sanitizeGoogleSpreadsheetId(input.masterSheetId || "")
  ) {
    resolvedInput.masterSheetId = resolvedIdentity.masterSheetId;
  }
  if (
    (resolvedIdentity.source === "users_tab_username" ||
      resolvedIdentity.source === "registry_users_tab_username") &&
    resolvedIdentity.companyFolderId &&
    !sanitizeCompanyFolderId(input.companyFolderId || input.sessionCompanyFolderId || "")
  ) {
    resolvedInput.companyFolderId = resolvedIdentity.companyFolderId;
  }

  if (!auth || !email || !password) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: !password
        ? AUTH_FAILURE_REASON.PASSWORD_MISSING
        : AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
      httpStatus: 400,
      code: "MISSING_FIELDS",
      blocker: "missing_fields",
      message: "Email or username and password are required.",
      failedStep: "input_validation",
    });
  }

  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const loginTiming = deps.loginTiming;
  const timingDeps = loginTiming ? { ...userDeps, loginTiming } : userDeps;
  const tCandidates = Date.now();
  const attempts = collectLoginResolutionAttempts(resolvedInput, deps);
  const trustedFolderIds = resolveTrustedFolderIds(resolvedInput);
  const explicitFolderFirst = trustedFolderIds.length > 0;
  const ignoredStaleCandidates = collectIgnoredStaleLoginCandidates(resolvedInput, deps, trustedFolderIds);
  const effectiveAttempts = explicitFolderFirst
    ? attempts.filter((attempt) => isTrustedFolderCandidate(attempt, trustedFolderIds))
    : attempts;
  const companyFolderIdSource = resolveLoginCompanyFolderIdSource(resolvedInput, deps, email);
  loginTiming?.logMark?.("login_resolution_diagnostics", {
    explicitFolderFirst,
    companyFolderIdSource,
    attemptCount: effectiveAttempts.length,
    staleCandidatesIgnored: ignoredStaleCandidates,
    candidateOrder: effectiveAttempts.map((attempt) => loginCandidateLabel(attempt)).join("|"),
  });
  loginTiming?.logPhase?.("collect_login_candidates", tCandidates, {
    ...loginTimingEmailMeta(email),
    attemptCount: effectiveAttempts.length,
    staleCandidatesIgnored: ignoredStaleCandidates,
    candidateOrder: effectiveAttempts.map((attempt, index) => loginCandidateLabel(attempt, index)).join("|"),
    candidateTimeoutMs: LOGIN_CANDIDATE_TIMEOUT_MS,
  });

  let inactiveHit = false;
  let trustedInactiveHit = false;
  let lastAuthFailureReason = AUTH_FAILURE_REASON.USER_NOT_FOUND;
  let usersTabDiagnostics = null;
  const buildFolderFirstDiagnostics = (attempt, attemptResult = {}) => ({
    explicitFolderFirst: true,
    companyFolderIdUsed: sanitizeCompanyFolderId(attempt?.companyFolderId) || trustedFolderIds[0] || "",
    trustedMasterSheetId:
      sanitizeGoogleSpreadsheetId(attemptResult?.companyContext?.masterSheetId) ||
      sanitizeGoogleSpreadsheetId(attemptResult?.row?.masterSheetId) ||
      "",
    staleCandidatesIgnored: ignoredStaleCandidates,
  });
  for (let candidateIndex = 0; candidateIndex < effectiveAttempts.length; candidateIndex += 1) {
    const attempt = effectiveAttempts[candidateIndex];
    const candidateMeta = loginCandidateTimingMeta(attempt, candidateIndex);
    const tAttempt = Date.now();
    loginTiming?.logPhase?.("candidate_attempt_start", tAttempt, {
      ...candidateMeta,
      candidateTimeoutMs: LOGIN_CANDIDATE_TIMEOUT_MS,
    });
    const trustedFolder = isTrustedFolderCandidate(attempt, trustedFolderIds);
    const sheetHint = isSheetHintCandidate(attempt);
    const attemptTimingGuard = createLoginAttemptTimingGuard(loginTiming);
    const attemptTimingDeps = attemptTimingGuard.wrapTimingDeps(timingDeps);
    let attemptResult;
    try {
      if (trustedFolder || sheetHint) {
        loginTiming?.logPhase?.("candidate_attempt_await", tAttempt, {
          ...candidateMeta,
          trustedFolder: trustedFolder === true,
          sheetHint: sheetHint === true,
        });
        attemptResult = await resolveSingleLoginAttempt(
          auth,
          deps,
          attempt,
          email,
          password,
          userDeps,
          attemptTimingDeps,
          candidateIndex,
          { folderFirstStrict: explicitFolderFirst && trustedFolder },
        );
      } else if (attempt.type === "folder") {
        loginTiming?.logPhase?.("candidate_attempt_await", tAttempt, {
          ...candidateMeta,
          folderResolveOnlyTimeout: true,
        });
        const pairedSheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
        if (pairedSheetId) {
          const pairedResult = await tryUsersTabSheetHintLogin(
            auth,
            deps,
            pairedSheetId,
            email,
            password,
            userDeps,
            attemptTimingDeps,
          );
          if (pairedResult.ok) {
            attemptResult = { ...pairedResult, folderFirst: true };
          } else {
            // Non-trusted paired-sheet miss/inactive is not final; resolve folder workbook next.
            let folderContext;
            try {
              folderContext = await raceLoginCandidateAttempt(
                () =>
                  resolveFolderLoginContext(
                    auth,
                    deps,
                    attempt,
                    email,
                    userDeps,
                    attemptTimingDeps,
                    candidateIndex,
                  ),
                LOGIN_CANDIDATE_TIMEOUT_MS,
                loginCandidateLabel(attempt),
              );
            } catch (error) {
              throw error;
            }
            if (!folderContext?.ok) {
              attemptResult = folderContext || {
                ok: false,
                authFailureReason: AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
              };
            } else {
              attemptResult = await verifyUsersTabLoginAttempt(
                auth,
                deps,
                folderContext.companyContext,
                email,
                password,
                attemptTimingDeps,
                folderContext.rowOnSheet,
                true,
              );
              if (!attemptResult.ok && attemptResult.rowFound === false) {
                await logUsersTabLookupDiagnostics(
                  auth,
                  userDeps,
                  folderContext.companyContext,
                  email,
                  attempt.type,
                ).catch(() => null);
              }
            }
          }
        } else {
          let folderContext;
          folderContext = await raceLoginCandidateAttempt(
            () =>
              resolveFolderLoginContext(
                auth,
                deps,
                attempt,
                email,
                userDeps,
                attemptTimingDeps,
                candidateIndex,
              ),
            LOGIN_CANDIDATE_TIMEOUT_MS,
            loginCandidateLabel(attempt),
          );
          if (!folderContext?.ok) {
            attemptResult = folderContext || {
              ok: false,
              authFailureReason: AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
            };
          } else {
            attemptResult = await verifyUsersTabLoginAttempt(
              auth,
              deps,
              folderContext.companyContext,
              email,
              password,
              attemptTimingDeps,
              folderContext.rowOnSheet,
              true,
            );
            if (!attemptResult.ok && attemptResult.rowFound === false) {
              await logUsersTabLookupDiagnostics(
                auth,
                userDeps,
                folderContext.companyContext,
                email,
                attempt.type,
              ).catch(() => null);
            }
          }
        }
      } else {
        attemptResult = await raceLoginCandidateAttempt(
          () =>
            resolveSingleLoginAttempt(
              auth,
              deps,
              attempt,
              email,
              password,
              userDeps,
              attemptTimingDeps,
              candidateIndex,
            ),
          LOGIN_CANDIDATE_TIMEOUT_MS,
        );
      }
    } catch (error) {
      if (String(error?.message || "").includes("_timeout")) {
        attemptTimingGuard.detach();
        loginTiming?.logPhase?.("candidate_attempt_timeout", tAttempt, {
          ...candidateMeta,
          candidateTimeoutMs: LOGIN_CANDIDATE_TIMEOUT_MS,
        });
        loginTiming?.logPhase?.("candidate_attempt_skipped", Date.now(), {
          ...candidateMeta,
          reason: "timeout",
        });
        if (trustedFolder && explicitFolderFirst) {
          return buildLoginAuthFailure({
            email,
            authFailureReason: AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED,
            attemptCount: effectiveAttempts.length,
            folderFirstDiagnostics: buildFolderFirstDiagnostics(attempt),
          });
        }
        if (!trustedFolder) {
          lastAuthFailureReason = AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED;
        }
        continue;
      }
      throw error;
    }

    if (!attemptResult.ok) {
      const folderFirstDiag = buildFolderFirstDiagnostics(attempt, attemptResult);
      if (attemptResult.authFailureReason === AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS) {
        // Ambiguous ACTIVE duplicates on a trusted workbook are final — never silently pick a row.
        if (trustedFolder) {
          return buildLoginAuthFailure({
            email,
            authFailureReason: AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS,
            attemptCount: effectiveAttempts.length,
            folderFirstDiagnostics: explicitFolderFirst ? folderFirstDiag : null,
          });
        }
        lastAuthFailureReason = AUTH_FAILURE_REASON.AMBIGUOUS_USERS_TAB_ROWS;
        continue;
      }
      if (attemptResult.inactive) {
        // Only trusted company-folder inactivity is final. Stale invite/auth-index sheet
        // candidates can match emails in Name/Role cells and must not win over a later
        // ACTIVE Users row under the selected company folder.
        if (trustedFolder) {
          trustedInactiveHit = true;
          lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
          if (explicitFolderFirst) {
            return buildLoginAuthFailure({
              email,
              authFailureReason: AUTH_FAILURE_REASON.INACTIVE,
              attemptCount: effectiveAttempts.length,
              folderFirstDiagnostics: folderFirstDiag,
            });
          }
        } else {
          inactiveHit = true;
          if (lastAuthFailureReason === AUTH_FAILURE_REASON.USER_NOT_FOUND) {
            lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
          }
        }
      } else {
        lastAuthFailureReason = attemptResult.authFailureReason || AUTH_FAILURE_REASON.USER_NOT_FOUND;
      }
      if (explicitFolderFirst && trustedFolder) {
        return buildLoginAuthFailure({
          email,
          authFailureReason: lastAuthFailureReason,
          attemptCount: effectiveAttempts.length,
          folderFirstDiagnostics: folderFirstDiag,
        });
      }
      continue;
    }

    loginTiming?.logPhase?.("candidate_attempt_success", tAttempt, {
      ...candidateMeta,
      folderFirst: attemptResult.folderFirst === true,
      companyFolderIdUsed: attempt.companyFolderId,
      trustedMasterSheetId: attemptResult.companyContext?.masterSheetId,
      staleCandidatesIgnored: explicitFolderFirst ? ignoredStaleCandidates : undefined,
    });
    return {
      ok: true,
      email: attemptResult.email,
      row: attemptResult.row,
      companyContext: attemptResult.companyContext,
      entry: attemptResult.entry,
    };
  }

  if (!trustedFolderIds.length) {
    loginTiming?.logMark?.("login_resolution_diagnostics", {
      explicitFolderFirst: false,
      companyFolderIdSource: "fallback",
      attemptCount: attempts.length,
      candidateOrder: attempts.map((attempt) => loginCandidateLabel(attempt)).join("|"),
    });
    try {
      const registryResult = await raceLoginCandidateAttempt(
        async () => {
          const registryContext = await resolveCompanyContextForUser(
            auth,
            email,
            registryLookupDeps(deps, userDeps),
          ).catch(() => null);
          if (!registryContext?.masterSheetId) {
            return { ok: false, skip: true };
          }
          const companyContext = {
            masterSheetId: registryContext.masterSheetId,
            companyFolderId: registryContext.companyFolderId,
            companyId: registryContext.companyId || registryContext.companyFolderId,
            companyName: registryContext.companyName,
          };
          const verifyResult = await verifyUserPasswordFromUsersTab(
            auth,
            companyContext,
            email,
            password,
            timingDeps,
          );
          if (!verifyResult.ok) {
            return {
              ok: false,
              inactive: verifyResult.reason === "inactive",
              authFailureReason:
                verifyResult.reason === "inactive"
                  ? AUTH_FAILURE_REASON.INACTIVE
                  : classifyVerifyFailure(verifyResult),
            };
          }
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
            upsertLoginAuthIndexFromUsersTabRow(deps.authIndex, row, companyContext, email);
          }
          return { ok: true, email, row, companyContext, entry };
        },
        LOGIN_REGISTRY_FALLBACK_TIMEOUT_MS,
        "registry_login_fallback",
      );
      if (registryResult.ok) {
        return registryResult;
      }
      if (registryResult.inactive) {
        inactiveHit = true;
        lastAuthFailureReason = AUTH_FAILURE_REASON.INACTIVE;
      } else if (!registryResult.skip && registryResult.authFailureReason) {
        lastAuthFailureReason = registryResult.authFailureReason;
      }
    } catch (error) {
      if (String(error?.message || "").includes("_timeout")) {
        loginTiming?.logPhase?.("candidate_attempt_timeout", Date.now(), {
          candidateType: "registry_fallback",
          candidateTimeoutMs: LOGIN_REGISTRY_FALLBACK_TIMEOUT_MS,
        });
        loginTiming?.logPhase?.("candidate_attempt_skipped", Date.now(), {
          candidateType: "registry_fallback",
          reason: "timeout",
        });
        lastAuthFailureReason = AUTH_FAILURE_REASON.COMPANY_WORKBOOK_NOT_RESOLVED;
      } else {
        throw error;
      }
    }
  }

  if (trustedInactiveHit) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: AUTH_FAILURE_REASON.INACTIVE,
      attemptCount: effectiveAttempts.length,
      folderFirstDiagnostics: explicitFolderFirst
        ? {
            explicitFolderFirst: true,
            companyFolderIdUsed: trustedFolderIds[0] || "",
            staleCandidatesIgnored: ignoredStaleCandidates,
          }
        : null,
    });
  }

  if (lastAuthFailureReason === AUTH_FAILURE_REASON.USER_NOT_FOUND) {
    try {
      usersTabDiagnostics = await raceLoginCandidateAttempt(
        () => logLoginUsersTabDiagnostics(auth, userDeps, email, effectiveAttempts, []),
        LOGIN_CANDIDATE_TIMEOUT_MS,
        "login_failure_diagnostics",
      );
    } catch (error) {
      if (String(error?.message || "").includes("_timeout")) {
        loginTiming?.logPhase?.("candidate_attempt_skipped", Date.now(), {
          candidateType: "failure_diagnostics",
          reason: "timeout",
        });
      } else {
        throw error;
      }
      const sheetIds = new Set();
      for (const attempt of effectiveAttempts) {
        const sheetId = sanitizeGoogleSpreadsheetId(attempt.masterSheetId);
        if (sheetId) {
          sheetIds.add(sheetId);
        }
      }
      usersTabDiagnostics = {
        candidateMasterSheetIds: [...sheetIds],
        usersTabLookups: [],
      };
    }
  }

  if (!effectiveAttempts.length) {
    return buildLoginAuthFailure({
      email,
      authFailureReason: AUTH_FAILURE_REASON.NO_LOGIN_CANDIDATES,
      failedStep: "collect_attempts",
      attemptCount: 0,
      folderFirstDiagnostics: explicitFolderFirst
        ? {
            explicitFolderFirst: true,
            companyFolderIdUsed: trustedFolderIds[0] || "",
            staleCandidatesIgnored: ignoredStaleCandidates,
          }
        : null,
    });
  }

  return buildLoginAuthFailure({
    email,
    authFailureReason: lastAuthFailureReason,
    attemptCount: effectiveAttempts.length,
    usersTabDiagnostics,
    folderFirstDiagnostics: explicitFolderFirst
      ? {
          explicitFolderFirst: true,
          companyFolderIdUsed: trustedFolderIds[0] || "",
          staleCandidatesIgnored: ignoredStaleCandidates,
        }
      : null,
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
    const verifyResult = await verifyUserPasswordFromUsersTab(
      auth,
      companyContext,
      email,
      password,
      userDeps,
      hinted.row,
    );
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
