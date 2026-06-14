/**
 * CompanyFolderResolver — Google Drive company folder is the source of truth.
 * Resolves folder metadata, workbook, and required tabs; registry/health run in background.
 */
import {
  cleanCompanyNameFromFolder,
  COMPANY_CONTEXT_STATUS_USABLE,
  COMPANY_READY_INVITE_MESSAGE,
  isCompanyWorkspaceUsable,
} from "../shared/company-folder-context.mjs";
import { isSystemTemplateCompany } from "../shared/system-template-company.mjs";
import {
  ensureCompanyFolderStructure,
  ensureCompanyMasterSheet,
  discoverCompanyMasterSheetInFolder,
} from "./company-folder-structure.mjs";
import { ensureRequiredTabs, findMissingRequiredTabs } from "./ensure-required-tabs.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import { persistCompanyWorkspaceSetup } from "./company-workspace-registry.mjs";
import { buildCompanyFolderUrl, buildShareCompanyFolderHint } from "../shared/company-folder-links.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function resolveGoogleConnectedEmail(deps) {
  return trim(typeof deps?.getGoogleConnectedEmail === "function" ? deps.getGoogleConnectedEmail() : "");
}

function folderShareOperatorHint(companyFolderId, deps) {
  return buildShareCompanyFolderHint({
    companyFolderId,
    googleConnectedEmail: resolveGoogleConnectedEmail(deps),
  });
}

function normalizeDriveFolderName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function readCompanyFolderMetadata(drive, companyFolderId) {
  const meta = await drive.files.get({
    fileId: companyFolderId,
    supportsAllDrives: true,
    fields: "id,name,mimeType",
  });
  if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
    const error = new Error("The company folder ID is missing or invalid.");
    error.code = "COMPANY_FOLDER_INVALID";
    throw error;
  }
  return meta.data;
}

function findWorkbookFolderId(folderIds = {}, legacyRootIds = {}) {
  return trim(folderIds.BERT_COMPANY_WORKBOOK || legacyRootIds.setupFolderId);
}

function queuePostResolveBackgroundJobs(deps, context = {}) {
  const companyId = trim(context.companyId || context.companyFolderId);
  if (!companyId) {
    return { queued: [] };
  }
  const queued = [];
  const requestedBy = trim(context.requestedBy || "folder_resolver");

  if (typeof deps.queueCompanySetupJobs === "function") {
    const jobs = deps.queueCompanySetupJobs({
      companyId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      companyName: context.companyName,
      requestedBy,
      checks: context.checks || {},
    });
    if (Array.isArray(jobs)) {
      queued.push(...jobs.filter(Boolean).map((job) => job?.type || "background"));
    }
  } else if (typeof deps.queueCompanyHealthCheckIfReady === "function") {
    const healthJob = deps.queueCompanyHealthCheckIfReady({
      autoQueue: true,
      companyId,
      requestedBy,
      payload: {
        masterSheetId: context.masterSheetId,
        companyFolderId: context.companyFolderId,
        companyName: context.companyName,
      },
    });
    if (healthJob) {
      queued.push(healthJob.type || "verify_company_health");
    }
  }

  return { queued };
}

async function rebuildRegistryCache(auth, deps, context = {}) {
  const companyId = trim(context.companyId);
  const masterSheetId = trim(context.masterSheetId);
  if (!auth || !companyId || !masterSheetId) {
    return { synced: false, warning: "registry_cache_skipped" };
  }
  try {
    const result = await persistCompanyWorkspaceSetup(auth, deps, {
      companyId,
      companyFolderId: context.companyFolderId || companyId,
      rootFolderId: context.companyFolderId || companyId,
      masterSheetId,
      companyName: context.companyName,
      workbookFolderId: context.workbookFolderId,
      status: "Setup in progress",
      markLive: false,
      markSetupComplete: false,
      touchSetup: true,
    });
    return { synced: Boolean(result?.synced), record: result?.record || null };
  } catch (error) {
    console.warn("[company-folder-resolver] registry cache rebuild failed (non-blocking)", {
      companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      synced: false,
      warning: "registry_cache_failed",
      technicalError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve company context from a Drive folder id.
 * @returns {Promise<{
 *   ok: boolean;
 *   companyId: string;
 *   companyName: string;
 *   companyFolderId: string;
 *   masterSheetId: string;
 *   status: string;
 *   userMessage?: string;
 *   tabsQueued?: boolean;
 *   missingTabs?: string[];
 *   backgroundJobs?: string[];
 *   registryCache?: object;
 * }>}
 */
export async function resolveCompanyFromFolder(auth, deps, companyFolderId, options = {}) {
  const folderId = trim(companyFolderId || options.companyFolderId);
  if (!auth) {
    return {
      ok: false,
      companyId: folderId,
      companyName: "",
      companyFolderId: folderId,
      masterSheetId: "",
      status: "",
      userMessage: "Connect Google Workspace before resolving the company folder.",
      reasonCode: "GOOGLE_NOT_CONNECTED",
    };
  }
  if (!folderId) {
    return {
      ok: false,
      companyId: "",
      companyName: "",
      companyFolderId: "",
      masterSheetId: "",
      status: "",
      userMessage: "Select a company folder first.",
      reasonCode: "COMPANY_FOLDER_MISSING",
    };
  }

  const { google } = deps;
  const drive = google.drive({ version: "v3", auth });
  const folderMeta = await readCompanyFolderMetadata(drive, folderId);
  const companyName = cleanCompanyNameFromFolder(
    trim(options.companyName) || trim(folderMeta.name),
  );

  if (isSystemTemplateCompany({ companyName, name: companyName, companyId: folderId })) {
    return {
      ok: false,
      companyId: folderId,
      companyName,
      companyFolderId: folderId,
      masterSheetId: "",
      status: "",
      userMessage: "This workspace is a system template and cannot be used as a company.",
      reasonCode: "SYSTEM_TEMPLATE_COMPANY",
    };
  }

  const masterSheetHint = trim(options.masterSheetId);
  let workbookFolderId = trim(options.workbookFolderId);
  let folderIds = {};
  let legacyRootIds = {};
  const preferFolderResolution = options.preferFolderResolution === true;
  const createIfMissing = options.createIfMissing !== false;
  const readOnlyResolve = preferFolderResolution && createIfMissing === false;

  if (!workbookFolderId || (options.ensureStructure !== false && !readOnlyResolve)) {
    const structure = await ensureCompanyFolderStructure(deps, auth, {
      companyName,
      companyRootFolderId: folderId,
      masterSheetId: readOnlyResolve ? "" : masterSheetHint,
      syncWorkbookTab: false,
      placeFiles: readOnlyResolve ? false : Boolean(masterSheetHint),
    });
    folderIds = structure.folderIds || {};
    legacyRootIds = structure.legacyRootIds || {};
    workbookFolderId = findWorkbookFolderId(folderIds, legacyRootIds) || workbookFolderId;
  }

  const masterSheet = await ensureCompanyMasterSheet(drive, {
    companyName,
    masterSheetId: masterSheetHint,
    workbookFolderId,
    legacySetupFolderId: legacyRootIds.setupFolderId,
    companyRootFolderId: folderId,
    preferFolderResolution,
    createIfMissing,
    skipRecursiveDiscovery: options.skipRecursiveDiscovery === true,
  });
  const masterSheetId = trim(masterSheet.masterSheetId);
  if (!masterSheetId) {
    if (masterSheet.source === "non_native_workbook") {
    return {
      ok: false,
      companyId: folderId,
      companyName,
      companyFolderId: folderId,
      companyFolderUrl: buildCompanyFolderUrl(folderId),
      masterSheetId: "",
      status: "",
      userMessage: "An Excel workbook was found but BERT needs a Google Sheet.",
      reasonCode: "WORKBOOK_NOT_FOUND",
      masterSheet,
      operatorHint: folderShareOperatorHint(folderId, deps) || undefined,
    };
    }
    const shareHint = folderShareOperatorHint(folderId, deps);
    return {
      ok: false,
      companyId: folderId,
      companyName,
      companyFolderId: folderId,
      companyFolderUrl: buildCompanyFolderUrl(folderId),
      masterSheetId: "",
      status: "",
      userMessage: shareHint
        ? `Could not find the company workbook. ${shareHint}`
        : "Could not find or create the company workbook.",
      reasonCode: "MASTER_SHEET_MISSING",
      masterSheet,
      operatorHint: shareHint || undefined,
    };
  }

  let tabsQueued = false;
  let missingTabs = [];
  const ensureTabsSync = options.ensureTabsSync === true;

  if (ensureTabsSync) {
    await ensureRequiredTabs(auth, deps, masterSheetId);
  } else {
    try {
      const sheets = google.sheets({ version: "v4", auth });
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: masterSheetId,
        includeGridData: false,
        fields: "sheets.properties.title",
      });
      const titles =
        meta.data.sheets?.map((sheet) => trim(sheet.properties?.title)).filter(Boolean) || [];
      missingTabs = findMissingRequiredTabs(titles);
      tabsQueued = missingTabs.length > 0;
    } catch {
      tabsQueued = true;
    }
  }

  const folderPlacement =
    options.skipFolderPlacementCheck === true
      ? { ok: true }
      : await validateCompanyFolderUnderCompaniesRoot(auth, deps, folderId, { companyFolderName: companyName });
  const folderPlacementOk = Boolean(folderPlacement?.ok);

  const context = {
    companyId: folderId,
    companyFolderId: folderId,
    companyName,
    masterSheetId,
    workbookFolderId,
    status: folderPlacementOk ? COMPANY_CONTEXT_STATUS_USABLE : "",
    folderPlacementOk,
  };

  const registryCache = await rebuildRegistryCache(auth, deps, context);
  const { queued: backgroundJobs } = queuePostResolveBackgroundJobs(deps, {
    ...context,
    requestedBy: options.requestedBy,
  });

  if (tabsQueued && typeof deps.enqueueJob === "function") {
    deps.enqueueJob({
      type: "complete_company_setup",
      companyId: folderId,
      requestedBy: trim(options.requestedBy || "folder_resolver"),
      payload: {
        workspaceId: folderId,
        companyFolderId: folderId,
        masterSheetId,
        companyName,
        ensureRequiredTabs: true,
      },
    });
    backgroundJobs.push("complete_company_setup");
  }

  return {
    ok: true,
    companyId: folderId,
    companyName,
    companyFolderId: folderId,
    masterSheetId,
    masterSheetLink: masterSheet.masterSheetLink,
    workbookFolderId,
    status: folderPlacementOk ? COMPANY_CONTEXT_STATUS_USABLE : "",
    source: trim(masterSheet.source) || undefined,
    userMessage: folderPlacementOk
      ? COMPANY_READY_INVITE_MESSAGE
      : folderPlacement.userMessage || "Company folder is not under Live Companies.",
    reasonCode: folderPlacementOk ? undefined : folderPlacement.reasonCode,
    tabsQueued,
    missingTabs,
    masterSheetCreated: Boolean(masterSheet.created),
    registryCache,
    backgroundJobs,
    usable: isCompanyWorkspaceUsable(context),
    folderPlacementOk,
    folderPlacement,
  };
}

export function installCompanyFolderResolverRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  app.post(
    "/api/godmode/companies/:companyFolderId/resolve-from-folder",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      if (!envConfigured()) {
        return res.status(503).json({
          ok: false,
          error: "Google Workspace is not configured on the server.",
        });
      }
      const authed = getAuthedClient();
      if (!authed) {
        return res.status(401).json({
          ok: false,
          error: "Connect Google Workspace before resolving the company folder.",
        });
      }

      const companyFolderId = trim(
        req.params.companyFolderId || req.body?.companyFolderId || req.body?.workspaceId,
      );
      try {
        const result = await resolveCompanyFromFolder(authed, deps, companyFolderId, {
          companyName: trim(req.body?.companyName),
          masterSheetId: trim(req.body?.masterSheetId),
          ensureTabsSync: req.body?.ensureTabsSync === true,
          requestedBy: trim(req.body?.requestedBy || "godmode"),
        });
        const status = result.ok ? 200 : result.reasonCode === "GOOGLE_NOT_CONNECTED" ? 401 : 400;
        return res.status(status).json(result);
      } catch (error) {
        console.error("[company-folder-resolver] resolve-from-folder failed", error);
        const shareHint = folderShareOperatorHint(companyFolderId, deps);
        const message = error instanceof Error ? error.message : "Unable to resolve company from folder.";
        const lower = message.toLowerCase();
        const accessDenied = lower.includes("permission") || lower.includes("forbidden") || lower.includes("not found");
        return res.status(accessDenied ? 403 : 500).json({
          ok: false,
          companyFolderId,
          companyFolderUrl: buildCompanyFolderUrl(companyFolderId),
          reasonCode: accessDenied ? "GOOGLE_SHEET_ACCESS_DENIED" : "FOLDER_RESOLVE_FAILED",
          error: message,
          operatorHint: shareHint || undefined,
          userMessage: shareHint ? `${message} ${shareHint}` : message,
        });
      }
    },
  );

  app.get(
    "/api/godmode/companies/:companyFolderId/master-sheet-discovery",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      if (!envConfigured()) {
        return res.status(503).json({
          ok: false,
          error: "Google Workspace is not configured on the server.",
        });
      }
      const authed = getAuthedClient();
      if (!authed) {
        return res.status(401).json({
          ok: false,
          error: "Connect Google Workspace before probing company folder discovery.",
        });
      }

      const companyFolderId = trim(req.params.companyFolderId);
      const companyName = trim(req.query.companyName);
      const googleConnectedEmail = resolveGoogleConnectedEmail(deps);
      const companyFolderUrl = buildCompanyFolderUrl(companyFolderId);
      const operatorHint = folderShareOperatorHint(companyFolderId, deps);

      try {
        const drive = deps.google.drive({ version: "v3", auth: authed });
        let folderReadable = true;
        let folderName = "";
        try {
          const meta = await drive.files.get({
            fileId: companyFolderId,
            supportsAllDrives: true,
            fields: "id,name,mimeType",
          });
          folderName = trim(meta.data.name);
          folderReadable = meta.data.mimeType === "application/vnd.google-apps.folder";
        } catch (error) {
          folderReadable = false;
          const message = error instanceof Error ? error.message : "Unable to read company folder.";
          return res.status(403).json({
            ok: false,
            companyFolderId,
            companyFolderUrl,
            googleConnectedEmail: googleConnectedEmail || undefined,
            folderReadable: false,
            reasonCode: "GOOGLE_SHEET_ACCESS_DENIED",
            error: message,
            operatorHint: operatorHint || undefined,
            userMessage: operatorHint ? `${message} ${operatorHint}` : message,
          });
        }

        const discovered = await discoverCompanyMasterSheetInFolder(drive, {
          companyRootFolderId: companyFolderId,
          companyName: companyName || folderName,
        });

        const workbookFound = Boolean(discovered?.masterSheetId);
        return res.json({
          ok: workbookFound,
          companyFolderId,
          companyFolderUrl,
          companyName: companyName || folderName || undefined,
          googleConnectedEmail: googleConnectedEmail || undefined,
          folderReadable,
          reasonCode: workbookFound ? undefined : discovered?.source === "non_native_workbook" ? "WORKBOOK_NOT_FOUND" : "WORKBOOK_NOT_FOUND",
          discovered,
          operatorHint: workbookFound ? undefined : operatorHint || undefined,
          userMessage: workbookFound
            ? undefined
            : operatorHint
              ? `No BERT Master Sheet found. ${operatorHint}`
              : "No BERT Master Sheet found in the company folder.",
        });
      } catch (error) {
        console.error("[company-folder-resolver] master-sheet-discovery failed", error);
        const message = error instanceof Error ? error.message : "Unable to probe company folder discovery.";
        return res.status(500).json({
          ok: false,
          companyFolderId,
          companyFolderUrl,
          googleConnectedEmail: googleConnectedEmail || undefined,
          error: message,
          operatorHint: operatorHint || undefined,
        });
      }
    },
  );
}
