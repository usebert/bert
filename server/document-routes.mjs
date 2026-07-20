/**
 * Controlled Documents API routes.
 */
import { withOperationTimeout, DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS } from "./ensure-required-tabs.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  actorCanAccessCompanyDocuments,
  canManageDocumentSettings,
  canManageDocuments,
  canViewDocuments,
  createDocument,
  DOCUMENTS_ROUTE_TIMEOUT_MS,
  getDocument,
  getDocumentFileLink,
  getDocumentSettings,
  listDocuments,
  searchDocuments,
  updateDocumentSettings,
} from "./document-service.mjs";
import { listDocumentFolders, provisionDocumentFolders } from "./document-folder-service.mjs";

export function installDocumentRoutes(app, deps = {}) {
  const {
    getAuthedClient,
    envConfigured,
    parseBertActorFromRequest,
    registryDeps = {},
    scheduleDeps = {},
    google,
    rejectCompanyApiIfFolderInvalid,
  } = deps;

  const missing = [];
  if (typeof getAuthedClient !== "function") missing.push("getAuthedClient");
  if (typeof envConfigured !== "function") missing.push("envConfigured");
  if (typeof parseBertActorFromRequest !== "function") missing.push("parseBertActorFromRequest");
  if (!google || typeof google.drive !== "function") missing.push("google");
  if (typeof scheduleDeps.readTabRecords !== "function") missing.push("scheduleDeps.readTabRecords");
  if (typeof scheduleDeps.appendTabRows !== "function") missing.push("scheduleDeps.appendTabRows");
  if (missing.length > 0) {
    throw new Error(
      `DOCUMENTS_ROUTE_DEPS_MISSING: ${missing.join(", ")} must be defined before installDocumentRoutes.`,
    );
  }

  const resolveDocumentsRouteContext = async (req, res, options = {}) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      res.status(401).json({
        ok: false,
        code: "DOCUMENTS_UNAUTHENTICATED",
        error: "Sign in required.",
        message: "Sign in required.",
      });
      return null;
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewDocuments(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENTS_FORBIDDEN",
        error: "You do not have access to Documents.",
        message: "You do not have access to Documents.",
      });
      return null;
    }
    if (options.manage && !canManageDocuments(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENTS_FORBIDDEN",
        error: "You do not have permission to manage documents.",
        message: "You do not have permission to manage documents.",
      });
      return null;
    }
    if (options.settings && !canManageDocumentSettings(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENTS_SETTINGS_FORBIDDEN",
        error: "You do not have permission to manage document settings.",
        message: "You do not have permission to manage document settings.",
      });
      return null;
    }

    const sessionCompanyFolderId = trim(actor?.companyFolderId || actor?.companyId || companyFolderId);
    const sessionMasterSheetId = trim(actor?.masterSheetId || "");
    const trustSessionContext = actor?.kind === "company" && Boolean(sessionCompanyFolderId && sessionMasterSheetId);

    if (!trustSessionContext && typeof rejectCompanyApiIfFolderInvalid === "function") {
      const folderReject = await rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        sessionCompanyFolderId,
        actor?.companyName || "",
      );
      if (folderReject) {
        res.status(folderReject.httpStatus || 400).json(folderReject);
        return null;
      }
    }

    const resolved = await resolveCompanyScheduleContext(
      authed,
      { ...registryDeps, ...scheduleDeps },
      {
        companyId: sessionCompanyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId: trustSessionContext
          ? sessionMasterSheetId
          : trim(req.body?.masterSheetId || req.query?.masterSheetId || ""),
        companyName: trim(req.body?.companyName || actor?.companyName || ""),
        trustSessionContext,
      },
    );
    if (!resolved.ok) {
      res.status(resolved.httpStatus || 400).json({
        ok: false,
        code: resolved.code,
        error: resolved.error,
        message: resolved.message || resolved.error,
      });
      return null;
    }
    if (
      !actorCanAccessCompanyDocuments(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENTS_COMPANY_MISMATCH",
        error: "Your session does not belong to this company.",
        message: "Your session does not belong to this company.",
      });
      return null;
    }
    return {
      authed,
      actor,
      resolved: {
        companyFolderId: resolved.companyFolderId,
        companyId: resolved.companyId,
        masterSheetId: resolved.masterSheetId,
        companyName: resolved.companyName,
      },
    };
  };

  const documentsRouteError = (res, result, fallbackCode) =>
    res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
    });

  const runDocumentsRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveDocumentsRouteContext(req, res, options);
    if (!routeContext) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(run(routeContext), failure.operation, DOCUMENTS_ROUTE_TIMEOUT_MS);
      if (!result.ok) {
        return documentsRouteError(res, result, failure.code);
      }
      return res.json(result);
    } catch (error) {
      console.info("[documents]", {
        phase: failure.operation,
        companyId: String(req.params?.companyFolderId || "").trim(),
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        ok: false,
        code: failure.code,
        error: failure.message,
        message: failure.message,
      });
    }
  };

  const serviceDeps = { ...registryDeps, ...scheduleDeps, google };

  app.get("/api/companies/:companyFolderId/documents", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listDocuments(authed, serviceDeps, resolved, actor, {
          folderRecordId: String(req.query?.folderRecordId || "").trim(),
          includeArchived: String(req.query?.includeArchived || "") === "1",
        }),
      { operation: "documents_list", code: "DOCUMENTS_LIST_FAILED", message: "Could not load documents." },
    );
  });

  app.get("/api/companies/:companyFolderId/documents/search", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        searchDocuments(authed, serviceDeps, resolved, actor, {
          query: String(req.query?.q || req.query?.query || "").trim(),
          folderRecordId: String(req.query?.folderRecordId || "").trim(),
          includeArchived: String(req.query?.includeArchived || "") === "1",
        }),
      { operation: "documents_search", code: "DOCUMENTS_SEARCH_FAILED", message: "Could not search documents." },
    );
  });

  app.get("/api/companies/:companyFolderId/documents/:documentId", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getDocument(authed, serviceDeps, resolved, actor, String(req.params?.documentId || "").trim()),
      { operation: "documents_get", code: "DOCUMENTS_GET_FAILED", message: "Could not load document." },
    );
  });

  app.get("/api/companies/:companyFolderId/documents/:documentId/file", async (req, res) => {
    const routeContext = await resolveDocumentsRouteContext(req, res, {});
    if (!routeContext) {
      return undefined;
    }
    try {
      const drive = google.drive({ version: "v3", auth: routeContext.authed });
      const result = await withOperationTimeout(
        getDocumentFileLink(
          routeContext.authed,
          serviceDeps,
          routeContext.resolved,
          routeContext.actor,
          String(req.params?.documentId || "").trim(),
          drive,
        ),
        "documents_file",
        DOCUMENTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return documentsRouteError(res, result, "DOCUMENTS_FILE_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "DOCUMENTS_FILE_FAILED",
        error: "Could not open document file.",
        message: "Could not open document file.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/documents", async (req, res) => {
    const routeContext = await resolveDocumentsRouteContext(req, res, { manage: true });
    if (!routeContext) {
      return undefined;
    }
    try {
      const drive = google.drive({ version: "v3", auth: routeContext.authed });
      const body = req.body || {};
      const result = await withOperationTimeout(
        createDocument(routeContext.authed, serviceDeps, routeContext.resolved, routeContext.actor, body, drive),
        "documents_create",
        Math.max(DOCUMENTS_ROUTE_TIMEOUT_MS, DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS),
      );
      if (!result.ok) {
        return documentsRouteError(res, result, "DOCUMENTS_CREATE_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "DOCUMENTS_CREATE_FAILED",
        error: "Could not register document.",
        message: "Could not register document.",
      });
    }
  });

  app.get("/api/companies/:companyFolderId/document-folders", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      {},
      ({ authed, resolved }) => listDocumentFolders(authed, serviceDeps, resolved),
      { operation: "document_folders_list", code: "DOCUMENT_FOLDERS_LIST_FAILED", message: "Could not load document folders." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-folders/provision", async (req, res) => {
    const routeContext = await resolveDocumentsRouteContext(req, res, { manage: true });
    if (!routeContext) {
      return undefined;
    }
    try {
      const drive = google.drive({ version: "v3", auth: routeContext.authed });
      const result = await withOperationTimeout(
        provisionDocumentFolders(routeContext.authed, serviceDeps, routeContext.resolved, drive),
        "document_folders_provision",
        Math.max(DOCUMENTS_ROUTE_TIMEOUT_MS, DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS),
      );
      if (!result.ok) {
        return documentsRouteError(res, result, "DOCUMENT_FOLDERS_PROVISION_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "DOCUMENT_FOLDERS_PROVISION_FAILED",
        error: "Could not provision document folders.",
        message: "Could not provision document folders.",
      });
    }
  });

  app.get("/api/companies/:companyFolderId/document-settings", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      {},
      ({ authed, resolved }) => getDocumentSettings(authed, serviceDeps, resolved),
      { operation: "document_settings_get", code: "DOCUMENT_SETTINGS_GET_FAILED", message: "Could not load document settings." },
    );
  });

  app.put("/api/companies/:companyFolderId/document-settings", async (req, res) => {
    return runDocumentsRoute(
      req,
      res,
      { settings: true },
      ({ authed, actor, resolved }) => updateDocumentSettings(authed, serviceDeps, resolved, actor, req.body || {}),
      {
        operation: "document_settings_put",
        code: "DOCUMENT_SETTINGS_PUT_FAILED",
        message: "Could not update document settings.",
      },
    );
  });
}

function trim(value) {
  return String(value ?? "").trim();
}
