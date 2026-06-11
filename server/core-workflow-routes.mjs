/**
 * Core BERT workflow routes — company invites, assignees, invite token lookup.
 */
import {
  canCreateCompanyInvite,
  isCompanyInviteActor,
  isGodmodeInviteSession,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
} from "../shared/company-invite-permissions.mjs";
import {
  buildAuditorInviteBody,
  resolveCompanyUserInviteAccess,
} from "./invite-service.mjs";
import { resolveCompanyInviteReadiness } from "./company-invite-readiness.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { listActiveCompanyMembers } from "./company-user-service.mjs";
import { getScheduleAssigneesForCompany } from "./schedule-assignee-service.mjs";
import {
  canListCompanySchedules,
  getCompanySchedule,
  listCompanySchedules,
  resolveCompanyScheduleContext,
  saveCompanySchedules,
} from "./schedule-service.mjs";
import { getReportsDashboard } from "./reports-dashboard-service.mjs";
import { BACKGROUND_SCHEDULE_SAVED_MESSAGE } from "../shared/background-jobs.mjs";

function buildInvitePermissionSession(actor) {
  if (!actor) {
    return {};
  }
  return {
    kind: actor.kind,
    role: actor.role,
    accessLevel: actor.accessLevel,
    companyId: actor.companyId || actor.companyFolderId,
    companyFolderId: actor.companyFolderId || actor.companyId,
  };
}

export function installCoreWorkflowRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceEnv,
    requireGoogleWorkspaceSession,
    parseBertActorFromRequest,
    processCompanyUserInvite,
    getInviteRecord,
    handleGetInviteToken,
    handleAppInviteComplete,
    readCompanySheetById,
    getCompanyUsersDeps,
    registryDeps,
    writeLegacyCompanySchedules,
    getTabValues,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
    backgroundJobs,
  } = deps;

  const scheduleDeps = {
    readCompanySheetById,
    ...getCompanyUsersDeps(),
    writeLegacyCompanySchedules,
    getTabValues,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
  };

  app.get("/api/companies/:companyId/invite-readiness", async (req, res) => {
    const companyId = String(req.params?.companyId || "").trim();
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "Company ID is required." });
    }

    const actor = parseBertActorFromRequest(req);
    if (!actor) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN_ROLE",
        error: INVITE_ROLE_FORBIDDEN_MESSAGE,
      });
    }

    const permissionSession = buildInvitePermissionSession(actor);
    const isGodmode = isGodmodeInviteSession(permissionSession);
    const isCompanyActor = isCompanyInviteActor(permissionSession);
    if (!isGodmode && !isCompanyActor) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN_ROLE",
        error: INVITE_ROLE_FORBIDDEN_MESSAGE,
      });
    }

    const authed = getAuthedClient();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || actor.masterSheetId || "").trim();
    const context = {
      companyId,
      companyFolderId: String(req.query.companyFolderId || actor.companyFolderId || actor.companyId || companyId).trim(),
      masterSheetId,
      registryStatus: String(req.query.registryStatus || "").trim(),
      workspaceSetupComplete:
        req.query.workspaceSetupComplete === "true"
          ? true
          : req.query.workspaceSetupComplete === "false"
            ? false
            : undefined,
      godmodeUsersTabWritable: req.query.godmodeUsersTabWritable === "true" ? true : undefined,
    };

    try {
      const readiness = await resolveCompanyInviteReadiness(authed, registryDeps, companyId, context);
      return res.json({
        ok: readiness.ok !== false,
        canInvite: readiness.canInvite,
        companyStatus: readiness.companyStatus,
        source: readiness.source,
        userMessage: readiness.userMessage,
        reasonCode: readiness.reasonCode,
        nextAction: readiness.nextAction,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to evaluate invite readiness.",
      });
    }
  });

  app.post(
    "/api/companies/:companyId/invites/auditor",
    requireGoogleWorkspaceEnv,
    async (req, res) => {
      const companyId = String(req.params?.companyId || "").trim();
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "Company ID is required." });
      }

      const actor = parseBertActorFromRequest(req);
      const permissionSession = buildInvitePermissionSession(actor);
      const isGodmode = isGodmodeInviteSession(permissionSession);
      const isCompanyActor = isCompanyInviteActor(permissionSession);

      if (!actor || (!isGodmode && !isCompanyActor)) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_ROLE",
          error: INVITE_ROLE_FORBIDDEN_MESSAGE,
          blocker: "forbidden",
        });
      }

      const inviteRole = String(req.body?.role || "Auditor").trim() || "Auditor";
      if (!canCreateCompanyInvite(permissionSession, companyId, inviteRole)) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_INVITE_ROLE",
          error: INVITE_ROLE_FORBIDDEN_MESSAGE,
          blocker: "forbidden",
        });
      }

      const authed = getAuthedClient();
      if (!isGodmode && !authed) {
        return res.status(503).json({
          ok: false,
          code: "google_not_connected",
          error: "Invite could not be sent right now. Ask BERT Admin to check platform email/Google setup.",
          blocker: "google_not_connected",
        });
      }

      if (authed) {
        const record = await resolveCompanyById(authed, registryDeps, companyId).catch(() => null);
        req.body = buildAuditorInviteBody(companyId, req.body, record);
      } else {
        req.body = buildAuditorInviteBody(companyId, req.body);
      }

      if (typeof processCompanyUserInvite !== "function") {
        return res.status(501).json({ ok: false, error: "Company user invite handler is not configured." });
      }
      return processCompanyUserInvite(req, res);
    },
  );

  app.get("/api/invites/company-user/:token", (req, res) => {
    req.params = { ...req.params, token: req.params.token };
    req.query = { ...req.query, expectedType: "COMPANY_USER" };
    if (typeof handleGetInviteToken === "function") {
      return handleGetInviteToken(req, res);
    }
    const tokenId = String(req.params.token || "").trim();
    const record = typeof getInviteRecord === "function" ? getInviteRecord(tokenId) : null;
    const access = resolveCompanyUserInviteAccess(record, tokenId);
    if (!access.ok) {
      return res.status(access.httpStatus).json({
        ok: false,
        code: access.code,
        error: access.error,
      });
    }
    const inviteRecord = access.record;
    return res.json({
      ok: true,
      type: "COMPANY_USER",
      email: inviteRecord.email,
      role: inviteRecord.role,
      invitedBy: inviteRecord.invitedBy || "",
      companyName: inviteRecord.companyName || "",
      setupIncomplete: Boolean(access.setupIncomplete),
      canRetrySetup: access.canRetrySetup !== false,
    });
  });

  app.post("/api/invites/company-user/:token/complete", (req, res) => {
    req.params = { ...req.params, tokenId: req.params.token };
    if (typeof handleAppInviteComplete === "function") {
      return handleAppInviteComplete(req, res);
    }
    return res.status(501).json({ ok: false, error: "Invite completion handler is not configured." });
  });

  app.get("/api/companies/:companyId/schedules", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading schedules.",
        message: "Could not load schedules for this company.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const scheduleId = String(req.query.scheduleId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;

    try {
      const contextInput = {
        companyId,
        companyFolderId: String(req.query.companyFolderId || companyId).trim(),
        masterSheetId,
        companyName: String(req.query.companyName || "").trim(),
      };

      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        contextInput,
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
          technicalError: resolved.technicalError,
        });
      }

      if (
        !canListCompanySchedules(actor, resolved.companyFolderId, [
          companyId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "SCHEDULE_LIST_FORBIDDEN",
          error: "You do not have permission to view schedules for this company.",
          message: "You do not have permission to view schedules for this company.",
        });
      }

      if (scheduleId) {
        const one = await getCompanySchedule(authed, { ...registryDeps, ...scheduleDeps }, {
          ...contextInput,
          scheduleId,
        });
        if (!one.ok) {
          return res.status(one.httpStatus || 404).json({
            ok: false,
            code: one.code,
            error: one.error,
            message: one.message || one.error,
            technicalError: one.technicalError,
          });
        }
        return res.json({
          ok: true,
          companyId: one.companyId,
          companyFolderId: one.companyFolderId,
          masterSheetId: one.masterSheetId,
          schedule: one.schedule,
        });
      }

      const listed = await listCompanySchedules(authed, { ...registryDeps, ...scheduleDeps }, contextInput);
      if (!listed.ok) {
        return res.status(listed.httpStatus || 400).json({
          ok: false,
          code: listed.code,
          error: listed.error,
          message: listed.message || listed.error,
          technicalError: listed.technicalError,
        });
      }

      return res.json({
        ok: true,
        companyId: listed.companyId,
        companyFolderId: listed.companyFolderId,
        companyName: listed.companyName,
        masterSheetId: listed.masterSheetId,
        schedules: listed.schedules,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "SCHEDULE_LIST_FAILED",
        error: "Could not load schedules for this company.",
        message: "Could not load schedules for this company.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyId/users", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading company users.",
        message: "Please connect Google before loading company users.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;

    try {
      const result = await listActiveCompanyMembers(authed, { ...registryDeps, ...getCompanyUsersDeps() }, {
        companyId,
        companyFolderId: String(req.query.companyFolderId || companyId).trim(),
        masterSheetId,
        companyName: String(req.query.companyName || "").trim(),
        sessionActor: actor
          ? {
              email: actor.email,
              name: actor.name,
              role: actor.role,
              accessLevel: actor.accessLevel,
              companyId: actor.companyId || actor.companyFolderId || companyId,
              companyFolderId: actor.companyFolderId || actor.companyId || companyId,
              companyAreas: actor.companyAreas,
              status: "active",
            }
          : null,
      });

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          message: result.message || result.error,
          diagnostics: result.diagnostics,
          technicalError: result.technicalError,
        });
      }

      return res.json({
        ok: true,
        users: result.users,
        diagnostics: result.diagnostics,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        activeCount: result.activeCount,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "USERS_TAB_READ_FAILED",
        message: "Could not load users from the company workbook.",
        diagnostics: {
          currentCompanyId: companyId,
          masterSheetId,
          activeUsersFound: 0,
          dataSource: "users_tab",
        },
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyId/schedule-assignees", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading schedule assignees.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const selectedArea = String(req.query.area || "").trim();
    const includeDiagnostics =
      String(req.query.diagnostics || "").trim() === "1" ||
      String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;

    try {
      const result = await getScheduleAssigneesForCompany(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId,
        companyFolderId: String(req.query.companyFolderId || companyId).trim(),
        masterSheetId,
        companyName: String(req.query.companyName || "").trim(),
        selectedArea,
        includeDiagnostics,
        sessionActor: actor
          ? {
              email: actor.email,
              name: actor.name,
              role: actor.role,
              accessLevel: actor.accessLevel,
              companyId: actor.companyId || actor.companyFolderId || companyId,
              companyFolderId: actor.companyFolderId || actor.companyId || companyId,
              status: "active",
            }
          : null,
        signedInEmail: actor?.email,
      });

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
          technicalError: result.technicalError,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        assignees: result.assignees,
        auditors: result.auditors,
        diagnostics: result.diagnostics,
        warning: result.warning,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load schedule assignees.",
      });
    }
  });

  app.get("/api/companies/:companyId/reports/dashboard", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading reports.",
        message: "Could not load reports right now. Try again.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const includeDiagnostics =
      String(req.query.diagnostics || "").trim() === "1" ||
      String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";

    try {
      const result = await getReportsDashboard(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId,
        companyFolderId: String(req.query.companyFolderId || companyId).trim(),
        masterSheetId,
        companyName: String(req.query.companyName || "").trim(),
        dateRange: String(req.query.dateRange || "30").trim(),
        site: String(req.query.site || "").trim(),
        area: String(req.query.area || "").trim(),
        assignee: String(req.query.assignee || "").trim(),
        status: String(req.query.status || "").trim(),
        includeDiagnostics,
        actor: actor
          ? {
              kind: actor.kind,
              email: actor.email,
              name: actor.name,
              role: actor.role,
              accessLevel: actor.accessLevel,
              companyId: actor.companyId || actor.companyFolderId || companyId,
              companyFolderId: actor.companyFolderId || actor.companyId || companyId,
              companyAreas: actor.companyAreas,
            }
          : null,
      });

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
          technicalError: result.technicalError,
          diagnostics: result.diagnostics,
        });
      }

      return res.json({
        ok: true,
        cached: result.cached === true,
        refreshing: result.refreshing === true,
        stale: result.stale === true,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        summary: result.summary,
        charts: result.charts,
        filters: result.filters,
        emptyState: result.emptyState,
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "REPORTS_LOAD_FAILED",
        error: "Could not load reports right now. Try again.",
        message: "Could not load reports right now. Try again.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyId/schedules", async (req, res) => {
    const authed = getAuthedClient();
    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
    const companyFolderId = String(req.body?.companyFolderId || companyId).trim();
    const schedules = Array.isArray(req.body?.schedules) ? req.body.schedules : [];
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const createdBy = String(actor?.email || req.body?.createdBy || "").trim();

    if (!companyFolderId) {
      return res.status(400).json({
        ok: false,
        code: "COMPANY_CONTEXT_MISSING",
        error: "Company folder ID is required before saving schedules.",
        message: "Company folder ID is required before saving schedules.",
      });
    }

    const saveInput = {
      companyId,
      companyFolderId,
      masterSheetId,
      schedules,
      createdBy,
      requestedBy: createdBy,
    };

    if (backgroundJobs?.queueScheduleSyncJob) {
      const job = backgroundJobs.queueScheduleSyncJob(saveInput);
      if (!envConfigured() || !authed) {
        return res.json({
          ok: true,
          savedLocally: true,
          backgroundSync: true,
          backgroundJobId: job?.jobId || "",
          userMessage: BACKGROUND_SCHEDULE_SAVED_MESSAGE,
          companyId: companyFolderId,
          masterSheetId,
        });
      }
      return res.json({
        ok: true,
        savedLocally: true,
        backgroundSync: true,
        backgroundJobId: job?.jobId || "",
        userMessage: BACKGROUND_SCHEDULE_SAVED_MESSAGE,
        companyId: companyFolderId,
        masterSheetId,
      });
    }

    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before saving schedules.",
      });
    }

    try {
      const result = await saveCompanySchedules(authed, { ...registryDeps, ...scheduleDeps }, saveInput);

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
          technicalError: result.technicalError,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyId,
        masterSheetId: result.masterSheetId,
        written: result.written,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "SCHEDULE_SAVE_FAILED",
        error: "BERT could not save this schedule. Try again.",
        message: "BERT could not save this schedule. Try again.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
