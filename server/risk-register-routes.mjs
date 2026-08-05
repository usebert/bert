/**
 * Risk Register API routes.
 */
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import { actorCanAccessCompanyHealthSafety, canManageHealthSafety, healthSafetyApiFailure } from "./health-safety-service.mjs";
import {
  actorCanAccessCompanyRiskRegister,
  getCompanyRiskRegisterItem,
  listCompanyRiskRegister,
} from "./risk-register-service.mjs";
import {
  approveVerificationRiskRegisterItem,
  cleanupStaleVerificationRiskRegister,
  cleanupVerificationRiskRegisterItem,
  createVerificationRiskRegisterItem,
  patchVerificationRiskRegisterItem,
  reviewVerificationRiskRegisterItem,
  submitVerificationRiskRegisterItem,
  upsertVerificationRiskRegisterControl,
} from "./risk-register-verification-service.mjs";

const RISK_REGISTER_ROUTE_TIMEOUT_MS = 120_000;

export function installRiskRegisterRoutes(app, deps) {
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
      res.status(403).json({ ok: false, error: "You do not have permission to manage Risk Register records." });
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
      !actorCanAccessCompanyRiskRegister(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ]) &&
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
      const result = await withOperationTimeout(run(routeContext), failure.operation, RISK_REGISTER_ROUTE_TIMEOUT_MS);
      if (!result.ok) return routeError(res, result, failure.code);
      return res.json(result);
    } catch (error) {
      console.info("[risk-register]", {
        phase: failure.operation,
        companyId: String(req.params?.companyFolderId || "").trim(),
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ ok: false, code: failure.code, error: failure.message, message: failure.message });
    }
  };

  const listHandler = ({ authed, actor, resolved }) =>
    listCompanyRiskRegister(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
      includeArchived: reqIncludeArchived(req),
    });

  function reqIncludeArchived(req) {
    return req.query.includeArchived === "true";
  }

  // Register literal /risk-register/verification/* paths before /risks/:riskId.
  app.post("/api/companies/:companyFolderId/risk-register/verification", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createVerificationRiskRegisterItem(authed, { ...registryDeps, ...scheduleDeps }, actor, resolved.companyFolderId, {
          ...(req.body || {}),
          masterSheetId: resolved.masterSheetId,
        }),
      { operation: "risk_register_verification_create", code: "RISK_REGISTER_VERIFICATION_CREATE_FAILED", message: "Could not create verification risk." },
    ),
  );

  app.patch("/api/companies/:companyFolderId/risk-register/verification/:riskId", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        patchVerificationRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          actor,
          resolved.companyFolderId,
          String(req.params?.riskId || "").trim(),
          { ...(req.body || {}), masterSheetId: resolved.masterSheetId },
        ),
      { operation: "risk_register_verification_patch", code: "RISK_REGISTER_VERIFICATION_PATCH_FAILED", message: "Could not update verification risk." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/verification/controls", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        upsertVerificationRiskRegisterControl(authed, { ...registryDeps, ...scheduleDeps }, actor, resolved.companyFolderId, {
          ...(req.body || {}),
          masterSheetId: resolved.masterSheetId,
        }),
      { operation: "risk_register_verification_control", code: "RISK_REGISTER_VERIFICATION_CONTROL_FAILED", message: "Could not upsert verification control." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/verification/:riskId/submit", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        submitVerificationRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          actor,
          resolved.companyFolderId,
          String(req.params?.riskId || "").trim(),
          { ...(req.body || {}), masterSheetId: resolved.masterSheetId },
        ),
      { operation: "risk_register_verification_submit", code: "RISK_REGISTER_VERIFICATION_SUBMIT_FAILED", message: "Could not submit verification risk." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/verification/:riskId/approve", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        approveVerificationRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          actor,
          resolved.companyFolderId,
          String(req.params?.riskId || "").trim(),
          { ...(req.body || {}), masterSheetId: resolved.masterSheetId },
        ),
      { operation: "risk_register_verification_approve", code: "RISK_REGISTER_VERIFICATION_APPROVE_FAILED", message: "Could not approve verification risk." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/verification/:riskId/review", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        reviewVerificationRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          actor,
          resolved.companyFolderId,
          String(req.params?.riskId || "").trim(),
          { ...(req.body || {}), masterSheetId: resolved.masterSheetId },
        ),
      { operation: "risk_register_verification_review", code: "RISK_REGISTER_VERIFICATION_REVIEW_FAILED", message: "Could not review verification risk." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/verification-cleanup", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        cleanupStaleVerificationRiskRegister(authed, { ...registryDeps, ...scheduleDeps }, actor, resolved.companyFolderId, {
          ...(req.body || {}),
          masterSheetId: resolved.masterSheetId,
        }),
      { operation: "risk_register_verification_cleanup_stale", code: "RISK_REGISTER_VERIFICATION_CLEANUP_FAILED", message: "Could not clean up stale verification risks." },
    ),
  );

  app.get("/api/companies/:companyFolderId/risks", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCompanyRiskRegister(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          includeArchived: req.query.includeArchived === "true",
        }),
      { operation: "risk_register_list", code: "RISK_REGISTER_LIST_FAILED", message: "Could not load Risk Register." },
    ),
  );

  app.get("/api/companies/:companyFolderId/risk-register", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCompanyRiskRegister(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          includeArchived: req.query.includeArchived === "true",
        }),
      { operation: "risk_register_list_alias", code: "RISK_REGISTER_LIST_FAILED", message: "Could not load Risk Register." },
    ),
  );

  app.get("/api/companies/:companyFolderId/risks/:riskId", async (req, res) =>
    runRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getCompanyRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.riskId || "").trim(),
          { includeArchived: req.query.includeArchived === "true" },
        ),
      { operation: "risk_register_get", code: "RISK_REGISTER_GET_FAILED", message: "Could not load Risk Register record." },
    ),
  );

  app.post("/api/companies/:companyFolderId/risk-register/:riskId/verification-cleanup", async (req, res) =>
    runRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        cleanupVerificationRiskRegisterItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          actor,
          resolved.companyFolderId,
          String(req.params?.riskId || "").trim(),
          { ...(req.body || {}), masterSheetId: resolved.masterSheetId },
        ),
      { operation: "risk_register_verification_cleanup", code: "RISK_REGISTER_VERIFICATION_CLEANUP_FAILED", message: "Could not clean up verification risk." },
    ),
  );
}
