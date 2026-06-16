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
} from "./company-users.mjs";
import { pickRowCompanyFolderId, pickRowCompanyId, pickRowCompanyName } from "./users-tab-schema.mjs";
import { sanitizeCompanyFolderId } from "../shared/google-drive-id.mjs";

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
  const row = await readUserAuthRowByEmail(auth, companyContext, email, deps);
  if (!row) {
    return { ok: false, reason: "user_not_found", rowFound: false };
  }
  if (String(row.status || "").toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: "inactive", rowFound: true, status: row.status };
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
    const verifyResult = await verifyUserPasswordFromUsersTab(
      auth,
      { masterSheetId },
      email,
      password,
      deps.getCompanyUsersDeps?.() || deps,
    );
    if (!verifyResult.ok) {
      continue;
    }
    const row = verifyResult.row;
    const companyContext = {
      masterSheetId,
      companyFolderId:
        sanitizeCompanyFolderId(row.companyFolderId || row.companyId || "") || "",
      companyId:
        sanitizeCompanyFolderId(row.companyId || row.companyFolderId || "") || "",
      companyName: String(row.companyName || pickRowCompanyName(row.rowObject || row) || "").trim(),
    };
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
