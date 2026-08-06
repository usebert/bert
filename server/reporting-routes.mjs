/**
 * Company compliance report API routes.
 */
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  canManageCompanyReports,
  canViewCompanyReports,
  cleanupStaleVerificationReports,
  cleanupVerificationReport,
  downloadVerificationReport,
  generateVerificationReport,
  getVerificationReport,
  getVerificationReportBaseline,
  listCompanyReports,
  listSupportedReportTypes,
  REPORTS_BASELINE_TIMEOUT_MS,
  REPORTS_GENERATION_TIMEOUT_MS,
  REPORTS_ROUTE_TIMEOUT_MS,
} from "./reports-service.mjs";

export function installReportingRoutes(app, deps) {
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
    sessionDir,
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
    sessionDir,
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
    if (options.manage && !canManageCompanyReports(actor)) {
      res.status(403).json({ ok: false, error: "You do not have permission to manage reports." });
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
      !canViewCompanyReports(actor, resolved.companyFolderId, [
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
    });

  app.get("/api/companies/:companyFolderId/reports", async (req, res) => {
    const context = await resolveRouteContext(req, res);
    if (!context) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        listCompanyReports(context.authed, { ...registryDeps, ...scheduleDeps }, context.resolved, context.actor),
        "reports_list",
        REPORTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORTS_LIST_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORTS_LIST_FAILED",
        error: "Could not list reports.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyFolderId/reports/supported-types", async (req, res) => {
    const context = await resolveRouteContext(req, res);
    if (!context) {
      return undefined;
    }
    return res.json({ ok: true, ...listSupportedReportTypes() });
  });

  app.get("/api/companies/:companyFolderId/reports/verification-baseline", async (req, res) => {
    const context = await resolveRouteContext(req, res);
    if (!context) {
      return undefined;
    }
    try {
      const includeDriveCount =
        String(req.query?.includeDriveCount || "").trim() === "1" ||
        String(req.query?.includeDriveCount || "").trim().toLowerCase() === "true";
      const result = await withOperationTimeout(
        getVerificationReportBaseline(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          { includeDriveCount },
        ),
        "reports_verification_baseline",
        REPORTS_BASELINE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORTS_BASELINE_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORTS_BASELINE_FAILED",
        error: "Could not load verification report baseline.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/reports/generate", async (req, res) => {
    const context = await resolveRouteContext(req, res, { manage: true });
    if (!context) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        generateVerificationReport(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          context.actor,
          req.body || {},
        ),
        "reports_generate",
        REPORTS_GENERATION_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORT_GENERATE_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORT_GENERATE_FAILED",
        error: "Could not generate report.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyFolderId/reports/:reportId", async (req, res) => {
    const context = await resolveRouteContext(req, res);
    if (!context) {
      return undefined;
    }
    const reportId = String(req.params?.reportId || "").trim();
    try {
      const result = await withOperationTimeout(
        getVerificationReport(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          context.actor,
          reportId,
        ),
        "reports_get",
        REPORTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORT_GET_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORT_GET_FAILED",
        error: "Could not load report metadata.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyFolderId/reports/:reportId/download", async (req, res) => {
    const context = await resolveRouteContext(req, res);
    if (!context) {
      return undefined;
    }
    const reportId = String(req.params?.reportId || "").trim();
    try {
      const result = await withOperationTimeout(
        downloadVerificationReport(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          context.actor,
          reportId,
        ),
        "reports_download",
        REPORTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORT_DOWNLOAD_FAILED");
      }
      res.setHeader("Content-Type", result.mimeType || "application/pdf");
      res.setHeader("Content-Length", String(result.fileSize || result.buffer.length));
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName || "report.pdf"}"`);
      return res.status(200).send(result.buffer);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORT_DOWNLOAD_FAILED",
        error: "Could not download report.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/reports/verification-cleanup", async (req, res) => {
    const context = await resolveRouteContext(req, res, { manage: true });
    if (!context) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        cleanupStaleVerificationReports(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          context.actor,
          req.body || {},
        ),
        "reports_verification_cleanup",
        REPORTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORT_CLEANUP_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORT_CLEANUP_FAILED",
        error: "Could not clean stale verification reports.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/reports/:reportId/verification-cleanup", async (req, res) => {
    const context = await resolveRouteContext(req, res, { manage: true });
    if (!context) {
      return undefined;
    }
    const reportId = String(req.params?.reportId || "").trim();
    try {
      const result = await withOperationTimeout(
        cleanupVerificationReport(
          context.authed,
          { ...registryDeps, ...scheduleDeps },
          context.resolved,
          context.actor,
          reportId,
          req.body || {},
        ),
        "report_verification_cleanup",
        REPORTS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return routeError(res, result, "REPORT_CLEANUP_FAILED");
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORT_CLEANUP_FAILED",
        error: "Could not clean verification report.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
