/**
 * Verification-only company user lifecycle for production Users & Permissions gate.
 */
import { hashPassword } from "./master-auth.mjs";
import { defaultAccessLevelForRole, writeUsersTabRecordByHeaders } from "./company-users.mjs";
import { readCompanyUsers } from "./users-tab-reader.mjs";
import { invalidateUsersTabCache } from "./users-tab-cache.mjs";
import { patchTabRowByHeader } from "./workbook-service.mjs";
import { USERS_TAB } from "./users-tab-constants.mjs";
import {
  buildProductionVerificationUserId,
  buildVerificationUserCreateInput,
  isActiveVerificationUserRecord,
  isVerificationUserEmail,
  isVerificationUserRecord,
  PRODUCTION_VERIFICATION_USER_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_USER_CREATED_BY,
  PRODUCTION_VERIFICATION_USER_SOURCE,
} from "../shared/production-verification-user.mjs";
import { parseRoleFromUsersSheet } from "./users-tab-schema.mjs";
import { findCompanyUsersTabRow, readCompanyUsersTabRecord } from "./company-users.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

function usersApiFailure(code, message, httpStatus = 400) {
  return { ok: false, code, message, httpStatus };
}

export async function createVerificationCompanyUser(auth, deps, context, actor, input = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return usersApiFailure("USERS_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }

  const payload = buildVerificationUserCreateInput({
    ...input,
    companyFolderId,
    masterSheetId,
  });
  if (!isVerificationUserEmail(payload.email)) {
    return usersApiFailure("USERS_VALIDATION_FAILED", "Verification user email prefix is required.", 400);
  }
  if (!isVerificationUserRecord({ email: payload.email, userId: payload.userId })) {
    return usersApiFailure("USERS_VALIDATION_FAILED", "Verification user markers are required.", 400);
  }
  const role = parseRoleFromUsersSheet(payload.role);
  if (!["Manager", "Auditor", "Admin"].includes(role)) {
    return usersApiFailure("USERS_VALIDATION_FAILED", "Verification role must be Manager, Auditor, or Admin.", 400);
  }
  if (!payload.password || payload.password.length < 12) {
    return usersApiFailure("USERS_VALIDATION_FAILED", "Verification password must be at least 12 characters.", 400);
  }

  const existing = await findCompanyUsersTabRow(auth, masterSheetId, payload.email, deps).catch(() => null);
  if (existing && isActiveVerificationUserRecord(existing)) {
    const rec = await readCompanyUsersTabRecord(auth, masterSheetId, payload.email, deps).catch(() => null);
    if (rec && deps?.authIndexApi?.upsertEntry) {
      const entry =
        deps.authIndexApi.entryFromUsersTabRow(
          { ...rec, roleRaw: rec.role },
          {
            companyFolderId,
            companyName: trim(context?.companyName || actor?.companyName),
            masterSheetId,
          },
        ) || null;
      if (entry?.email && entry.passwordHash) {
        deps.authIndexApi.upsertEntry(entry);
      }
    }
    return {
      ok: true,
      idempotent: true,
      companyFolderId,
      masterSheetId,
      user: {
        email: payload.email,
        userId: trim(existing.userId || payload.userId),
        role,
        status: "ACTIVE",
        name: trim(existing.name || payload.name),
      },
    };
  }

  const now = new Date().toISOString();
  const passwordHash = hashPassword(payload.password);
  const writeResult = await writeUsersTabRecordByHeaders(
    auth,
    masterSheetId,
    {
      "User ID": payload.userId,
      Username: payload.username,
      Email: payload.email,
      Name: payload.name,
      "Full Name": payload.name,
      Role: role,
      AccessLevel: defaultAccessLevelForRole(role),
      CompanyAreas: "",
      Company: trim(context?.companyName || actor?.companyName),
      CompanyId: companyFolderId,
      CompanyFolderId: companyFolderId,
      Status: "ACTIVE",
      PasswordHash: passwordHash,
      PasswordUpdatedAt: now,
      CreatedAt: now,
      UpdatedAt: now,
      "Created By": PRODUCTION_VERIFICATION_USER_CREATED_BY,
      "Updated By": trim(actor?.email) || PRODUCTION_VERIFICATION_USER_SOURCE,
      "Sync Status": "Synced",
      SchemaVersion: "1",
    },
    deps,
    {
      companyContext: {
        companyFolderId,
        companyId: companyFolderId,
        companyName: trim(context?.companyName || actor?.companyName),
        masterSheetId,
      },
      validate: false,
    },
  );

  if (!writeResult?.ok) {
    return usersApiFailure("USERS_CREATE_FAILED", "Could not create verification user.", 500);
  }

  const rec = await readCompanyUsersTabRecord(auth, masterSheetId, payload.email, deps).catch(() => null);
  if (!rec) {
    return usersApiFailure("USERS_CREATE_FAILED", "Verification user read-back failed.", 500);
  }

  if (deps?.authIndexApi?.upsertEntry) {
    deps.authIndexApi.upsertEntry(
      deps.authIndexApi.entryFromUsersTabRow(
        { ...rec, roleRaw: rec.role },
        {
          companyFolderId,
          companyName: trim(context?.companyName || actor?.companyName),
          masterSheetId,
        },
      ),
    );
  }

  return {
    ok: true,
    idempotent: false,
    companyFolderId,
    masterSheetId,
    user: {
      email: payload.email,
      userId: payload.userId,
      role,
      status: "ACTIVE",
      name: payload.name,
    },
  };
}

export async function cleanupVerificationCompanyUser(auth, deps, context, email) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return usersApiFailure("USERS_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  const emailNorm = safeLower(email);
  if (!isVerificationUserEmail(emailNorm)) {
    return usersApiFailure("USERS_CLEANUP_REJECTED", "Only verification user emails may be cleaned.", 400);
  }

  const row = await findCompanyUsersTabRow(auth, masterSheetId, emailNorm, deps).catch(() => null);
  if (!row) {
    return { ok: true, email: emailNorm, cleaned: false, alreadyClean: true };
  }
  if (!isVerificationUserRecord(row)) {
    return usersApiFailure(
      "USERS_CLEANUP_REJECTED",
      "Ordinary company users cannot be cleaned by the verification gate.",
      400,
    );
  }

  const status = safeLower(row.status);
  if (status === PRODUCTION_VERIFICATION_USER_CLEANED_STATUS.toLowerCase() || status === "deleted") {
    return { ok: true, email: emailNorm, cleaned: false, alreadyClean: true };
  }

  const now = new Date().toISOString();
  await patchTabRowByHeader(auth, deps, masterSheetId, USERS_TAB, "Email", emailNorm, {
    Status: PRODUCTION_VERIFICATION_USER_CLEANED_STATUS,
    UpdatedAt: now,
    "Updated By": PRODUCTION_VERIFICATION_USER_SOURCE,
  });
  invalidateUsersTabCache(masterSheetId, { source: "verification-user-cleanup" });
  if (deps?.authIndexApi?.removeEntry) {
    deps.authIndexApi.removeEntry(emailNorm);
  }
  return { ok: true, email: emailNorm, cleaned: true, alreadyClean: false };
}

export async function cleanupStaleVerificationCompanyUsers(auth, deps, context, input = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId) {
    return usersApiFailure("USERS_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  const readResult = await readCompanyUsers(auth, masterSheetId, deps);
  const records = Array.isArray(readResult?.records) ? readResult.records : [];
  const targets = records
    .map((record) => ({
      email: safeLower(record.Email || record.email),
      name: trim(record.Name || record.name),
      status: safeLower(record.Status || record.status),
      userId: trim(record["User ID"] || record.UserId),
      createdBy: trim(record["Created By"] || record.CreatedBy),
    }))
    .filter((record) => record.email && isVerificationUserRecord(record))
    .filter((record) => isActiveVerificationUserRecord(record));

  const results = [];
  for (const target of targets) {
    if (input.runId && !target.email.includes(String(input.runId)) && !target.userId.includes(String(input.runId))) {
      continue;
    }
    const cleaned = await cleanupVerificationCompanyUser(auth, deps, context, target.email);
    results.push({
      email: target.email,
      ok: cleaned.ok,
      cleaned: cleaned.cleaned === true,
      alreadyClean: cleaned.alreadyClean === true,
      code: cleaned.code,
    });
  }
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    cleanedCount: results.filter((item) => item.cleaned).length,
    results,
  };
}

export function resolveVerificationUserIdForEmail(email, runId, role) {
  return buildProductionVerificationUserId(runId, role);
}
