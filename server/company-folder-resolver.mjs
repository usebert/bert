/**
 * CompanyFolderResolver — Google Drive company folder is the source of truth.
 * Resolves folder metadata, in-folder workbook, and required tabs.
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
import { ensureRequiredTabs } from "./workbook-service.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
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

/**
 * Resolve company context from a Drive folder id.
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
  const companyName = cleanCompanyNameFromFolder(trim(folderMeta.name));

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

  let workbookFolderId = trim(options.workbookFolderId);
  let folderIds = {};
  let legacyRootIds = {};
  const masterSheetIdHint = trim(options.masterSheetId);
  const preferFolderResolution = options.preferFolderResolution !== false;
  const createIfMissing = options.createIfMissing !== false;
  const readOnlyResolve = preferFolderResolution && createIfMissing === false;

  if (!workbookFolderId || (options.ensureStructure !== false && !readOnlyResolve)) {
    const structure = await ensureCompanyFolderStructure(deps, auth, {
      companyName,
      companyRootFolderId: folderId,
      masterSheetId: masterSheetIdHint,
      syncWorkbookTab: false,
      placeFiles: readOnlyResolve ? false : true,
    });
    folderIds = structure.folderIds || {};
    legacyRootIds = structure.legacyRootIds || {};
    workbookFolderId = findWorkbookFolderId(folderIds, legacyRootIds) || workbookFolderId;
  }

  const masterSheet = await ensureCompanyMasterSheet(drive, {
    companyName,
    masterSheetId: masterSheetIdHint,
    workbookFolderId,
    legacySetupFolderId: legacyRootIds.setupFolderId,
    companyRootFolderId: folderId,
    preferFolderResolution: true,
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

  let tabsEnsured = false;
  let missingTabs = [];
  const ensureTabsSync = options.ensureTabsSync !== false;

  if (ensureTabsSync) {
    const tabResult = await ensureRequiredTabs(auth, deps, masterSheetId);
    tabsEnsured = true;
    missingTabs = tabResult.missing || [];
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
    tabsEnsured,
    missingTabs,
    masterSheetCreated: Boolean(masterSheet.created),
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
        const masterSheetIdHint = trim(req.body?.masterSheetId);
        const result = await resolveCompanyFromFolder(authed, deps, companyFolderId, {
          ensureTabsSync: req.body?.ensureTabsSync !== false,
          requestedBy: trim(req.body?.requestedBy || "godmode"),
          masterSheetId: masterSheetIdHint,
          skipFolderPlacementCheck: true,
          createIfMissing: masterSheetIdHint ? false : undefined,
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
          companyName: cleanCompanyNameFromFolder(folderName),
        });

        const workbookFound = Boolean(discovered?.masterSheetId);
        return res.json({
          ok: workbookFound,
          companyFolderId,
          companyFolderUrl,
          companyName: cleanCompanyNameFromFolder(folderName) || undefined,
          googleConnectedEmail: googleConnectedEmail || undefined,
          folderReadable,
          reasonCode: workbookFound ? undefined : "WORKBOOK_NOT_FOUND",
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
