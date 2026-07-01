/**
 * Live-only cleanup for foundation verifier pollution on company Users tabs.
 * Dry-run by default; requires master session or BERT_CLEANUP_SECRET to apply.
 */
import {
  FOUNDATION_VERIFY_PROTECTED_EMAILS,
  isFoundationVerifyPollutionTarget,
} from "../shared/foundation-verify-users.mjs";
import { patchTabRowByHeader } from "./workbook-service.mjs";
import { readCompanyUsers } from "./users-tab-reader.mjs";
import { pickRowCompanyFolderId } from "./users-tab-schema.mjs";
import { invalidateUsersTabCache } from "./users-tab-cache.mjs";

function safeLower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function rowEmail(record) {
  return safeLower(record.Email || record.email || record.Login || record.Username || "");
}

function rowName(record) {
  return String(record.Name || record["Full Name"] || record.FullName || record.name || "").trim();
}

function rowStatus(record) {
  return safeLower(record.Status || record.status || "");
}

function isAlreadyCleaned(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "DELETED" || normalized === "INACTIVE";
}

export function foundationCleanupRouteEnabled(env = process.env) {
  return String(env.BERT_ENABLE_FOUNDATION_CLEANUP || "").trim().toLowerCase() === "true";
}

export function isFoundationCleanupSecretAuthorized(req, env = process.env) {
  const configured = String(env.BERT_CLEANUP_SECRET || "").trim();
  if (!configured) {
    return false;
  }
  const provided = String(
    req.headers?.["x-bert-cleanup-secret"] ||
      req.query?.cleanupSecret ||
      req.body?.cleanupSecret ||
      "",
  ).trim();
  return provided === configured;
}

export function parseFoundationCleanupApplyFlag(raw) {
  return raw === true || raw === "true" || raw === "1" || raw === 1;
}

/**
 * @param {Array<Record<string, unknown>>} records
 * @param {{ companyFolderId?: string }} [options]
 */
export function findFoundationVerifyPollutionTargets(records, options = {}) {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const targets = [];

  for (const record of records || []) {
    const email = rowEmail(record);
    if (!email || FOUNDATION_VERIFY_PROTECTED_EMAILS.has(email)) {
      continue;
    }
    if (!isFoundationVerifyPollutionTarget(email, rowName(record))) {
      continue;
    }
    if (companyFolderId) {
      const folderId = String(pickRowCompanyFolderId(record) || "").trim();
      if (folderId && folderId !== companyFolderId) {
        continue;
      }
    }
    targets.push({
      email,
      name: rowName(record),
      status: rowStatus(record),
      companyFolderId: String(pickRowCompanyFolderId(record) || "").trim(),
    });
  }

  return targets;
}

/**
 * @param {import("google-auth-library").OAuth2Client} auth
 * @param {Record<string, unknown>} deps
 * @param {{ masterSheetId?: string; companyFolderId?: string; apply?: boolean }} [options]
 */
export async function runFoundationVerifyUsersCleanup(auth, deps, options = {}) {
  const masterSheetId = String(options.masterSheetId || "").trim();
  const companyFolderId = String(options.companyFolderId || "").trim();
  const apply = options.apply === true;

  if (!masterSheetId) {
    return { ok: false, httpStatus: 400, error: "masterSheetId is required." };
  }

  const readResult = await readCompanyUsers(auth, masterSheetId, deps);
  const targets = findFoundationVerifyPollutionTargets(readResult.records, { companyFolderId });
  const matchedCount = targets.length;
  const wouldCleanCount = targets.filter((target) => !isAlreadyCleaned(target.status)).length;

  const response = {
    ok: true,
    dryRun: !apply,
    masterSheetId,
    companyFolderId: companyFolderId || null,
    matchedCount,
    wouldCleanCount,
    appliedCount: 0,
    skippedAlreadyInactive: targets.filter((target) => isAlreadyCleaned(target.status)).length,
    matchedEmails: targets.map((target) => target.email).sort(),
    matches: targets.map((target) => ({
      email: target.email,
      name: target.name || null,
      status: target.status || null,
      companyFolderId: target.companyFolderId || null,
    })),
  };

  if (!apply) {
    return response;
  }

  const now = new Date().toISOString();
  const tabTitle = readResult.tabTitle || "Users";
  let appliedCount = 0;

  for (const target of targets) {
    if (isAlreadyCleaned(target.status)) {
      continue;
    }
    await patchTabRowByHeader(auth, deps, masterSheetId, tabTitle, "Email", target.email, {
      Status: "DELETED",
      UpdatedAt: now,
      "Updated By": "BERT foundation-verify cleanup",
    });
    appliedCount += 1;
  }

  if (appliedCount > 0) {
    invalidateUsersTabCache(masterSheetId, { source: "foundationVerifyCleanup" });
  }

  response.dryRun = false;
  response.appliedCount = appliedCount;
  return response;
}

export function installFoundationVerifyCleanupRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    getCompanyUsersDeps,
  } = deps;

  function requireFoundationCleanupAuth(req, res, next) {
    if (!foundationCleanupRouteEnabled()) {
      return res.status(404).json({ ok: false, error: "Not found." });
    }
    if (isFoundationCleanupSecretAuthorized(req)) {
      return next();
    }
    return requireGoogleWorkspaceSession(req, res, () => requireMasterOnlyActor(req, res, next));
  }

  app.post(
    "/api/admin/cleanup/foundation-verify-users",
    requireFoundationCleanupAuth,
    async (req, res) => {
      if (!envConfigured() || !getAuthedClient()) {
        return res.status(401).json({
          ok: false,
          error: "Google connection required for foundation-verify cleanup.",
        });
      }

      const masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
      const companyFolderId = String(
        req.body?.companyFolderId || req.query?.companyFolderId || "",
      ).trim();
      const apply = parseFoundationCleanupApplyFlag(req.body?.apply ?? req.query?.apply);

      try {
        const result = await runFoundationVerifyUsersCleanup(getAuthedClient(), getCompanyUsersDeps(), {
          masterSheetId,
          companyFolderId,
          apply,
        });
        if (!result.ok) {
          return res.status(result.httpStatus || 400).json(result);
        }
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[foundation-verify-cleanup] failed:", message);
        return res.status(500).json({
          ok: false,
          error: "Foundation verify users cleanup failed.",
          technicalError: message,
        });
      }
    },
  );
}
