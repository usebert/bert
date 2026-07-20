/**
 * Automated company creation routes — Master/Godmode only.
 * Streams NDJSON progress events, then a final complete/error line.
 */
import {
  COMPANY_PROVISION_STAGES,
  COMPANY_TYPES,
  getCompanyProvisionOperation,
  provisionCompanyWorkspace,
  validateCompanyProvisionInput,
} from "./company-provisioning-service.mjs";

export function installCompanyProvisioningRoutes(app, deps = {}) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    google,
    resolveLiveCompaniesFolder,
    getCompanyUsersDeps,
    getCompanyWorkspaceRegistryDeps,
    authIndex,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower,
    getConfig,
    updateConfig,
    ensureTabsAndColumns,
    currentSchemaVersion,
  } = deps;

  app.get("/api/godmode/companies/provision/meta", requireGoogleWorkspaceSession, requireMasterOnlyActor, (_req, res) => {
    return res.json({
      ok: true,
      stages: COMPANY_PROVISION_STAGES,
      companyTypes: COMPANY_TYPES,
    });
  });

  app.get(
    "/api/godmode/companies/provision/:operationId",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    (req, res) => {
      const operation = getCompanyProvisionOperation(req.params.operationId);
      if (!operation) {
        return res.status(404).json({ ok: false, error: "Provisioning operation not found." });
      }
      return res.json({
        ok: true,
        operation: {
          operationId: operation.operationId,
          companyName: operation.companyName,
          companyFolderId: operation.companyFolderId || "",
          masterSheetId: operation.masterSheetId || "",
          completedStages: operation.completedStages || [],
          status: operation.status || "in_progress",
          failedStage: operation.failedStage || "",
          lastError: operation.lastError || "",
          adminUsername: operation.adminUsername || "",
          adminEmail: operation.adminEmail || "",
        },
      });
    },
  );

  app.post(
    "/api/godmode/companies/create",
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
          error: "Connect Google Workspace before creating a company.",
        });
      }

      const validated = validateCompanyProvisionInput(req.body || {});
      if (!validated.ok) {
        return res.status(400).json({
          ok: false,
          code: "PROVISION_VALIDATION",
          errors: validated.errors,
          error: validated.errors[0] || "Invalid company details.",
        });
      }

      // Never log passwords — only non-secret fields.
      console.info("[company-provisioning] start", {
        companyNameLen: validated.value.companyName.length,
        adminEmailDomain: validated.value.adminEmail.split("@")[1] || "",
        operationId: validated.value.operationId || "(new)",
        hasLogo: Boolean(validated.value.logoDataUrl),
      });

      const wantsStream = String(req.query.stream || req.headers.accept || "").includes("ndjson")
        || String(req.body?.stream || "") === "1"
        || String(req.query.stream || "") === "1";

      if (wantsStream) {
        res.status(200);
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }
      }

      const writeEvent = async (event) => {
        if (!wantsStream) {
          return;
        }
        res.write(`${JSON.stringify(event)}\n`);
      };

      const serviceDeps = {
        google,
        resolveLiveCompaniesFolder,
        getCompanyUsersDeps,
        getCompanyWorkspaceRegistryDeps,
        authIndex,
        ensureTabExists,
        ensureColumns,
        getWorkbook,
        getTabValues,
        withSheetsQuotaRetry,
        safeLower,
        getConfig,
        updateConfig,
        ensureTabsAndColumns,
        currentSchemaVersion,
        ensureTabColumns: deps.ensureTabColumns,
        readTabRecords: deps.readTabRecords,
        appendTabRows: deps.appendTabRows,
        writeTabRecords: deps.writeTabRecords,
      };

      const result = await provisionCompanyWorkspace(authed, serviceDeps, req.body || {}, writeEvent);

      if (wantsStream) {
        if (!result.ok) {
          res.write(
            `${JSON.stringify({
              type: "error",
              operationId: result.operationId,
              stage: result.failedStage,
              error: result.error,
              completedStages: result.completedStages,
            })}\n`,
          );
        }
        return res.end();
      }

      if (!result.ok) {
        return res.status(result.httpStatus || 500).json(result);
      }
      return res.json(result);
    },
  );
}
