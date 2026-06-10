/**
 * Godmode registry actions — make-usable, relink, force-live (fast, registry-first).
 */
import {
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import { isSystemTemplateCompany } from "../shared/system-template-company.mjs";
import {
  buildFallbackRegistryDiagnostic,
  FALLBACK_REGISTRY_WARNING,
  persistFallbackCompanyLive,
} from "./company-registry-fallback.mjs";
import {
  ensureCompanyRegistryRecordForWorkspace,
  evaluateCompanyWorkspaceReadiness,
  findCompanyWorkspaceRegistryRecordInMap,
  getCanonicalCompanyRegistryRecord,
  getCompanyWorkspaceRegistryRecord,
  persistAndVerifyCompanyLive,
  persistCompanyWorkspaceSetup,
  readCompanyWorkspaceRegistryMap,
  REGISTRY_PERSIST_ERROR_MESSAGES,
  REGISTRY_PERSIST_FAILED_STEP,
  REGISTRY_TAB_COMPANIES,
  REGISTRY_VERIFY_FAILED,
  REGISTRY_WRITE_FAILED,
} from "./company-workspace-registry.mjs";
import { BACKGROUND_SETUP_USER_MESSAGE } from "../shared/background-jobs.mjs";
import { canInviteUsersForCompany } from "./company-invite-readiness.mjs";

export const GODMODE_REGISTRY_ACTION_TIMEOUT_MS = 30_000;

export const MAKE_USABLE_STATUS_LIVE = "LIVE";

export const MAKE_USABLE_REASON_MESSAGES = {
  GOOGLE_NOT_CONNECTED: "Google Workspace is not connected. Connect Google in Platform Setup first.",
  COMPANY_FOLDER_MISSING: "Select a company folder before making the company usable.",
  MASTER_SHEET_MISSING: "Link a master sheet before making the company usable.",
  COMPANY_NAME_MISSING: "Company name is required.",
  SYSTEM_TEMPLATE_COMPANY: "This workspace is a system template and cannot be made usable.",
  REGISTRY_LINK_FAILED: "The company registry record could not be created or updated.",
  REGISTRY_WRITE_FAILED: REGISTRY_PERSIST_ERROR_MESSAGES.REGISTRY_WRITE_FAILED,
  REGISTRY_VERIFY_FAILED: REGISTRY_PERSIST_ERROR_MESSAGES.REGISTRY_VERIFY_FAILED,
  GOOGLE_TIMEOUT: "The request timed out. Try again in a moment.",
  UNKNOWN: "An unexpected error occurred.",
};

function registryFailureDiagnostics(input = {}) {
  return {
    registrySpreadsheetId: String(input.registrySpreadsheetId || "").trim(),
    registryTab: String(input.registryTab || REGISTRY_TAB_COMPANIES).trim(),
    registryLocation: String(input.registryLocation || "").trim(),
    missingColumns: Array.isArray(input.missingColumns) ? input.missingColumns : [],
    lookupKeys:
      input.lookupKeys && typeof input.lookupKeys === "object" ? input.lookupKeys : {},
    verifyReadback: input.verifyReadback || null,
  };
}

function makeUsableFailure(input = {}) {
  const reasonCode = String(input.reasonCode || "UNKNOWN").trim();
  const diagnostics = registryFailureDiagnostics(input);
  return {
    ok: false,
    status: "NEEDS_ATTENTION",
    companyId: String(input.companyId || "").trim(),
    companyName: String(input.companyName || "").trim(),
    reasonCode,
    reason: reasonCode,
    userMessage: MAKE_USABLE_REASON_MESSAGES[reasonCode] || MAKE_USABLE_REASON_MESSAGES.UNKNOWN,
    failedStep: String(input.failedStep || REGISTRY_PERSIST_FAILED_STEP).trim(),
    technicalError: String(input.technicalError || "").trim(),
    warnings: input.warnings || [],
    ...diagnostics,
  };
}

function withHandlerTimeout(promise, label, timeoutMs = GODMODE_REGISTRY_ACTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Registry action timed out (${label}).`);
      error.code = "REGISTRY_ACTION_TIMEOUT";
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function workspaceFromRequest(params = {}, body = {}) {
  const workspaceId = String(params.workspaceId || params.companyId || body.workspaceId || "").trim();
  const companyFolderId = String(body.companyFolderId || workspaceId || "").trim();
  const companyId = String(body.companyId || companyFolderId || workspaceId || "").trim();
  const masterSheetId = String(body.masterSheetId || "").trim();
  const companyName = String(body.companyName || "").trim();
  return { workspaceId, companyFolderId, companyId, masterSheetId, companyName };
}

function buildChecksFromBody(body = {}, record = {}) {
  const checks = body.checks && typeof body.checks === "object" ? { ...body.checks } : {};
  const pickBool = (key, registryField) => {
    if (typeof checks[key] === "boolean") {
      return checks[key];
    }
    if (typeof body[key] === "boolean") {
      return body[key];
    }
    if (registryField === "mapped") {
      const mapping = String(record.companyFoldersMappingStatus || "")
        .trim()
        .toLowerCase();
      return mapping === "mapped" || mapping === "linked" || mapping === "repaired";
    }
    if (registryField === "ready") {
      const firstAdmin = String(record.firstAdminStatus || "")
        .trim()
        .toLowerCase();
      return firstAdmin !== "pending" && Boolean(firstAdmin);
    }
    if (registryField === "health") {
      return Boolean(String(record.lastHealthCheckAt || "").trim());
    }
    return undefined;
  };

  return {
    rootFolderId: String(checks.rootFolderId || body.rootFolderId || record.rootFolderId || record.companyId || "").trim(),
    masterSheetId: String(checks.masterSheetId || body.masterSheetId || record.masterSheetId || "").trim(),
    folderStructureOk: pickBool("folderStructureOk"),
    requiredTabsOk: pickBool("requiredTabsOk"),
    companyFoldersMappingOk: pickBool("companyFoldersMappingOk", "mapped"),
    firstAdminReady: pickBool("firstAdminReady", "ready"),
    workspaceHealthOk: pickBool("workspaceHealthOk", "health"),
    healthCheckRun: pickBool("healthCheckRun", "health"),
    skipHealthCheck:
      typeof checks.skipHealthCheck === "boolean"
        ? checks.skipHealthCheck
        : typeof body.skipHealthCheck === "boolean"
          ? body.skipHealthCheck
          : !String(record.lastHealthCheckAt || "").trim(),
  };
}

function allExplicitReadinessChecksPass(checks = {}) {
  return (
    checks.folderStructureOk === true &&
    checks.requiredTabsOk === true &&
    checks.companyFoldersMappingOk !== false &&
    checks.firstAdminReady === true &&
    (checks.workspaceHealthOk === true || checks.skipHealthCheck === true)
  );
}

/**
 * Find or create a Companies registry row for a Godmode workspace — registry sheet only.
 */
export async function relinkCompanyRegistryForWorkspace(auth, deps, workspace = {}) {
  const companyFolderId = String(workspace.companyFolderId || workspace.workspaceId || workspace.companyId || "").trim();
  const masterSheetId = String(workspace.masterSheetId || "").trim();
  const companyName = String(workspace.companyName || "").trim();
  const companyId = String(workspace.companyId || companyFolderId || "").trim();

  if (!companyId && !companyFolderId) {
    return {
      ok: false,
      reason: "missing_workspace_id",
      companyId: "",
      companyName,
      companyFolderId,
      masterSheetId,
      registryStatus: "",
    };
  }

  const lookupWorkspace = {
    companyId,
    companyFolderId,
    rootFolderId: companyFolderId,
    masterSheetId,
    companyName,
  };

  const { map } = await readCompanyWorkspaceRegistryMap(auth, deps);
  const match = findCompanyWorkspaceRegistryRecordInMap(map, lookupWorkspace);
  const canonicalCompanyId = companyId || companyFolderId;
  const resolvedRootFolderId = companyFolderId || canonicalCompanyId;

  if (match?.record) {
    const registryCompanyId = String(match.record.companyId || canonicalCompanyId).trim();
    const persistResult = await persistCompanyWorkspaceSetup(auth, deps, {
      companyId: registryCompanyId,
      companyName: companyName || match.record.companyName,
      rootFolderId: resolvedRootFolderId || match.record.rootFolderId,
      masterSheetId: masterSheetId || match.record.masterSheetId,
      workbookFolderId: match.record.workbookFolderId,
      companyFoldersMappingStatus: match.record.companyFoldersMappingStatus,
      firstAdminStatus: match.record.firstAdminStatus,
      status: match.record.status || "Setup in progress",
      markLive: false,
      markSetupComplete: false,
      touchSetup: true,
    });
    const fresh =
      (await getCompanyWorkspaceRegistryRecord(auth, deps, registryCompanyId)) ||
      persistResult.record ||
      match.record;
    const registryStatus = getCanonicalCompanyStatus(fresh) || fresh?.status || "";
    return {
      ok: Boolean(persistResult.synced || fresh),
      companyId: registryCompanyId,
      companyName: String(fresh?.companyName || companyName).trim(),
      companyFolderId: resolvedRootFolderId,
      masterSheetId: String(fresh?.masterSheetId || masterSheetId).trim(),
      registryStatus,
      matchedBy: match.matchedBy,
      created: false,
    };
  }

  const ensured = await ensureCompanyRegistryRecordForWorkspace(auth, deps, lookupWorkspace);
  const record =
    ensured.record ||
    (await getCompanyWorkspaceRegistryRecord(auth, deps, canonicalCompanyId)) ||
    null;
  if (!record) {
    return {
      ok: false,
      reason: ensured.reason || "create_failed",
      companyId: canonicalCompanyId,
      companyName,
      companyFolderId: resolvedRootFolderId,
      masterSheetId,
      registryStatus: "",
      created: Boolean(ensured.created),
    };
  }

  const registryCompanyId = String(record.companyId || canonicalCompanyId).trim();
  let registryStatus = getCanonicalCompanyStatus(record) || record.status || "";

  if (workspace.persistLive || workspace.markLiveIfReady) {
    const checks = buildChecksFromBody(workspace, record);
    const readiness = evaluateCompanyWorkspaceReadiness(record, checks);
    if (workspace.persistLive || readiness.ready) {
      try {
        const liveResult = await persistAndVerifyCompanyLive(auth, deps, {
          companyId: registryCompanyId,
          companyFolderId: resolvedRootFolderId,
          rootFolderId: resolvedRootFolderId,
          masterSheetId: String(record.masterSheetId || masterSheetId).trim(),
          companyName: String(record.companyName || companyName).trim(),
          reason: "relink_registry",
          checks,
        });
        registryStatus = liveResult.registryStatus;
        record = liveResult.record || record;
      } catch (error) {
        const code = String(error?.code || REGISTRY_WRITE_FAILED).trim();
        return {
          ok: false,
          reason: code,
          companyId: registryCompanyId,
          companyName: String(record.companyName || companyName).trim(),
          companyFolderId: resolvedRootFolderId,
          masterSheetId: String(record.masterSheetId || masterSheetId).trim(),
          registryStatus: getCanonicalCompanyStatus(record) || "",
          created: Boolean(ensured.created),
          technicalError: String(error?.technicalError || error?.message || "").trim(),
          userMessage: REGISTRY_PERSIST_ERROR_MESSAGES[code] || "",
          failedStep: "persist_live",
        };
      }
    }
  }

  return {
    ok: true,
    companyId: registryCompanyId,
    companyName: String(record.companyName || companyName).trim(),
    companyFolderId: String(record.rootFolderId || resolvedRootFolderId).trim(),
    masterSheetId: String(record.masterSheetId || masterSheetId).trim(),
    registryStatus,
    matchedBy: ensured.matchedBy || (ensured.created ? "created" : ""),
    created: Boolean(ensured.created),
  };
}

/**
 * Persist status=LIVE when readiness checks pass — registry sheet only, no workbook verify.
 */
/**
 * Fast Godmode path: registry row + LIVE status. Optional Users tab check (warning only).
 */
export async function makeCompanyUsable(auth, deps, workspace = {}) {
  const warnings = [];
  const workspaceId = String(workspace.workspaceId || workspace.companyFolderId || workspace.companyId || "").trim();
  const companyFolderId = String(workspace.companyFolderId || workspaceId).trim();
  const companyName = String(workspace.companyName || "").trim();
  const masterSheetId = String(workspace.masterSheetId || "").trim();

  if (!auth) {
    return makeUsableFailure({ reasonCode: "GOOGLE_NOT_CONNECTED", failedStep: "connect_google" });
  }
  if (!workspaceId || !companyFolderId) {
    return makeUsableFailure({
      reasonCode: "COMPANY_FOLDER_MISSING",
      failedStep: "select_company",
      companyName,
    });
  }
  if (!masterSheetId) {
    return makeUsableFailure({
      reasonCode: "MASTER_SHEET_MISSING",
      failedStep: "link_master_sheet",
      companyId: workspaceId,
      companyName,
    });
  }
  if (!companyName) {
    return makeUsableFailure({
      reasonCode: "COMPANY_NAME_MISSING",
      failedStep: "select_company",
      companyId: workspaceId,
    });
  }
  if (isSystemTemplateCompany({ companyName, name: companyName, companyId: workspaceId })) {
    return makeUsableFailure({
      reasonCode: "SYSTEM_TEMPLATE_COMPANY",
      failedStep: "select_company",
      companyId: workspaceId,
      companyName,
    });
  }

  const sessionDir = String(deps.sessionDir || "").trim();
  let persistResult;
  let usedFallbackRegistry = false;
  let mainRegistryError = "";
  try {
    persistResult = await withHandlerTimeout(
      persistAndVerifyCompanyLive(auth, deps, {
        companyId: workspaceId,
        companyFolderId,
        rootFolderId: companyFolderId,
        masterSheetId,
        companyName,
        reason: "make_usable",
      }),
      "persist_live",
    );
  } catch (error) {
    mainRegistryError = String(
      error?.technicalError || (error instanceof Error ? error.message : error) || "",
    ).trim();
    console.warn("[make-usable] main registry persist failed; attempting fallback", {
      companyId: workspaceId,
      code: error?.code,
      technicalError: mainRegistryError,
    });

    const fallbackResult = persistFallbackCompanyLive(sessionDir, {
      companyId: workspaceId,
      companyFolderId,
      masterSheetId,
      companyName,
    });
    if (!fallbackResult.synced || !fallbackResult.record) {
      const reasonCode =
        error?.code === "REGISTRY_ACTION_TIMEOUT"
          ? "GOOGLE_TIMEOUT"
          : error?.code === REGISTRY_VERIFY_FAILED
            ? REGISTRY_VERIFY_FAILED
            : error?.code === REGISTRY_WRITE_FAILED
              ? REGISTRY_WRITE_FAILED
              : "REGISTRY_LINK_FAILED";
      return makeUsableFailure({
        reasonCode,
        failedStep: error?.failedStep || REGISTRY_PERSIST_FAILED_STEP,
        companyId: workspaceId,
        companyName,
        technicalError: mainRegistryError || String(fallbackResult.reason || ""),
        registrySpreadsheetId: error?.registrySpreadsheetId,
        registryTab: error?.registryTab,
        registryLocation: error?.registryLocation,
        missingColumns: error?.missingColumns,
        lookupKeys: error?.lookupKeys,
        verifyReadback: error?.verifyReadback,
      });
    }

    usedFallbackRegistry = true;
    persistResult = {
      companyId: workspaceId,
      record: fallbackResult.record,
      registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
    };
  }

  let fresh =
    persistResult.record ||
    (await getCanonicalCompanyRegistryRecord(auth, deps, workspaceId)) ||
    null;
  const registryCompanyId = String(persistResult.companyId || fresh?.companyId || workspaceId).trim();
  if (!fresh || !isCompanyRegistryLive(fresh)) {
    fresh = await getCanonicalCompanyRegistryRecord(auth, deps, registryCompanyId);
  }
  if (!fresh || !isCompanyRegistryLive(fresh)) {
    return makeUsableFailure({
      reasonCode: usedFallbackRegistry ? REGISTRY_VERIFY_FAILED : REGISTRY_WRITE_FAILED,
      failedStep: REGISTRY_PERSIST_FAILED_STEP,
      companyId: workspaceId,
      companyName,
      technicalError: mainRegistryError || "registry_status_not_live_after_persist",
      verifyReadback: fresh ? { status: getCanonicalCompanyStatus(fresh), companyId: fresh.companyId } : null,
    });
  }

  if (usedFallbackRegistry) {
    warnings.push(FALLBACK_REGISTRY_WARNING);
    warnings.push(buildFallbackRegistryDiagnostic(mainRegistryError));
  }

  let backgroundJobs = [];
  if (typeof deps.queueCompanySetupJobs === "function") {
    backgroundJobs = deps.queueCompanySetupJobs({
      companyId: registryCompanyId,
      workspaceId: registryCompanyId,
      companyFolderId,
      masterSheetId,
      companyName: String(fresh?.companyName || companyName).trim(),
      requestedBy: String(workspace.requestedBy || "").trim(),
    });
  }

  const resolvedName = String(fresh?.companyName || companyName).trim();
  return {
    ok: true,
    status: MAKE_USABLE_STATUS_LIVE,
    companyId: registryCompanyId,
    companyName: resolvedName,
    masterSheetId,
    userMessage: BACKGROUND_SETUP_USER_MESSAGE,
    backgroundJobs,
    backgroundSetup: true,
    warnings,
    registryStatus: getCanonicalCompanyStatus(fresh) || COMPANY_REGISTRY_STATUS_LIVE,
    registrySource: usedFallbackRegistry ? "fallback" : "main",
    fallbackRegistry: usedFallbackRegistry,
    technicalError: usedFallbackRegistry ? mainRegistryError : "",
    warning: usedFallbackRegistry ? FALLBACK_REGISTRY_WARNING : "",
  };
}

export async function forceCompanyLiveIfReadyFromChecks(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  if (!companyId) {
    return {
      ok: false,
      reason: "missing_company_id",
      blockers: ["missing_company_id"],
      registryStatus: "",
    };
  }

  let existing = await getCompanyWorkspaceRegistryRecord(auth, deps, companyId);
  if (!existing && input.checks?.rootFolderId) {
    existing = await getCompanyWorkspaceRegistryRecord(auth, deps, String(input.checks.rootFolderId).trim());
  }
  if (!existing) {
    return {
      ok: false,
      reason: "not_in_registry",
      blockers: ["not_in_registry"],
      registryStatus: "",
    };
  }

  const registryCompanyId = String(existing.companyId || companyId).trim();
  const checks = buildChecksFromBody(input, existing);

  if (isCompanyRegistryLive(existing)) {
    return {
      ok: true,
      alreadyLive: true,
      promoted: false,
      companyId: registryCompanyId,
      registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
      blockers: [],
      setupBlockers: [],
      needsAttention: false,
      company: existing,
    };
  }

  const readiness = evaluateCompanyWorkspaceReadiness(existing, checks);
  const checksPass = readiness.ready || allExplicitReadinessChecksPass(checks);
  if (!checksPass) {
    return {
      ok: false,
      reason: "not_ready",
      blockers: readiness.blockers,
      setupBlockers: readiness.setupBlockers,
      needsAttention: true,
      registryStatus: readiness.registryStatus || getCanonicalCompanyStatus(existing) || "",
      company: existing,
    };
  }

  try {
    const persistResult = await persistAndVerifyCompanyLive(auth, deps, {
      companyId: registryCompanyId,
      companyFolderId: companyId,
      companyName: String(input.companyName || existing.companyName || "").trim(),
      rootFolderId: checks.rootFolderId || existing.rootFolderId || companyId,
      masterSheetId: checks.masterSheetId || existing.masterSheetId,
      lastHealthCheckAt: existing.lastHealthCheckAt || (checks.healthCheckRun ? new Date().toISOString() : ""),
      reason: "force_live_if_ready",
      checks,
    });
    return {
      ok: true,
      promoted: Boolean(persistResult.promoted),
      alreadyLive: Boolean(persistResult.alreadyLive),
      companyId: registryCompanyId,
      registryStatus: persistResult.registryStatus,
      blockers: [],
      setupBlockers: [],
      needsAttention: false,
      company: persistResult.record,
    };
  } catch (error) {
    const code = String(error?.code || REGISTRY_WRITE_FAILED).trim();
    return {
      ok: false,
      reason: code,
      blockers: [code],
      setupBlockers: [code],
      needsAttention: true,
      registryStatus: getCanonicalCompanyStatus(existing) || "",
      company: existing,
      technicalError: String(error?.technicalError || error?.message || "").trim(),
      userMessage: REGISTRY_PERSIST_ERROR_MESSAGES[code] || "",
      failedStep: "persist_live",
    };
  }
}

export function installGodmodeRegistryActionRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    processCompanyUserInvite,
  } = deps;

  app.post(
    "/api/godmode/companies/:workspaceId/make-usable",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        const failure = makeUsableFailure({ reasonCode: "GOOGLE_NOT_CONNECTED", failedStep: "connect_google" });
        return res.status(401).json(failure);
      }
      const workspace = workspaceFromRequest(req.params || {}, req.body || {});
      const actor = typeof deps.parseBertActorFromRequest === "function" ? deps.parseBertActorFromRequest(req) : null;
      try {
        const result = await withHandlerTimeout(
          makeCompanyUsable(authed, deps, {
            ...workspace,
            requestedBy: String(actor?.email || actor?.name || "godmode").trim(),
          }),
          "make_usable",
        );
        if (!result.ok) {
          const status =
            result.reasonCode === "GOOGLE_NOT_CONNECTED"
              ? 401
              : result.reasonCode === "GOOGLE_TIMEOUT"
                ? 504
                : 400;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (error) {
        const failure = makeUsableFailure({
          reasonCode: error?.code === "REGISTRY_ACTION_TIMEOUT" ? "GOOGLE_TIMEOUT" : "UNKNOWN",
          failedStep: "make_usable",
          companyId: workspace.workspaceId,
          companyName: workspace.companyName,
          technicalError: error instanceof Error ? error.message : "Unable to make company usable.",
        });
        return res.status(error?.code === "REGISTRY_ACTION_TIMEOUT" ? 504 : 500).json(failure);
      }
    },
  );

  app.post(
    "/api/godmode/companies/:companyId/invite-user",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      if (typeof processCompanyUserInvite !== "function") {
        return res.status(501).json({ ok: false, error: "Company user invite handler is not configured." });
      }
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({
          ok: false,
          code: "google_not_connected",
          error: "Connect Google Workspace before inviting users.",
        });
      }
      const companyId = String(req.params?.companyId || req.body?.companyId || "").trim();
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "Company ID is required." });
      }
      try {
        const record = await getCanonicalCompanyRegistryRecord(authed, deps, companyId);
        const canInvite = await canInviteUsersForCompany(authed, deps, companyId, {
          companyId,
          companyFolderId: String(req.body?.companyFolderId || record?.rootFolderId || companyId).trim(),
          masterSheetId: String(req.body?.masterSheetId || record?.masterSheetId || "").trim(),
        });
        if (!canInvite) {
          return res.status(409).json({
            ok: false,
            code: "COMPANY_NOT_LIVE",
            error: "Company must be usable before inviting users. Use Make company usable first.",
            blocker: "company_not_live",
          });
        }
        const mergedBody = {
          ...(req.body || {}),
          companyId,
          companyFolderId: String(req.body?.companyFolderId || record.rootFolderId || companyId).trim(),
          masterSheetId: String(req.body?.masterSheetId || record.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || record.companyName || "").trim(),
        };
        req.body = mergedBody;
        return processCompanyUserInvite(req, res);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to invite user.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/companies/:workspaceId/relink-registry",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before relinking company registry." });
      }
      try {
        const workspace = workspaceFromRequest(req.params || {}, req.body || {});
        const result = await withHandlerTimeout(
          relinkCompanyRegistryForWorkspace(authed, deps, workspace),
          "relink_registry",
        );
        if (!result.ok) {
          return res.status(400).json({
            ok: false,
            error: result.reason || "Unable to relink company registry record.",
            ...result,
          });
        }
        return res.json({ ok: true, ...result });
      } catch (error) {
        const status = error?.code === "REGISTRY_ACTION_TIMEOUT" ? 504 : 500;
        return res.status(status).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to relink company registry record.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/companies/:companyId/force-live-if-ready",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before marking company live." });
      }
      try {
        const companyId = String(req.params?.companyId || req.body?.companyId || "").trim();
        const result = await withHandlerTimeout(
          forceCompanyLiveIfReadyFromChecks(authed, deps, {
            companyId,
            companyFolderId: String(req.body?.companyFolderId || companyId).trim(),
            companyName: String(req.body?.companyName || "").trim(),
            checks: req.body?.checks,
            ...req.body,
          }),
          "force_live_if_ready",
        );
        if (!result.ok) {
          const status =
            result.reason === "not_ready"
              ? 409
              : result.reason === REGISTRY_VERIFY_FAILED || result.reason === REGISTRY_WRITE_FAILED
                ? 409
                : 400;
          return res.status(status).json({
            ok: false,
            error:
              result.userMessage ||
              (result.blockers?.length > 0
                ? `Company is not ready to go live: ${result.blockers.join("; ")}`
                : result.reason || "Unable to mark company live."),
            failedStep: result.failedStep || "persist_live",
            ...result,
          });
        }
        return res.json({ ok: true, ...result });
      } catch (error) {
        const status = error?.code === "REGISTRY_ACTION_TIMEOUT" ? 504 : 500;
        return res.status(status).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to mark company live.",
        });
      }
    },
  );
}
