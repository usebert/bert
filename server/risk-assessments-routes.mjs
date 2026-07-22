/**
 * Risk Assessments Phase 2 API routes.
 */
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import { actorCanAccessCompanyHealthSafety, healthSafetyApiFailure } from "./health-safety-service.mjs";
import {
  RISK_ASSESSMENT_ROUTE_TIMEOUT_MS,
  approveCompanyRiskAssessment,
  archiveCompanyRiskAssessment,
  archiveRiskAssessmentHazard,
  archiveRiskAssessmentLink,
  createCompanyRiskAssessment,
  createNewVersionCompanyRiskAssessment,
  createRiskAssessmentHazard,
  createRiskAssessmentLink,
  getCompanyRiskAssessment,
  listCompanyRiskAssessments,
  listRiskAssessmentHazards,
  listRiskAssessmentLinks,
  listRiskAssessmentReviews,
  patchCompanyRiskAssessment,
  patchRiskAssessmentHazard,
  rejectCompanyRiskAssessment,
  restoreCompanyRiskAssessment,
  reviewCompanyRiskAssessment,
  submitCompanyRiskAssessment,
} from "./risk-assessments-service.mjs";

function canManageRiskAssessmentWrites(actor) {
  const role = String(actor?.role || "").trim();
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function installRiskAssessmentRoutes(app, deps) {
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
    if (options.manage && !canManageRiskAssessmentWrites(actor)) {
      res.status(403).json({ ok: false, error: "You do not have permission to manage risk assessments." });
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
        ...(resolved.alternateCompanyIds || []),
      ])
    ) {
      res.status(403).json({ ok: false, error: "You do not have access to this company." });
      return null;
    }
    return { authed, actor, resolved };
  };

  const runRoute = (req, res, options, run) => {
    void withOperationTimeout(
      (async () => {
        const context = await resolveRouteContext(req, res, options);
        if (!context) return;
        const result = await run(context);
        if (!result?.ok) {
          res.status(result?.httpStatus || 400).json(result);
          return;
        }
        res.json(result);
      })(),
      options.timeoutMs || RISK_ASSESSMENT_ROUTE_TIMEOUT_MS,
      options.label || "Risk assessment route",
    ).catch((error) => {
      res.status(500).json(
        healthSafetyApiFailure(
          "RISK_ASSESSMENT_FAILED",
          "Risk assessment request failed.",
          500,
          error instanceof Error ? error.message : String(error),
        ),
      );
    });
  };

  app.get("/api/companies/:companyFolderId/risk-assessments", (req, res) => {
    runRoute(req, res, { label: "List risk assessments" }, ({ authed, actor, resolved }) =>
      listCompanyRiskAssessments(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
        includeArchived: req.query?.includeArchived === "true",
      }),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments", (req, res) => {
    runRoute(req, res, { manage: true, label: "Create risk assessment" }, ({ authed, actor, resolved }) =>
      createCompanyRiskAssessment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
    );
  });

  app.get("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId", (req, res) => {
    runRoute(req, res, { label: "Get risk assessment" }, ({ authed, actor, resolved }) =>
      getCompanyRiskAssessment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId),
    );
  });

  app.patch("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId", (req, res) => {
    runRoute(req, res, { manage: true, label: "Patch risk assessment" }, ({ authed, actor, resolved }) =>
      patchCompanyRiskAssessment(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/submit", (req, res) => {
    runRoute(req, res, { manage: true, label: "Submit risk assessment" }, ({ authed, actor, resolved }) =>
      submitCompanyRiskAssessment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/approve", (req, res) => {
    runRoute(req, res, { manage: true, label: "Approve risk assessment" }, ({ authed, actor, resolved }) =>
      approveCompanyRiskAssessment(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/reject", (req, res) => {
    runRoute(req, res, { manage: true, label: "Reject risk assessment" }, ({ authed, actor, resolved }) =>
      rejectCompanyRiskAssessment(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/archive", (req, res) => {
    runRoute(req, res, { manage: true, label: "Archive risk assessment" }, ({ authed, actor, resolved }) =>
      archiveCompanyRiskAssessment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/restore", (req, res) => {
    runRoute(req, res, { manage: true, label: "Restore risk assessment" }, ({ authed, actor, resolved }) =>
      restoreCompanyRiskAssessment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/review", (req, res) => {
    runRoute(req, res, { manage: true, label: "Review risk assessment" }, ({ authed, actor, resolved }) =>
      reviewCompanyRiskAssessment(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/new-version", (req, res) => {
    runRoute(req, res, { manage: true, label: "New risk assessment version" }, ({ authed, actor, resolved }) =>
      createNewVersionCompanyRiskAssessment(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.get("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/hazards", (req, res) => {
    runRoute(req, res, { label: "List hazards" }, ({ authed, actor, resolved }) =>
      listRiskAssessmentHazards(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId, {
        includeArchived: req.query?.includeArchived === "true",
      }),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/hazards", (req, res) => {
    runRoute(req, res, { manage: true, label: "Create hazard" }, ({ authed, actor, resolved }) =>
      createRiskAssessmentHazard(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.patch("/api/companies/:companyFolderId/risk-assessment-hazards/:hazardId", (req, res) => {
    runRoute(req, res, { manage: true, label: "Patch hazard" }, ({ authed, actor, resolved }) =>
      patchRiskAssessmentHazard(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.hazardId, req.body || {}),
    );
  });

  app.delete("/api/companies/:companyFolderId/risk-assessment-hazards/:hazardId", (req, res) => {
    runRoute(req, res, { manage: true, label: "Archive hazard" }, ({ authed, actor, resolved }) =>
      archiveRiskAssessmentHazard(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.hazardId),
    );
  });

  app.get("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/links", (req, res) => {
    runRoute(req, res, { label: "List links" }, ({ authed, actor, resolved }) =>
      listRiskAssessmentLinks(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId, {
        includeArchived: req.query?.includeArchived === "true",
      }),
    );
  });

  app.post("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/links", (req, res) => {
    runRoute(req, res, { manage: true, label: "Create link" }, ({ authed, actor, resolved }) =>
      createRiskAssessmentLink(
        authed,
        { ...registryDeps, ...scheduleDeps },
        resolved,
        actor,
        req.params.riskAssessmentId,
        req.body || {},
      ),
    );
  });

  app.delete("/api/companies/:companyFolderId/risk-assessment-links/:linkId", (req, res) => {
    runRoute(req, res, { manage: true, label: "Archive link" }, ({ authed, actor, resolved }) =>
      archiveRiskAssessmentLink(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.linkId),
    );
  });

  app.get("/api/companies/:companyFolderId/risk-assessments/:riskAssessmentId/reviews", (req, res) => {
    runRoute(req, res, { label: "List reviews" }, ({ authed, actor, resolved }) =>
      listRiskAssessmentReviews(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.params.riskAssessmentId),
    );
  });
}
