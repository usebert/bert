/**
 * Godmode registry-only actions — no Drive folder, workbook, or tab Google calls.
 */
import {
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import {
  ensureCompanyRegistryRecordForWorkspace,
  evaluateCompanyWorkspaceReadiness,
  findCompanyWorkspaceRegistryRecordInMap,
  getCompanyWorkspaceRegistryRecord,
  persistCompanyWorkspaceSetup,
  readCompanyWorkspaceRegistryMap,
} from "./company-workspace-registry.mjs";

export const GODMODE_REGISTRY_ACTION_TIMEOUT_MS = 30_000;

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
  const registryStatus = getCanonicalCompanyStatus(record) || record.status || "";
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

  const now = new Date().toISOString();
  const persistResult = await persistCompanyWorkspaceSetup(auth, deps, {
    companyId: registryCompanyId,
    companyName: String(input.companyName || existing.companyName || "").trim(),
    rootFolderId: checks.rootFolderId || existing.rootFolderId || companyId,
    masterSheetId: checks.masterSheetId || existing.masterSheetId,
    workbookFolderId: existing.workbookFolderId,
    companyFoldersMappingStatus:
      checks.companyFoldersMappingOk === true ? "mapped" : existing.companyFoldersMappingStatus,
    firstAdminStatus: checks.firstAdminReady === true ? "ready" : existing.firstAdminStatus,
    lastHealthCheckAt: existing.lastHealthCheckAt || (checks.healthCheckRun ? now : ""),
    status: COMPANY_REGISTRY_STATUS_LIVE,
    markLive: true,
    markSetupComplete: true,
    clearUnlinkReason: true,
    touchSetup: false,
  });

  const fresh =
    (await getCompanyWorkspaceRegistryRecord(auth, deps, registryCompanyId)) ||
    persistResult.record ||
    existing;
  const registryStatus = getCanonicalCompanyStatus(fresh) || COMPANY_REGISTRY_STATUS_LIVE;

  return {
    ok: Boolean(persistResult.synced) || isCompanyRegistryLive(fresh),
    promoted: Boolean(persistResult.synced),
    alreadyLive: isCompanyRegistryLive(fresh) && !persistResult.synced,
    companyId: registryCompanyId,
    registryStatus,
    blockers: [],
    setupBlockers: [],
    needsAttention: false,
    company: fresh,
  };
}

export function installGodmodeRegistryActionRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

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
          return res.status(result.reason === "not_ready" ? 409 : 400).json({
            ok: false,
            error:
              result.blockers?.length > 0
                ? `Company is not ready to go live: ${result.blockers.join("; ")}`
                : result.reason || "Unable to mark company live.",
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
