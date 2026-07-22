/**
 * Health & Safety Phase 1 API routes.
 */
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  HEALTH_SAFETY_ROUTE_TIMEOUT_MS,
  actorCanAccessCompanyHealthSafety,
  archiveCompanyCoshh,
  assessIncidentRiddor,
  buildHealthSafetyOverview,
  canManageHealthSafety,
  createCompanyCoshh,
  createCompanyRiddor,
  createCoshhAssessment,
  getCompanyCoshh,
  getCompanyRiddor,
  getCoshhAssessment,
  healthSafetyApiFailure,
  listCompanyCoshh,
  listCompanyRiddor,
  listCoshhAssessments,
  patchCompanyCoshh,
  patchCompanyRiddor,
  patchCoshhAssessment,
  restoreCompanyCoshh,
} from "./health-safety-service.mjs";

export function installHealthSafetyRoutes(app, deps) {
  const {
    getAuthedClient,
    parseBertActorFromRequest,
    registryDeps,
    readTabRecords,
    appendTabRows,
    ensureTabExists,
    ensureColumns,
    getTabValues,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
    rowsToRecords,
    readCompanySheetById,
    getCompanyUsersDeps,
    rejectCompanyApiIfFolderInvalid,
  } = deps;

  const scheduleDeps = {
    readCompanySheetById,
    ...getCompanyUsersDeps(),
    readTabRecords,
    appendTabRows,
    ensureTabExists,
    ensureColumns,
    getTabValues,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
    rowsToRecords,
  };

  const resolveRouteContext = async (req, res, options = {}) => {
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    if (!companyFolderId) {
      res.status(400).json({ ok: false, error: "Company folder ID is required." });
      return null;
    }
    const actor = parseBertActorFromRequest(req);
    if (!actor) {
      res.status(401).json({ ok: false, error: "Sign in required." });
      return null;
    }
    if (options.manage && !canManageHealthSafety(actor)) {
      res.status(403).json({ ok: false, error: "You do not have permission to manage Health & Safety records." });
      return null;
    }
    const authed = getAuthedClient();
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(authed, registryDeps, sessionCompanyFolderId);
    if (folderDenial) {
      res.status(folderDenial.httpStatus || 403).json(folderDenial.body || folderDenial);
      return null;
    }
    const resolved = await resolveCompanyScheduleContext(authed, { ...registryDeps, ...scheduleDeps }, {
      companyId: sessionCompanyFolderId,
      companyFolderId: sessionCompanyFolderId,
      masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
      companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
    });
    if (!resolved?.ok) {
      res.status(resolved?.httpStatus || 400).json({
        ok: false,
        error: resolved?.error || "Could not resolve company workbook.",
      });
      return null;
    }
    if (
      !actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({ ok: false, error: "Your session does not belong to this company." });
      return null;
    }
    return { authed, actor, resolved };
  };

  const routeError = (res, result, fallbackCode) =>
    res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
    });

  const runRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveRouteContext(req, res, options);
    if (!routeContext) return undefined;
    try {
      const result = await withOperationTimeout(run(routeContext), failure.operation, HEALTH_SAFETY_ROUTE_TIMEOUT_MS);
      if (!result.ok) return routeError(res, result, failure.code);
      return res.json(result);
    } catch (error) {
      console.info("[health-safety]", {
        phase: failure.operation,
        companyId: String(req.params?.companyFolderId || "").trim(),
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ ok: false, code: failure.code, error: failure.message, message: failure.message });
    }
  };

  app.get("/api/companies/:companyFolderId/health-safety/overview", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) => buildHealthSafetyOverview(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "health_safety_overview", code: "HEALTH_SAFETY_OVERVIEW_FAILED", message: "Could not load Health & Safety overview." },
    ),
  );

  app.get("/api/companies/:companyFolderId/coshh", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCompanyCoshh(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          includeArchived: req.query.includeArchived === "true",
        }),
      { operation: "coshh_list", code: "COSHH_LIST_FAILED", message: "Could not load COSHH register." },
    ),
  );

  app.post("/api/companies/:companyFolderId/coshh", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) => createCompanyCoshh(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "coshh_create", code: "COSHH_CREATE_FAILED", message: "Could not create COSHH record." },
    ),
  );

  app.get("/api/companies/:companyFolderId/coshh/:coshhId", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getCompanyCoshh(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.coshhId || "").trim()),
      { operation: "coshh_get", code: "COSHH_GET_FAILED", message: "Could not load COSHH record." },
    ),
  );

  app.patch("/api/companies/:companyFolderId/coshh/:coshhId", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        patchCompanyCoshh(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.coshhId || "").trim(),
          req.body || {},
        ),
      { operation: "coshh_patch", code: "COSHH_PATCH_FAILED", message: "Could not update COSHH record." },
    ),
  );

  app.post("/api/companies/:companyFolderId/coshh/:coshhId/archive", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        archiveCompanyCoshh(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.coshhId || "").trim()),
      { operation: "coshh_archive", code: "COSHH_ARCHIVE_FAILED", message: "Could not archive COSHH record." },
    ),
  );

  app.post("/api/companies/:companyFolderId/coshh/:coshhId/restore", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        restoreCompanyCoshh(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.coshhId || "").trim()),
      { operation: "coshh_restore", code: "COSHH_RESTORE_FAILED", message: "Could not restore COSHH record." },
    ),
  );

  app.get("/api/companies/:companyFolderId/coshh/:coshhId/assessments", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCoshhAssessments(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.coshhId || "").trim(),
        ),
      { operation: "coshh_assessments_list", code: "COSHH_ASSESSMENTS_FAILED", message: "Could not load COSHH assessments." },
    ),
  );

  app.post("/api/companies/:companyFolderId/coshh/:coshhId/assessments", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createCoshhAssessment(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.coshhId || "").trim(),
          req.body || {},
        ),
      { operation: "coshh_assessment_create", code: "COSHH_ASSESSMENT_CREATE_FAILED", message: "Could not create COSHH assessment." },
    ),
  );

  app.get("/api/companies/:companyFolderId/coshh-assessments/:assessmentId", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getCoshhAssessment(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.assessmentId || "").trim(),
        ),
      { operation: "coshh_assessment_get", code: "COSHH_ASSESSMENT_GET_FAILED", message: "Could not load COSHH assessment." },
    ),
  );

  app.patch("/api/companies/:companyFolderId/coshh-assessments/:assessmentId", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        patchCoshhAssessment(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.assessmentId || "").trim(),
          req.body || {},
        ),
      { operation: "coshh_assessment_patch", code: "COSHH_ASSESSMENT_PATCH_FAILED", message: "Could not update COSHH assessment." },
    ),
  );

  app.get("/api/companies/:companyFolderId/riddor", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCompanyRiddor(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          includeArchived: req.query.includeArchived === "true",
        }),
      { operation: "riddor_list", code: "RIDDOR_LIST_FAILED", message: "Could not load RIDDOR records." },
    ),
  );

  app.post("/api/companies/:companyFolderId/riddor", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) => createCompanyRiddor(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "riddor_create", code: "RIDDOR_CREATE_FAILED", message: "Could not create RIDDOR record." },
    ),
  );

  app.get("/api/companies/:companyFolderId/riddor/:riddorId", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getCompanyRiddor(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.riddorId || "").trim()),
      { operation: "riddor_get", code: "RIDDOR_GET_FAILED", message: "Could not load RIDDOR record." },
    ),
  );

  app.patch("/api/companies/:companyFolderId/riddor/:riddorId", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        patchCompanyRiddor(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.riddorId || "").trim(),
          req.body || {},
        ),
      { operation: "riddor_patch", code: "RIDDOR_PATCH_FAILED", message: "Could not update RIDDOR record." },
    ),
  );

  app.post("/api/companies/:companyFolderId/incidents/:incidentId/riddor-assessment", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        assessIncidentRiddor(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.incidentId || "").trim(),
          req.body || {},
        ),
      { operation: "incident_riddor_assessment", code: "INCIDENT_RIDDOR_FAILED", message: "Could not assess RIDDOR for incident." },
    ),
  );
}
