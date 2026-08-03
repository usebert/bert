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
import { listCompanyProfiles } from "./company-users-foundation.mjs";
import { syncAuthIndexAfterUsersRead } from "./auth-index.mjs";
import {
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";
import { readTabRecords, appendTabRows } from "./workbook-service.mjs";
import { installDocumentRoutes } from "./document-routes.mjs";
import { installHealthSafetyRoutes } from "./health-safety-routes.mjs";
import { installRiskAssessmentRoutes } from "./risk-assessments-routes.mjs";
import {
  canListCompanySchedules,
  getCompanySchedule,
  listCompanySchedules,
  listSchedulerAssignees,
  resolveCompanyScheduleContext,
  saveCompanySchedules,
} from "./schedule-service.mjs";
import { getReportsDashboard } from "./reports-dashboard-service.mjs";
import { getLiveDashboard } from "./live-dashboard-service.mjs";
import { BACKGROUND_SCHEDULE_SAVED_MESSAGE } from "../shared/background-jobs.mjs";
import { rejectIfCompanyFolderNotUnderCompaniesRoot } from "./company-folder-placement.mjs";
import {
  canListCompanyAuditResults,
  CHECK_COMPLETION_GOOGLE_TIMEOUT_MS,
  CHECK_COMPLETION_ROUTE_TIMEOUT_MS,
  DEFAULT_RESULTS_LIST_LIMIT,
  DEFAULT_RESULTS_LIST_SINCE_DAYS,
  getAuditResult,
  cleanupVerificationAuditResult,
  listAuditResults,
  submitCompletedCheck,
} from "./completion-service.mjs";
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import {
  handleCompanyGoogleFormsGet,
  handleCompanyGoogleFormsSyncPost,
  handleCreateBertCheckFromGoogleFormPost,
} from "./google-forms-service.mjs";
import { listAssignedChecks } from "./check-service.mjs";
import {
  canListCompanyIncidents,
  canSubmitCompanyIncident,
  cleanupStaleVerificationIncidents,
  cleanupVerificationIncident,
  closeCompanyIncident,
  getCompanyIncident,
  INCIDENTS_ROUTE_TIMEOUT_MS,
  listCompanyIncidents,
  patchCompanyIncident,
  reassignCompanyIncident,
  submitCompanyIncident,
} from "./incidents-service.mjs";
import { uploadIncidentEvidenceToDrive } from "./incident-evidence-upload.mjs";
import {
  actorCanAccessCompanyLoler,
  archiveLolerEquipment,
  canManageLoler,
  canViewLoler,
  createLolerEquipment,
  getLolerEquipment,
  listLolerEquipment,
  listLolerSchedules,
  LOLER_ROUTE_TIMEOUT_MS,
  markLolerEquipmentOutOfService,
  returnLolerEquipmentToService,
  updateLolerEquipment,
} from "./loler-service.mjs";
import {
  canRecordLolerExamination,
  getLolerExamination,
  listLolerExaminations,
  recordLolerExamination,
  updateLolerExamination,
} from "./loler-examination-service.mjs";
import {
  actorCanAccessCompanyMessages,
  archiveOperationalMessage,
  canSendMessages,
  canViewMessages,
  createOperationalMessage,
  listOperationalMessages,
  markOperationalMessageRead,
  MESSAGES_ROUTE_TIMEOUT_MS,
} from "./operational-messages-service.mjs";
import {
  actorCanAccessCompanyCalendar,
  archiveCalendarItem,
  CALENDAR_ROUTE_TIMEOUT_MS,
  canManageCalendar,
  canViewCalendar,
  completeCalendarItem,
  createCalendarItem,
  getCalendarItem,
  listCalendarItems,
  updateCalendarItem,
} from "./calendar-service.mjs";
import {
  actorCanAccessCompanyDocumentControl,
  archiveControlledDocument,
  approveDocumentRevision,
  canApproveDocumentControl,
  canManageDocumentControl,
  canViewDocumentControl,
  createControlledDocument,
  createDocumentRevision,
  DOCUMENT_CONTROL_ROUTE_TIMEOUT_MS,
  getDocumentControlDocument,
  getDocumentRevisionFile,
  listDocumentControlDocuments,
  listDocumentControlIndex,
  rebuildDocumentControlIndex,
  rejectDocumentRevision,
  restoreControlledDocument,
  submitDocumentRevision,
  updateControlledDocument,
} from "./document-control-service.mjs";
import {
  acknowledgeBriefing,
  assignVerificationBriefingRecipients,
  BRIEFINGS_ROUTE_TIMEOUT_MS,
  canAccessBriefings,
  canManageBriefings,
  canViewBriefingsTracker,
  cleanupStaleVerificationBriefings,
  cleanupVerificationBriefing,
  createAndSendBriefing,
  createDraftVerificationBriefing,
  listBriefingsTodoPreview,
  listBriefingsTracker,
  listMyBriefings,
  openBriefing,
  patchVerificationBriefing,
  publishVerificationBriefing,
  readBriefing,
  replyToBriefing,
  signBriefing,
} from "./briefings-service.mjs";
import {
  cleanupStaleVerificationActions,
  cleanupVerificationAction,
  loadCompanyActions,
  saveCompanyActions,
} from "./actions-service.mjs";
import { saveCompanyNcrs } from "./ncr-service.mjs";
import {
  archiveCompanyRecord,
  listCompanyArchive,
  restoreCompanyRecord,
} from "./archive-service.mjs";

function briefingRouteError(res, result, fallbackStatus = 400) {
  const status = result?.httpStatus || fallbackStatus;
  return res.status(status).json({
    ok: false,
    code: result?.code,
    error: result?.error || result?.message || "Request failed.",
    details: result?.details || undefined,
    message: result?.message || result?.error || "Request failed.",
  });
}

async function rejectCompanyApiIfFolderInvalid(authed, deps, companyFolderId, companyName = "") {
  if (!authed || !companyFolderId) {
    return null;
  }
  return rejectIfCompanyFolderNotUnderCompaniesRoot(authed, deps, companyFolderId, {
    companyFolderName: companyName,
  });
}

function parseOptionalPositiveInt(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) {
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

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

function logCompanyUsersRouteTimings(stage, stageStartMs, meta = {}) {
  try {
    console.info("company_users_timings", {
      stage,
      durationMs: Date.now() - stageStartMs,
      ...meta,
    });
  } catch {
    /* timing log must never affect request */
  }
}

function logScheduleAssigneesRouteTimings(stage, stageStartMs, meta = {}) {
  try {
    console.info("schedule_assignees_timings", {
      stage,
      durationMs: Date.now() - stageStartMs,
      ...meta,
    });
  } catch {
    /* timing log must never affect request */
  }
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
    getTabValues,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
    backgroundJobs,
    sessionDir,
    rowsToRecords,
    writeCompanyActions,
  } = deps;

  if (typeof readTabRecords !== "function" || typeof appendTabRows !== "function") {
    throw new Error(
      "CORE_WORKFLOW_WORKBOOK_HELPERS_MISSING: import readTabRecords and appendTabRows from workbook-service.mjs before installing routes.",
    );
  }

  const scheduleDeps = {
    readCompanySheetById,
    ...getCompanyUsersDeps(),
    readTabRecords,
    appendTabRows,
    getTabValues,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    withSheetsQuotaRetry,
    google,
    rowsToRecords,
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
    const companyFolderId = String(
      req.query.companyFolderId || actor.companyFolderId || actor.companyId || companyId,
    ).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      registryDeps,
      companyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    const context = {
      companyId,
      companyFolderId,
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
    const companyFolderId = String(
      req.query.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
    ).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...getCompanyUsersDeps() },
      companyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

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
    const routeStart = Date.now();
    const authed = getAuthedClient();
    const companyId = sanitizeCompanyFolderId(String(req.params?.companyId || "").trim());
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId =
      sanitizeCompanyFolderId(
        req.query.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
      ) || companyId;
    const masterSheetId = sanitizeGoogleSpreadsheetId(
      req.query.masterSheetId || req.query.sheetId || actor?.masterSheetId || "",
    );
    const companyName = String(req.query.companyName || actor?.companyName || "").trim();
    const sessionActor = actor
      ? {
          email: actor.email,
          name: actor.name,
          role: actor.role,
          accessLevel: actor.accessLevel,
          companyId: actor.companyId || actor.companyFolderId || companyFolderId,
          companyFolderId: actor.companyFolderId || actor.companyId || companyFolderId,
          companyAreas: actor.companyAreas,
          status: "active",
        }
      : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;

    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        code: "COMPANY_USERS_LOAD_FAILED",
        message: "Please connect Google before loading company users.",
        reasonCode: "GOOGLE_AUTH_FAILED",
        failedStep: "connect_google",
        diagnostics: {
          companyId: companyFolderId || companyId || undefined,
          companyFolderId: companyFolderId || companyId || undefined,
          masterSheetId: masterSheetId || undefined,
          signedInEmail: String(actor?.email || "").trim() || undefined,
          signedInRole: String(actor?.role || actor?.accessLevel || "").trim() || undefined,
          dataSource: "users_tab",
          failedStep: "connect_google",
        },
      });
    }

    try {
      const listProfilesStart = Date.now();
      const result = await listCompanyProfiles(authed, { ...registryDeps, ...getCompanyUsersDeps(), getConfig: deps.getConfig }, {
        companyId: companyFolderId,
        companyFolderId,
        masterSheetId: trustSessionContext ? sessionMasterSheetId : "",
        trustSessionContext,
        companyName,
        sessionActor,
      });
      logCompanyUsersRouteTimings("list_company_profiles", listProfilesStart, {
        companyFolderId,
        masterSheetId: String(result?.masterSheetId || masterSheetId).trim() || undefined,
        ok: result?.ok === true,
        userCount: Array.isArray(result?.users) ? result.users.length : 0,
      });

      if (!result.ok) {
        logCompanyUsersRouteTimings("route_total", routeStart, {
          companyFolderId,
          ok: false,
          code: result.code,
        });
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code || "COMPANY_USERS_LOAD_FAILED",
          message: result.message || "Could not load company users.",
          reasonCode: result.reasonCode,
          failedStep: result.failedStep || result.diagnostics?.failedStep,
          diagnostics: result.diagnostics,
          technicalError: result.technicalError,
        });
      }

      const authIndexSyncStart = Date.now();
      await syncAuthIndexAfterUsersRead(authed, { ...registryDeps, ...getCompanyUsersDeps(), authIndex: deps.authIndex, getCompanyUsersDeps }, {
        companyId: result.companyFolderId || companyFolderId,
        companyFolderId: result.companyFolderId || companyFolderId,
        masterSheetId: result.masterSheetId || masterSheetId,
        companyName: result.companyName || companyName,
      }).catch(() => null);
      logCompanyUsersRouteTimings("auth_index_sync", authIndexSyncStart, {
        companyFolderId: result.companyFolderId || companyFolderId,
        masterSheetId: result.masterSheetId || masterSheetId,
      });

      logCompanyUsersRouteTimings("route_total", routeStart, {
        companyFolderId: result.companyFolderId || companyFolderId,
        masterSheetId: result.masterSheetId || masterSheetId,
        ok: true,
        userCount: Array.isArray(result.users) ? result.users.length : 0,
      });

      return res.json({
        ok: true,
        users: result.users,
        warning: result.warning,
        reasonCode: result.reasonCode,
        failedStep: result.failedStep || result.diagnostics?.failedStep,
        diagnostics: result.diagnostics,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        activeCount: result.activeCount,
      });
    } catch (error) {
      const upstreamMessage = error instanceof Error ? error.message : String(error);
      logCompanyUsersRouteTimings("route_total", routeStart, {
        companyFolderId,
        ok: false,
        error: upstreamMessage,
      });
      return res.status(500).json({
        ok: false,
        code: "COMPANY_USERS_LOAD_FAILED",
        message: "Could not load company users.",
        reasonCode: "USERS_TAB_READ_FAILED",
        failedStep: "google_sheets_read",
        diagnostics: {
          companyId: companyFolderId || companyId || undefined,
          companyFolderId: companyFolderId || companyId || undefined,
          masterSheetId: masterSheetId || undefined,
          signedInEmail: String(actor?.email || "").trim() || undefined,
          signedInRole: String(actor?.role || actor?.accessLevel || "").trim() || undefined,
          dataSource: "users_tab",
          failedStep: "google_sheets_read",
          upstreamMessage,
        },
        technicalError: upstreamMessage,
      });
    }
  });

  app.get("/api/companies/:companyId/schedule-assignees", async (req, res) => {
    const routeStart = Date.now();
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading schedule assignees.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const queryMasterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const selectedArea = String(req.query.area || "").trim();
    const includeDiagnostics =
      String(req.query.diagnostics || "").trim() === "1" ||
      String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId = String(req.query.companyFolderId || actor?.companyFolderId || companyId).trim();
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;
    const masterSheetId = trustSessionContext ? sessionMasterSheetId : queryMasterSheetId;

    try {
      const assigneesStart = Date.now();
      const result = await listSchedulerAssignees(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId,
        companyFolderId,
        masterSheetId: trustSessionContext ? sessionMasterSheetId : "",
        trustSessionContext,
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
      logScheduleAssigneesRouteTimings("list_scheduler_assignees", assigneesStart, {
        companyFolderId,
        masterSheetId: masterSheetId || undefined,
        ok: result?.ok === true,
        assigneeCount: Array.isArray(result?.assignees) ? result.assignees.length : 0,
      });

      if (!result.ok) {
        logScheduleAssigneesRouteTimings("route_total", routeStart, {
          companyFolderId,
          ok: false,
          code: result.code,
        });
        console.warn(
          "[schedule-assignees]",
          JSON.stringify({
            companyId: companyFolderId || companyId || undefined,
            masterSheetId: masterSheetId || undefined,
            code: result.code,
            reasonCode: result.reasonCode,
            failedStep: result.failedStep || result.diagnostics?.failedStep,
            message: result.message || result.error,
          }),
        );
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
          technicalError: result.technicalError,
        });
      }

      logScheduleAssigneesRouteTimings("route_total", routeStart, {
        companyFolderId,
        masterSheetId: result.masterSheetId || masterSheetId || undefined,
        ok: true,
        assigneeCount: Array.isArray(result.assignees) ? result.assignees.length : 0,
      });

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
      const safeMessage = error instanceof Error ? error.message : "Unable to load schedule assignees.";
      logScheduleAssigneesRouteTimings("route_total", routeStart, {
        companyFolderId,
        ok: false,
        error: safeMessage,
      });
      console.warn(
        "[schedule-assignees]",
        JSON.stringify({
          companyId: companyFolderId || companyId || undefined,
          masterSheetId: masterSheetId || undefined,
          code: "USERS_TAB_READ_FAILED",
          message: safeMessage,
        }),
      );
      return res.status(500).json({
        ok: false,
        code: "USERS_TAB_READ_FAILED",
        error: safeMessage,
        message: safeMessage,
      });
    }
  });

  app.get("/api/me/assigned-checks", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading your checks.",
        message: "Could not load your assigned checks.",
      });
    }

    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const signedInEmail = String(actor?.email || "").trim().toLowerCase();
    if (!signedInEmail) {
      return res.status(401).json({
        ok: false,
        code: "SESSION_REQUIRED",
        error: "Sign in is required before loading assigned checks.",
        message: "Could not load your assigned checks.",
      });
    }

    const queryEmail = String(req.query.email || req.query.userEmail || "").trim().toLowerCase();
    if (queryEmail && queryEmail !== signedInEmail) {
      return res.status(403).json({
        ok: false,
        code: "ASSIGNED_CHECKS_IDENTITY_MISMATCH",
        error: "Assigned checks are scoped to your signed-in account.",
        message: "Could not load assigned checks for a different user.",
      });
    }

    const companyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const masterSheetId = String(actor?.masterSheetId || "").trim();
    if (!companyFolderId) {
      return res.status(401).json({
        ok: false,
        code: "SESSION_COMPANY_REQUIRED",
        error: "Your signed-in session must include a company workspace before loading assigned checks.",
        message: "Could not load your assigned checks.",
      });
    }

    const trustSessionContext = actor?.kind === "company" && Boolean(companyFolderId && masterSheetId);
    if (!trustSessionContext) {
      const folderDenial = await rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        companyFolderId,
        String(actor?.companyName || "").trim(),
      );
      if (folderDenial) {
        return res.status(403).json(folderDenial);
      }
    }

    const includeDiagnostics =
      String(req.query.diagnostics || "").trim() === "1" ||
      String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";
    const limitRaw = String(req.query.limit || "").trim();
    const limit = limitRaw ? Number(limitRaw) : undefined;

    try {
      const result = await listAssignedChecks(authed, { ...registryDeps, ...scheduleDeps }, {
        email: signedInEmail,
        companyFolderId,
        companyId: companyFolderId,
        companyName: String(actor?.companyName || "").trim(),
        masterSheetId,
        trustSessionContext,
        includeDiagnostics,
        limit,
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
        companyFolderId: result.companyFolderId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        schedules: result.schedules,
        ...(includeDiagnostics && result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "ASSIGNED_CHECKS_LOAD_FAILED",
        error: "Could not load your assigned checks.",
        message: "Could not load your assigned checks.",
        technicalError: error instanceof Error ? error.message : String(error),
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
    const companyFolderId = String(req.query.companyFolderId || actor?.companyFolderId || companyId).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await getReportsDashboard(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId,
        companyFolderId,
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

  app.get("/api/companies/:companyFolderId/dashboard/live", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading the live dashboard.",
        message: "Could not load the live dashboard right now. Try again.",
      });
    }

    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || actor?.masterSheetId || "").trim();
    const includeDiagnostics =
      String(req.query.diagnostics || "").trim() === "1" ||
      String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await getLiveDashboard(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId: companyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId,
        companyName: String(req.query.companyName || actor?.companyName || "").trim(),
        includeDiagnostics,
        forceRefresh: String(req.query.refresh || "").trim() === "1",
        syncQueue: {
          queued: parseOptionalPositiveInt(req.query.syncQueued, 0),
          failed: parseOptionalPositiveInt(req.query.syncFailed, 0),
          lastStatus: String(req.query.syncStatus || "").trim(),
          lastSyncAt: String(req.query.lastSyncAt || "").trim(),
        },
        actor,
      });

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
          details: includeDiagnostics ? result.technicalError : undefined,
        });
      }

      return res.json({
        ok: true,
        cached: result.cached === true,
        stale: result.stale === true,
        generatedAt: result.generatedAt,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        companyName: result.companyName,
        masterSheetId: result.masterSheetId,
        metrics: result.metrics,
        today: result.today,
        actToday: result.actToday,
        compliance: result.compliance,
        riskByArea: result.riskByArea,
        riskEmptyMessage: result.riskEmptyMessage,
        sections: result.sections,
        charts: result.charts,
        sync: result.sync,
        warnings: result.warnings,
        emptyState: result.emptyState,
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      void error;
      return res.status(500).json({
        ok: false,
        code: "LIVE_DASHBOARD_LOAD_FAILED",
        error: "Could not load the live dashboard right now. Try again.",
        message: "Could not load the live dashboard right now. Try again.",
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

    if (authed) {
      const folderDenial = await rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        companyFolderId,
        String(req.body?.companyName || actor?.companyName || "").trim(),
      );
      if (folderDenial) {
        return res.status(403).json(folderDenial);
      }
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

  app.get("/api/companies/:companyFolderId/actions", async (req, res) => {
    const authed = getAuthedClient();
    const companyFolderId = String(req.params?.companyFolderId || req.query?.companyFolderId || "").trim();
    const masterSheetId = String(req.query?.masterSheetId || req.query?.sheetId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;

    if (!companyFolderId) {
      return res.status(400).json({
        ok: false,
        code: "COMPANY_CONTEXT_MISSING",
        error: "Company folder ID is required before loading actions.",
        message: "Company folder ID is required before loading actions.",
      });
    }

    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading actions.",
        message: "Please connect Google before loading actions.",
      });
    }

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      String(req.query?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await loadCompanyActions(
        authed,
        { ...registryDeps, ...scheduleDeps, readTabRecords },
        {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: trustSessionContext ? sessionMasterSheetId : masterSheetId,
          trustSessionContext,
        },
      );

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyFolderId,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        actions: result.actions,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "ACTIONS_LOAD_FAILED",
        error: "Could not load actions for this company workspace.",
        message: "Could not load actions for this company workspace.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/actions", async (req, res) => {
    const authed = getAuthedClient();
    const companyFolderId = String(req.params?.companyFolderId || req.body?.companyFolderId || "").trim();
    const masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;

    if (!companyFolderId) {
      return res.status(400).json({
        ok: false,
        code: "COMPANY_CONTEXT_MISSING",
        error: "Company folder ID is required before saving actions.",
        message: "Company folder ID is required before saving actions.",
      });
    }

    if (authed) {
      const folderDenial = await rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        companyFolderId,
        String(req.body?.companyName || actor?.companyName || "").trim(),
      );
      if (folderDenial) {
        return res.status(403).json(folderDenial);
      }
    }

    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before saving actions.",
        message: "Please connect Google before saving actions.",
      });
    }

    try {
      const result = await saveCompanyActions(
        authed,
        { ...registryDeps, ...scheduleDeps, writeCompanyActions },
        {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId,
          actions,
        },
      );

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyFolderId,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        written: result.written,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "ACTIONS_SAVE_FAILED",
        error: "BERT could not save these actions. Try again.",
        message: "BERT could not save these actions. Try again.",
      });
    }
  });

  app.post("/api/companies/:companyId/actions/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before cleaning up verification actions.",
        message: "Could not clean up verification actions.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId = String(
      req.body?.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
    ).trim();
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      actor,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await cleanupStaleVerificationActions(
        authed,
        { ...registryDeps, ...scheduleDeps, writeCompanyActions, readTabRecords },
        {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: trustSessionContext
            ? sessionMasterSheetId
            : String(req.body?.masterSheetId || "").trim(),
          trustSessionContext,
        },
      );
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }
      return res.status(200).json({
        ok: true,
        cleanedCount: result.cleanedCount || 0,
        cleanedActionIds: result.cleanedActionIds || [],
      });
    } catch (error) {
      const technicalError = error instanceof Error ? error.message : String(error);
      console.error("[actions-verification-cleanup] route catch_error:", {
        companyId: companyFolderId,
        error: technicalError,
      });
      return res.status(500).json({
        ok: false,
        code: "VERIFICATION_CLEANUP_FAILED",
        error: "Could not clean up verification actions.",
        message: "Could not clean up verification actions.",
      });
    }
  });

  app.post("/api/companies/:companyId/actions/:actionId/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before cleaning up verification actions.",
        message: "Could not clean up verification action.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const actionId = String(req.params?.actionId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId = String(
      req.body?.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
    ).trim();
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      actor,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await cleanupVerificationAction(
        authed,
        { ...registryDeps, ...scheduleDeps, writeCompanyActions, readTabRecords },
        {
          actionId,
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: trustSessionContext
            ? sessionMasterSheetId
            : String(req.body?.masterSheetId || "").trim(),
          trustSessionContext,
        },
      );
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }
      return res.status(200).json({
        ok: true,
        actionId: result.actionId,
        cleaned: result.cleaned === true,
        status: result.status,
      });
    } catch (error) {
      const technicalError = error instanceof Error ? error.message : String(error);
      console.error("[action-verification-cleanup] route catch_error:", {
        companyId: companyFolderId,
        actionId,
        error: technicalError,
      });
      return res.status(500).json({
        ok: false,
        code: "VERIFICATION_CLEANUP_FAILED",
        error: "Could not clean up verification action.",
        message: "Could not clean up verification action.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/ncrs", async (req, res) => {
    const authed = getAuthedClient();
    const companyFolderId = String(req.params?.companyFolderId || req.body?.companyFolderId || "").trim();
    const masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
    const ncrs = Array.isArray(req.body?.ncrs) ? req.body.ncrs : [];
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;

    if (!companyFolderId) {
      return res.status(400).json({
        ok: false,
        code: "COMPANY_CONTEXT_MISSING",
        error: "Company folder ID is required before saving NCRs.",
        message: "Company folder ID is required before saving NCRs.",
      });
    }

    if (!Array.isArray(ncrs) || ncrs.length === 0) {
      return res.status(400).json({
        ok: false,
        code: "NCR_PAYLOAD_INVALID",
        error: "At least one non-conformance record is required.",
        message: "At least one non-conformance record is required.",
      });
    }

    if (authed) {
      const folderDenial = await rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        companyFolderId,
        String(req.body?.companyName || actor?.companyName || "").trim(),
      );
      if (folderDenial) {
        return res.status(403).json(folderDenial);
      }
    }

    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before saving NCRs.",
        message: "Please connect Google before saving NCRs.",
      });
    }

    try {
      const result = await saveCompanyNcrs(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId,
          ncrs,
        },
      );

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyFolderId,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        written: result.written,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "NCR_WRITE_FAILED",
        error: "Could not save non-conformance records. Try again.",
        message: "Could not save non-conformance records. Try again.",
      });
    }
  });

  async function respondWithCompanyAuditResults(req, res, options = {}) {
    const trustClientSheetHints = options.trustClientSheetHints === true;
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading audit results.",
        message: "Could not load audit results for this company.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const masterSheetId = trustClientSheetHints
      ? String(req.query.masterSheetId || req.query.sheetId || "").trim()
      : "";
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const companyFolderId = trustClientSheetHints
      ? String(req.query.companyFolderId || sessionCompanyFolderId || companyId).trim()
      : sessionCompanyFolderId || companyId;

    if (!trustClientSheetHints && sessionCompanyFolderId && companyId && sessionCompanyFolderId !== companyId) {
      if (!isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role })) {
        return res.status(403).json({
          ok: false,
          code: "SESSION_COMPANY_MISMATCH",
          error: "Results are scoped to your signed-in company workspace.",
          message: "You do not have permission to view audit results for this company.",
        });
      }
    }

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId,
          companyFolderId: companyId,
          masterSheetId,
          companyName: String(req.query.companyName || actor?.companyName || "").trim(),
        },
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
        !canListCompanyAuditResults(actor, resolved.companyFolderId, [
          companyId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "AUDIT_RESULTS_FORBIDDEN",
          error: "You do not have permission to view audit results for this company.",
          message: "You do not have permission to view audit results for this company.",
        });
      }

      const listOptions = options.applyListDefaults
        ? {
            limit: parseOptionalPositiveInt(req.query?.limit, DEFAULT_RESULTS_LIST_LIMIT),
            sinceDays: parseOptionalPositiveInt(req.query?.sinceDays, DEFAULT_RESULTS_LIST_SINCE_DAYS),
            offset: parseOptionalPositiveInt(req.query?.offset, 0),
            resolvedContext: resolved,
          }
        : null;

      const listed = await listAuditResults(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId: resolved.companyFolderId,
        companyFolderId: resolved.companyFolderId,
        masterSheetId: resolved.masterSheetId,
      }, listOptions);
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
        masterSheetId: listed.masterSheetId,
        results: listed.results,
        totalMatched: listed.totalMatched,
        hasMore: listed.hasMore,
        nextOffset: listed.nextOffset,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "AUDIT_RESULTS_LOAD_FAILED",
        error: "Could not load audit results for this company.",
        message: "Could not load audit results for this company.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function respondWithCompanyAuditResultDetail(req, res) {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading this completed check.",
        message: "Could not load this completed check.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const resultId = String(req.params?.resultId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const companyFolderId = sessionCompanyFolderId || companyId;

    if (sessionCompanyFolderId && companyId && sessionCompanyFolderId !== companyId) {
      if (!isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role })) {
        return res.status(403).json({
          ok: false,
          code: "SESSION_COMPANY_MISMATCH",
          error: "Results are scoped to your signed-in company workspace.",
          message: "You do not have permission to view this completed check.",
        });
      }
    }

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      String(actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId,
          companyFolderId: companyId,
          masterSheetId: "",
          companyName: String(actor?.companyName || "").trim(),
        },
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
        !canListCompanyAuditResults(actor, resolved.companyFolderId, [
          companyId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "AUDIT_RESULTS_FORBIDDEN",
          error: "You do not have permission to view audit results for this company.",
          message: "You do not have permission to view this completed check.",
        });
      }

      const detail = await getAuditResult(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId: resolved.companyFolderId,
        companyFolderId: resolved.companyFolderId,
        masterSheetId: resolved.masterSheetId,
      }, resultId);
      if (!detail.ok) {
        return res.status(detail.httpStatus || 400).json({
          ok: false,
          code: detail.code,
          error: detail.error,
          message: detail.message || detail.error,
          technicalError: detail.technicalError,
        });
      }

      return res.json({
        ok: true,
        companyId: detail.companyFolderId,
        companyFolderId: detail.companyFolderId,
        masterSheetId: detail.masterSheetId,
        result: detail.result,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "AUDIT_RESULT_LOAD_FAILED",
        error: "Could not load this completed check.",
        message: "Could not load this completed check.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  app.get("/api/companies/:companyId/results", async (req, res) => {
    return respondWithCompanyAuditResults(req, res, {
      trustClientSheetHints: false,
      applyListDefaults: true,
    });
  });

  app.get("/api/companies/:companyId/results/:resultId", async (req, res) => {
    return respondWithCompanyAuditResultDetail(req, res);
  });

  app.get("/api/companies/:companyId/audit-results", async (req, res) => {
    return respondWithCompanyAuditResults(req, res, { trustClientSheetHints: true });
  });

  app.post("/api/companies/:companyId/checks/:scheduleId/complete", async (req, res) => {
    const routeStartedAt = Date.now();
    let responded = false;
    const respondJson = (status, body) => {
      if (responded) {
        return;
      }
      responded = true;
      return res.status(status).json(body);
    };
    const routeTimeout = setTimeout(() => {
      console.info("[complete-check]", {
        phase: "route_timeout",
        companyId: String(req.params?.companyId || "").trim(),
        scheduleId: String(req.params?.scheduleId || "").trim(),
        elapsedMs: Date.now() - routeStartedAt,
      });
      respondJson(504, {
        ok: false,
        code: "CHECK_COMPLETION_TIMEOUT",
        reasonCode: "REQUEST_TIMEOUT",
        error:
          "Check submission is taking longer than expected. Please check Sync Centre before retrying.",
        message:
          "Check submission is taking longer than expected. Please check Sync Centre before retrying.",
      });
    }, CHECK_COMPLETION_ROUTE_TIMEOUT_MS);

    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      clearTimeout(routeTimeout);
      return respondJson(401, {
        ok: false,
        error: "Please connect Google before submitting a completed check.",
        message: "Could not submit completed check.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const scheduleId = String(req.params?.scheduleId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId = String(
      req.body?.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
    ).trim();
    const email = String(actor?.email || req.body?.email || req.body?.completedByEmail || "").trim();

    console.info("[complete-check]", {
      phase: "route_entered",
      companyId: companyFolderId,
      scheduleId,
      userEmail: email.toLowerCase(),
      hasClientMasterSheetId: Boolean(
        String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
      ),
    });

    if (!scheduleId) {
      clearTimeout(routeTimeout);
      return respondJson(400, {
        ok: false,
        code: "SCHEDULE_ID_REQUIRED",
        error: "Schedule ID is required.",
      });
    }
    if (!email) {
      clearTimeout(routeTimeout);
      return respondJson(401, {
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Signed-in user email is required to complete a check.",
      });
    }

    const folderDenial = await withOperationTimeout(
      rejectCompanyApiIfFolderInvalid(
        authed,
        { ...registryDeps, ...scheduleDeps },
        companyFolderId,
        String(req.body?.companyName || actor?.companyName || "").trim(),
      ),
      "validate_company_folder_placement",
      Math.min(CHECK_COMPLETION_GOOGLE_TIMEOUT_MS, 20_000),
    ).catch(() => null);
    if (folderDenial) {
      clearTimeout(routeTimeout);
      return respondJson(403, folderDenial);
    }

    try {
      const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
      const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
      const trustSessionContext =
        actor?.kind === "company" &&
        Boolean(sessionMasterSheetId) &&
        sessionCompanyFolderId === companyFolderId;

      const result = await submitCompletedCheck(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          scheduleId,
          email,
          userEmail: email,
          completedByName: String(actor?.name || req.body?.completedByName || req.body?.name || "").trim(),
          companyId: companyFolderId,
          companyFolderId,
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
          masterSheetId: trustSessionContext ? sessionMasterSheetId : "",
          trustSessionContext,
          auditId: req.body?.auditId,
          auditName: req.body?.auditName,
          areaId: req.body?.areaId,
          status: req.body?.status,
          answers: req.body?.answers,
          answersJson: req.body?.answersJson,
          findings: req.body?.findings,
          findingsJson: req.body?.findingsJson,
          evidence: req.body?.evidence,
          evidenceRefs: req.body?.evidenceRefs,
          evidenceFiles: req.body?.evidenceFiles,
          localSubmissionId: req.body?.localSubmissionId,
          resultId: req.body?.resultId,
          completedAt: req.body?.completedAt,
          startedAt: routeStartedAt,
        },
      );

      clearTimeout(routeTimeout);
      if (!result.ok) {
        return respondJson(result.httpStatus || 400, {
          ok: false,
          code: result.code,
          reasonCode: result.reasonCode,
          error: result.error,
          message: result.message || result.error,
        });
      }

      return respondJson(200, {
        ok: true,
        resultId: result.resultId,
        scheduleId: result.scheduleId,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        written: result.written,
        evidenceUploadWarning: result.evidenceUploadWarning || "",
        ncrWriteWarning: result.ncrWriteWarning || "",
        ncrEvidenceLinkWarning: result.ncrEvidenceLinkWarning || "",
        ncrs: result.ncrs || [],
        evidenceRefs: result.evidenceRefs || [],
      });
    } catch (error) {
      clearTimeout(routeTimeout);
      const technicalError = error instanceof Error ? error.message : String(error);
      console.error("[complete-check] route catch_error:", {
        companyId: companyFolderId,
        scheduleId,
        userEmail: email.toLowerCase(),
        elapsedMs: Date.now() - routeStartedAt,
        error: technicalError,
      });
      return respondJson(500, {
        ok: false,
        code: "CHECK_SUBMIT_FAILED",
        error: "Could not submit completed check.",
        message: "Could not submit completed check.",
      });
    }
  });

  app.post("/api/companies/:companyId/audit-results/:resultId/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before cleaning up verification audit results.",
        message: "Could not clean up verification audit result.",
      });
    }

    const companyId = String(req.params?.companyId || "").trim();
    const resultId = String(req.params?.resultId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const companyFolderId = String(
      req.body?.companyFolderId || actor?.companyFolderId || actor?.companyId || companyId,
    ).trim();
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const sessionMasterSheetId = String(actor?.masterSheetId || "").trim();
    const trustSessionContext =
      actor?.kind === "company" &&
      Boolean(sessionMasterSheetId) &&
      sessionCompanyFolderId === companyFolderId;

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      companyFolderId,
      actor,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const result = await cleanupVerificationAuditResult(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          resultId,
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: trustSessionContext
            ? sessionMasterSheetId
            : String(req.body?.masterSheetId || "").trim(),
          trustSessionContext,
          localSubmissionId: String(req.body?.localSubmissionId || "").trim(),
        },
      );
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }
      return res.status(200).json({
        ok: true,
        resultId: result.resultId,
        cleaned: result.cleaned === true,
        status: result.status,
      });
    } catch (error) {
      const technicalError = error instanceof Error ? error.message : String(error);
      console.error("[verification-cleanup] route catch_error:", {
        companyId: companyFolderId,
        resultId,
        error: technicalError,
      });
      return res.status(500).json({
        ok: false,
        code: "VERIFICATION_CLEANUP_FAILED",
        error: "Could not clean up verification audit result.",
        message: "Could not clean up verification audit result.",
      });
    }
  });

  app.get("/api/companies/:companyId/google-forms", async (req, res) => {
    return handleCompanyGoogleFormsGet(req, res, {
      getAuthedClient,
      envConfigured,
      rejectIfCompanyFolderNotUnderCompaniesRoot,
      parseBertActorFromRequest,
      google,
      sharedDriveId: registryDeps?.sharedDriveId,
      ...scheduleDeps,
    });
  });

  app.post("/api/companies/:companyId/google-forms/sync", async (req, res) => {
    return handleCompanyGoogleFormsSyncPost(req, res, {
      getAuthedClient,
      envConfigured,
      rejectIfCompanyFolderNotUnderCompaniesRoot,
      parseBertActorFromRequest,
      google,
      sharedDriveId: registryDeps?.sharedDriveId,
      ...scheduleDeps,
    });
  });

  app.post("/api/companies/:companyId/google-forms/:formId/create-bert-check", async (req, res) => {
    return handleCreateBertCheckFromGoogleFormPost(req, res, {
      getAuthedClient,
      envConfigured,
      rejectIfCompanyFolderNotUnderCompaniesRoot,
      parseBertActorFromRequest,
      google,
      sharedDriveId: registryDeps?.sharedDriveId,
      sessionDir,
      rowsToRecords,
      ...scheduleDeps,
    });
  });

  async function respondWithCompanyIncidents(req, res) {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading incidents.",
        message: "Could not load incidents for this company.",
      });
    }

    const companyFolderId = String(req.params?.companyFolderId || req.params?.companyId || "").trim();
    const masterSheetId = String(req.query?.masterSheetId || req.query?.sheetId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || "").trim();
    const resolvedCompanyFolderId = sessionCompanyFolderId || companyFolderId;

    if (sessionCompanyFolderId && companyFolderId && sessionCompanyFolderId !== companyFolderId) {
      if (!isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role })) {
        return res.status(403).json({
          ok: false,
          code: "SESSION_COMPANY_MISMATCH",
          error: "Incidents are scoped to your signed-in company workspace.",
          message: "You do not have permission to view incidents for this company.",
        });
      }
    }

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      resolvedCompanyFolderId,
      String(req.query?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId,
          companyName: String(req.query?.companyName || actor?.companyName || "").trim(),
        },
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
        !canListCompanyIncidents(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENTS_FORBIDDEN",
          error: "You do not have permission to view incidents for this company.",
          message: "You do not have permission to view incidents for this company.",
        });
      }

      const listed = await listCompanyIncidents(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: resolved.companyFolderId,
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
        },
        { resolvedContext: resolved },
      );
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
        masterSheetId: listed.masterSheetId,
        incidents: listed.incidents,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENTS_LOAD_FAILED",
        error: "Could not load incidents for this company.",
        message: "Could not load incidents for this company.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  app.get("/api/companies/:companyFolderId/incidents", async (req, res) => {
    return respondWithCompanyIncidents(req, res);
  });

  app.post("/api/companies/:companyFolderId/incidents", async (req, res) => {
    const routeStartedAt = Date.now();
    let responded = false;
    const respondJson = (status, body) => {
      if (responded) {
        return;
      }
      responded = true;
      return res.status(status).json(body);
    };
    const routeTimeout = setTimeout(() => {
      console.info("[incidents]", {
        phase: "route_timeout",
        companyId: String(req.params?.companyFolderId || "").trim(),
        elapsedMs: Date.now() - routeStartedAt,
      });
      respondJson(504, {
        ok: false,
        code: "INCIDENT_SUBMIT_TIMEOUT",
        reasonCode: "REQUEST_TIMEOUT",
        error: "Submitting your incident timed out before the server finished saving to your company workbook.",
        message: "Submitting your incident timed out before the server finished saving to your company workbook.",
      });
    }, INCIDENTS_ROUTE_TIMEOUT_MS);

    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      clearTimeout(routeTimeout);
      return respondJson(401, {
        ok: false,
        error: "Please connect Google before submitting an incident.",
        message: "Could not submit incident.",
      });
    }

    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const email = String(actor?.email || req.body?.reporterEmail || req.body?.email || "").trim();

    console.info("[incidents]", {
      phase: "route_entered",
      companyId: sessionCompanyFolderId,
      userEmail: email.toLowerCase(),
      hasClientMasterSheetId: Boolean(String(req.body?.masterSheetId || "").trim()),
    });

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      clearTimeout(routeTimeout);
      return respondJson(403, folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        clearTimeout(routeTimeout);
        return respondJson(resolved.httpStatus || 400, {
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
          technicalError: resolved.technicalError,
        });
      }

      if (
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        clearTimeout(routeTimeout);
        return respondJson(403, {
          ok: false,
          code: "INCIDENT_SUBMIT_FORBIDDEN",
          error: "You do not have permission to submit incidents for this company.",
          message: "You do not have permission to submit incidents for this company.",
        });
      }

      const submitted = await submitCompanyIncident(
        authed,
        {
          ...registryDeps,
          ...scheduleDeps,
          google,
          ensureTabExists,
          ensureColumns,
          getWorkbook,
          getTabValues,
          withSheetsQuotaRetry,
          safeLower: (value) => String(value || "").toLowerCase(),
        },
        {
          ...req.body,
          companyId: resolved.companyFolderId,
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          reporterEmail: email || req.body?.reporterEmail,
          createdBy: String(actor?.name || req.body?.reporterName || req.body?.createdBy || "").trim(),
          resolvedContext: resolved,
        },
      );
      clearTimeout(routeTimeout);
      if (!submitted.ok) {
        return respondJson(submitted.httpStatus || 400, {
          ok: false,
          code: submitted.code,
          error: submitted.error,
          message: submitted.message || submitted.error,
          missing: submitted.missing,
          technicalError: submitted.technicalError,
        });
      }

      return respondJson(200, {
        ok: true,
        companyId: submitted.companyId,
        companyFolderId: submitted.companyFolderId,
        masterSheetId: submitted.masterSheetId,
        incidentId: submitted.incidentId,
        incident: submitted.incident,
        evidenceUploadWarning: submitted.evidenceUploadWarning || "",
      });
    } catch (error) {
      clearTimeout(routeTimeout);
      return respondJson(500, {
        ok: false,
        code: "INCIDENT_SUBMIT_FAILED",
        error: "Could not submit incident.",
        message: "Could not submit incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/companies/:companyFolderId/incidents/:incidentId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Please connect Google before loading incidents." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.query?.masterSheetId || "").trim(),
          companyName: String(actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }
      if (
        !canListCompanyIncidents(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENTS_FORBIDDEN",
          error: "You do not have permission to view incidents for this company.",
        });
      }
      const detail = await getCompanyIncident(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          resolvedContext: resolved,
        },
        incidentId,
      );
      if (!detail.ok) {
        return res.status(detail.httpStatus || 400).json({
          ok: false,
          code: detail.code,
          error: detail.error,
          message: detail.message || detail.error,
        });
      }
      return res.json({
        ok: true,
        companyId: detail.companyId,
        companyFolderId: detail.companyFolderId,
        masterSheetId: detail.masterSheetId,
        incidentId: detail.incidentId,
        incident: detail.incident,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_LOAD_FAILED",
        error: "Could not load incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch("/api/companies/:companyFolderId/incidents/:incidentId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Please connect Google before updating incidents." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }
      if (
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENT_PATCH_FORBIDDEN",
          error: "You do not have permission to update incidents for this company.",
        });
      }
      const patched = await patchCompanyIncident(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          ...req.body,
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          incidentId,
          resolvedContext: resolved,
        },
        actor || {},
      );
      if (!patched.ok) {
        return res.status(patched.httpStatus || 400).json({
          ok: false,
          code: patched.code,
          error: patched.error,
          message: patched.message || patched.error,
        });
      }
      return res.json({
        ok: true,
        companyId: patched.companyId,
        companyFolderId: patched.companyFolderId,
        masterSheetId: patched.masterSheetId,
        incidentId: patched.incidentId,
        incident: patched.incident,
        updatedRows: patched.updatedRows,
        unchanged: patched.unchanged,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_PATCH_FAILED",
        error: "Could not update incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/incidents/:incidentId/close", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Please connect Google before closing incidents." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }
      if (
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENT_CLOSE_FORBIDDEN",
          error: "You do not have permission to close incidents for this company.",
        });
      }
      const closed = await closeCompanyIncident(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          ...req.body,
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          incidentId,
          resolvedContext: resolved,
        },
        actor || {},
      );
      if (!closed.ok) {
        return res.status(closed.httpStatus || 400).json({
          ok: false,
          code: closed.code,
          error: closed.error,
          message: closed.message || closed.error,
        });
      }
      return res.json({
        ok: true,
        companyId: closed.companyId,
        companyFolderId: closed.companyFolderId,
        masterSheetId: closed.masterSheetId,
        incidentId: closed.incidentId,
        incident: closed.incident,
        alreadyClosed: Boolean(closed.alreadyClosed),
        updatedRows: closed.updatedRows,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_CLOSE_FAILED",
        error: "Could not close incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/incidents/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Please connect Google before cleaning verification incidents." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }
      if (
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENT_CLEANUP_FORBIDDEN",
          error: "You do not have permission to clean verification incidents for this company.",
        });
      }
      const cleaned = await cleanupStaleVerificationIncidents(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          resolvedContext: resolved,
        },
        actor || {},
      );
      if (!cleaned.ok) {
        return res.status(cleaned.httpStatus || 400).json({
          ok: false,
          code: cleaned.code,
          error: cleaned.error,
          message: cleaned.message || cleaned.error,
        });
      }
      return res.json({
        ok: true,
        companyFolderId: cleaned.companyFolderId,
        masterSheetId: cleaned.masterSheetId,
        cleanedCount: cleaned.cleanedCount,
        results: cleaned.results,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_STALE_CLEANUP_FAILED",
        error: "Could not clean stale verification incidents.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/incidents/:incidentId/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Please connect Google before cleaning verification incidents." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }
      if (
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENT_CLEANUP_FORBIDDEN",
          error: "You do not have permission to clean verification incidents for this company.",
        });
      }
      const cleaned = await cleanupVerificationIncident(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          incidentId,
          resolvedContext: resolved,
        },
        actor || {},
      );
      if (!cleaned.ok) {
        return res.status(cleaned.httpStatus || 400).json({
          ok: false,
          code: cleaned.code,
          error: cleaned.error,
          message: cleaned.message || cleaned.error,
        });
      }
      return res.json({
        ok: true,
        companyFolderId: cleaned.companyFolderId,
        masterSheetId: cleaned.masterSheetId,
        incidentId: cleaned.incidentId,
        cleaned: cleaned.cleaned,
        alreadyCleaned: Boolean(cleaned.alreadyCleaned),
        status: cleaned.status,
        updatedRows: cleaned.updatedRows,
        archivedRiddor: cleaned.archivedRiddor,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_CLEANUP_FAILED",
        error: "Could not clean verification incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/incidents/:incidentId/evidence", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before uploading incident evidence.",
        message: "Could not upload incident evidence.",
      });
    }

    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    console.info("[incidents]", {
      phase: "evidence_route_entered",
      companyId: String(req.params?.companyFolderId || "").trim(),
      incidentId,
      fileCount: files.length,
    });
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const email = String(actor?.email || req.body?.reporterEmail || req.body?.email || "").trim();

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
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
        !canSubmitCompanyIncident(actor, resolved.companyFolderId, [
          companyFolderId,
          resolved.companyId,
          ...resolved.alternateIds,
        ])
      ) {
        return res.status(403).json({
          ok: false,
          code: "INCIDENT_EVIDENCE_FORBIDDEN",
          error: "You do not have permission to upload incident evidence for this company.",
          message: "You do not have permission to upload incident evidence for this company.",
        });
      }

      const uploaded = await uploadIncidentEvidenceToDrive(
        authed,
        {
          google,
          ensureTabExists,
          ensureColumns,
          getWorkbook,
          getTabValues,
          withSheetsQuotaRetry,
          safeLower: (value) => String(value || "").toLowerCase(),
        },
        {
          companyFolderId: resolved.companyFolderId,
          masterSheetId: resolved.masterSheetId,
          incidentId,
          files,
          reporterEmail: email,
        },
      );

      console.info("[incidents]", {
        phase: "evidence_route_uploaded",
        companyId: resolved.companyFolderId,
        incidentId,
        folderId: uploaded.folderId || "",
        uploadedCount: uploaded.evidenceUrls?.length || 0,
        ok: uploaded.ok,
      });

      if (!uploaded.ok) {
        return res.status(uploaded.httpStatus || 502).json({
          ok: false,
          code: uploaded.code,
          error: uploaded.error,
          message: uploaded.message || uploaded.error,
          technicalError: uploaded.technicalError,
          errors: uploaded.errors,
        });
      }

      return res.status(200).json({
        ok: true,
        companyId: resolved.companyFolderId,
        companyFolderId: resolved.companyFolderId,
        masterSheetId: resolved.masterSheetId,
        incidentId,
        evidenceUrls: uploaded.evidenceUrls,
        folderPath: uploaded.folderPath,
        folderId: uploaded.folderId,
        warning: uploaded.warning || "",
        partial: Boolean(uploaded.partial),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_EVIDENCE_UPLOAD_FAILED",
        error: "Could not upload incident evidence.",
        message: "Could not upload incident evidence.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/companies/:companyFolderId/incidents/:incidentId/reassign", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before reassigning incidents.",
        message: "Could not reassign incident.",
      });
    }

    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const incidentId = String(req.params?.incidentId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();

    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    try {
      const resolved = await resolveCompanyScheduleContext(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyId: sessionCompanyFolderId,
          companyFolderId: sessionCompanyFolderId,
          masterSheetId: String(req.body?.masterSheetId || "").trim(),
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
        },
      );
      if (!resolved.ok) {
        return res.status(resolved.httpStatus || 400).json({
          ok: false,
          code: resolved.code,
          error: resolved.error,
          message: resolved.message || resolved.error,
        });
      }

      const result = await reassignCompanyIncident(
        authed,
        { ...registryDeps, ...scheduleDeps },
        {
          companyFolderId: sessionCompanyFolderId,
          companyId: sessionCompanyFolderId,
          incidentId,
          toEmail: req.body?.toEmail,
          toName: req.body?.toName,
          toRole: req.body?.toRole,
          reason: req.body?.reason,
          masterSheetId: resolved.masterSheetId,
          companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
          resolvedContext: resolved,
        },
        actor || {},
      );

      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          code: result.code,
          error: result.error,
          message: result.message || result.error,
        });
      }

      return res.json({
        ok: true,
        companyId: result.companyId,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        incident: result.incident,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "INCIDENT_REASSIGN_FAILED",
        error: "Could not reassign this incident.",
        message: "Could not reassign this incident.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * LOLER equipment compliance — dedicated LOLEREquipment/LOLERSchedules tabs.
   * Same auth pattern as incidents: Google client + actor session + folder check + resolved context.
   */
  const resolveLolerRouteContext = async (req, res, options = {}) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      res.status(401).json({
        ok: false,
        error: "Please connect Google before using LOLER equipment.",
        message: "Could not load LOLER equipment.",
      });
      return null;
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewLoler(actor) || (options.manage && !canManageLoler(actor))) {
      res.status(403).json({
        ok: false,
        code: "LOLER_FORBIDDEN",
        error: "You do not have permission to use LOLER equipment.",
        message: "You do not have permission to use LOLER equipment.",
      });
      return null;
    }
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      res.status(403).json(folderDenial);
      return null;
    }
    const resolved = await resolveCompanyScheduleContext(
      authed,
      { ...registryDeps, ...scheduleDeps },
      {
        companyId: sessionCompanyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
        companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
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
      !actorCanAccessCompanyLoler(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({
        ok: false,
        code: "LOLER_COMPANY_MISMATCH",
        error: "Your session does not belong to this company.",
        message: "Your session does not belong to this company.",
      });
      return null;
    }
    return { authed, actor, resolved };
  };

  const lolerRouteError = (res, result, fallbackCode) => {
    return res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
    });
  };

  const runLolerRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveLolerRouteContext(req, res, options);
    if (!routeContext) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        run(routeContext),
        failure.operation,
        LOLER_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return lolerRouteError(res, result, failure.code);
      }
      return res.json(result);
    } catch (error) {
      console.info("[loler]", {
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

  app.get("/api/companies/:companyFolderId/loler/equipment", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listLolerEquipment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "loler_equipment_list", code: "LOLER_LIST_FAILED", message: "Could not load LOLER equipment." },
    );
  });

  app.post("/api/companies/:companyFolderId/loler/equipment", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createLolerEquipment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "loler_equipment_create", code: "LOLER_CREATE_FAILED", message: "Could not add LOLER equipment." },
    );
  });

  app.get("/api/companies/:companyFolderId/loler/equipment/:equipmentId", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getLolerEquipment(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.equipmentId || "").trim()),
      { operation: "loler_equipment_get", code: "LOLER_GET_FAILED", message: "Could not load LOLER equipment." },
    );
  });

  app.patch("/api/companies/:companyFolderId/loler/equipment/:equipmentId", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        updateLolerEquipment(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.equipmentId || "").trim(),
          req.body || {},
        ),
      { operation: "loler_equipment_update", code: "LOLER_UPDATE_FAILED", message: "Could not update LOLER equipment." },
    );
  });

  app.post("/api/companies/:companyFolderId/loler/equipment/:equipmentId/archive", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        archiveLolerEquipment(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.equipmentId || "").trim(),
        ),
      { operation: "loler_equipment_archive", code: "LOLER_ARCHIVE_FAILED", message: "Could not archive LOLER equipment." },
    );
  });

  app.post("/api/companies/:companyFolderId/loler/equipment/:equipmentId/out-of-service", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        markLolerEquipmentOutOfService(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.equipmentId || "").trim(),
        ),
      {
        operation: "loler_equipment_out_of_service",
        code: "LOLER_OUT_OF_SERVICE_FAILED",
        message: "Could not mark LOLER equipment out of service.",
      },
    );
  });

  app.post("/api/companies/:companyFolderId/loler/equipment/:equipmentId/return-to-service", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        returnLolerEquipmentToService(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.equipmentId || "").trim(),
          {
            nextExaminationDueDate: req.body?.nextExaminationDueDate,
            lastExaminationDate: req.body?.lastExaminationDate,
          },
        ),
      {
        operation: "loler_equipment_return_to_service",
        code: "LOLER_RETURN_TO_SERVICE_FAILED",
        message: "Could not return LOLER equipment to service.",
      },
    );
  });

  app.get("/api/companies/:companyFolderId/loler/schedules", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listLolerSchedules(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "loler_schedules_list", code: "LOLER_SCHEDULES_FAILED", message: "Could not load LOLER examinations." },
    );
  });

  app.get("/api/companies/:companyFolderId/loler/examinations", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listLolerExaminations(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          equipmentId: String(req.query?.equipmentId || "").trim(),
        }),
      { operation: "loler_examinations_list", code: "LOLER_EXAMINATIONS_FAILED", message: "Could not load examination records." },
    );
  });

  app.post("/api/companies/:companyFolderId/loler/examinations", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      async ({ authed, actor, resolved }) => {
        // Permission enforced inside recordLolerExamination (managers + assigned auditors).
        void canRecordLolerExamination;
        return recordLolerExamination(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          req.body || {},
        );
      },
      { operation: "loler_examination_record", code: "LOLER_EXAMINATION_FAILED", message: "Could not record examination." },
    );
  });

  app.get("/api/companies/:companyFolderId/loler/examinations/:examinationId", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getLolerExamination(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.examinationId || "").trim(),
        ),
      { operation: "loler_examination_get", code: "LOLER_EXAMINATION_GET_FAILED", message: "Could not load examination." },
    );
  });

  app.patch("/api/companies/:companyFolderId/loler/examinations/:examinationId", async (req, res) => {
    return runLolerRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        updateLolerExamination(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.examinationId || "").trim(),
          req.body || {},
        ),
      { operation: "loler_examination_update", code: "LOLER_EXAMINATION_UPDATE_FAILED", message: "Could not update examination." },
    );
  });

  /**
   * Operational messages — company-scoped inbox (LOLER-linked first).
   * Not loaded during login/authentication.
   */
  const resolveMessagesRouteContext = async (req, res, options = {}) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      res.status(401).json({
        ok: false,
        error: "Please connect Google before using messages.",
        message: "Could not load messages.",
      });
      return null;
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewMessages(actor) || (options.send && !canSendMessages(actor))) {
      res.status(403).json({
        ok: false,
        code: "MESSAGES_FORBIDDEN",
        error: "You do not have permission to use messages.",
        message: "You do not have permission to use messages.",
      });
      return null;
    }
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      res.status(403).json(folderDenial);
      return null;
    }
    const resolved = await resolveCompanyScheduleContext(
      authed,
      { ...registryDeps, ...scheduleDeps },
      {
        companyId: sessionCompanyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
        companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
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
      !actorCanAccessCompanyMessages(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({
        ok: false,
        code: "MESSAGES_COMPANY_MISMATCH",
        error: "Your session does not belong to this company.",
        message: "Your session does not belong to this company.",
      });
      return null;
    }
    return { authed, actor, resolved };
  };

  const messagesRouteError = (res, result, fallbackCode) => {
    return res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
    });
  };

  const runMessagesRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveMessagesRouteContext(req, res, options);
    if (!routeContext) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(run(routeContext), failure.operation, MESSAGES_ROUTE_TIMEOUT_MS);
      if (!result.ok) {
        return messagesRouteError(res, result, failure.code);
      }
      return res.json(result);
    } catch (error) {
      console.info("[messages]", {
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

  app.get("/api/companies/:companyFolderId/messages", async (req, res) => {
    return runMessagesRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listOperationalMessages(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          includeArchived: String(req.query?.includeArchived || "").trim() === "1",
        }),
      { operation: "messages_list", code: "MESSAGES_LIST_FAILED", message: "Could not load messages." },
    );
  });

  app.post("/api/companies/:companyFolderId/messages", async (req, res) => {
    return runMessagesRoute(
      req,
      res,
      { send: true },
      ({ authed, actor, resolved }) =>
        createOperationalMessage(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "messages_create", code: "MESSAGES_CREATE_FAILED", message: "Could not send message." },
    );
  });

  app.post("/api/companies/:companyFolderId/messages/:messageId/read", async (req, res) => {
    return runMessagesRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        markOperationalMessageRead(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.messageId || "").trim(),
        ),
      { operation: "messages_read", code: "MESSAGES_READ_FAILED", message: "Could not mark message read." },
    );
  });

  app.post("/api/companies/:companyFolderId/messages/:messageId/archive", async (req, res) => {
    return runMessagesRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        archiveOperationalMessage(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.messageId || "").trim(),
        ),
      { operation: "messages_archive", code: "MESSAGES_ARCHIVE_FAILED", message: "Could not archive message." },
    );
  });

  /**
   * Calendar — dedicated CalendarItems tab (events + reminders).
   * Same auth pattern as LOLER/incidents. Does not touch Schedules or LOLERSchedules.
   */
  const resolveCalendarRouteContext = async (req, res, options = {}) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      res.status(401).json({
        ok: false,
        error: "Please connect Google before using Calendar.",
        message: "Could not load Calendar.",
      });
      return null;
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewCalendar(actor) || (options.manage && !canManageCalendar(actor))) {
      res.status(403).json({
        ok: false,
        code: "CALENDAR_FORBIDDEN",
        error: "You do not have permission to use Calendar.",
        message: "You do not have permission to use Calendar.",
      });
      return null;
    }
    const sessionCompanyFolderId = String(actor?.companyFolderId || actor?.companyId || companyFolderId).trim();
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...scheduleDeps },
      sessionCompanyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      res.status(403).json(folderDenial);
      return null;
    }
    const resolved = await resolveCompanyScheduleContext(
      authed,
      { ...registryDeps, ...scheduleDeps },
      {
        companyId: sessionCompanyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
        companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
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
      !actorCanAccessCompanyCalendar(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({
        ok: false,
        code: "CALENDAR_COMPANY_MISMATCH",
        error: "Your session does not belong to this company.",
        message: "Your session does not belong to this company.",
      });
      return null;
    }
    return { authed, actor, resolved };
  };

  const calendarRouteError = (res, result, fallbackCode) => {
    return res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
    });
  };

  const runCalendarRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveCalendarRouteContext(req, res, options);
    if (!routeContext) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        run(routeContext),
        failure.operation,
        CALENDAR_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return calendarRouteError(res, result, failure.code);
      }
      return res.json(result);
    } catch (error) {
      console.info("[calendar]", {
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

  app.get("/api/companies/:companyFolderId/calendar/items", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listCalendarItems(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "calendar_items_list", code: "CALENDAR_LIST_FAILED", message: "Could not load calendar items." },
    );
  });

  app.post("/api/companies/:companyFolderId/calendar/items", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createCalendarItem(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "calendar_items_create", code: "CALENDAR_CREATE_FAILED", message: "Could not create calendar item." },
    );
  });

  app.get("/api/companies/:companyFolderId/calendar/items/:itemId", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getCalendarItem(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, String(req.params?.itemId || "").trim()),
      { operation: "calendar_items_get", code: "CALENDAR_GET_FAILED", message: "Could not load calendar item." },
    );
  });

  app.patch("/api/companies/:companyFolderId/calendar/items/:itemId", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        updateCalendarItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.itemId || "").trim(),
          req.body || {},
        ),
      { operation: "calendar_items_update", code: "CALENDAR_UPDATE_FAILED", message: "Could not update calendar item." },
    );
  });

  app.post("/api/companies/:companyFolderId/calendar/items/:itemId/complete", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        completeCalendarItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.itemId || "").trim(),
        ),
      { operation: "calendar_items_complete", code: "CALENDAR_COMPLETE_FAILED", message: "Could not complete reminder." },
    );
  });

  app.post("/api/companies/:companyFolderId/calendar/items/:itemId/archive", async (req, res) => {
    return runCalendarRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        archiveCalendarItem(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.itemId || "").trim(),
        ),
      { operation: "calendar_items_archive", code: "CALENDAR_ARCHIVE_FAILED", message: "Could not archive calendar item." },
    );
  });

  const resolveDocumentControlRouteContext = async (req, res, options = {}) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      res.status(401).json({
        ok: false,
        code: "DOCUMENT_CONTROL_UNAUTHENTICATED",
        error: "Sign in required.",
        message: "Sign in required.",
      });
      return null;
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewDocumentControl(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENT_CONTROL_FORBIDDEN",
        error: "You do not have access to Document Control.",
        message: "You do not have access to Document Control.",
      });
      return null;
    }
    if (options.manage && !canManageDocumentControl(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENT_CONTROL_FORBIDDEN",
        error: "You do not have permission to manage Document Control.",
        message: "You do not have permission to manage Document Control.",
      });
      return null;
    }
    if (options.approve && !canApproveDocumentControl(actor)) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENT_CONTROL_FORBIDDEN",
        error: "You do not have permission to approve controlled documents.",
        message: "You do not have permission to approve controlled documents.",
      });
      return null;
    }
    const sessionCompanyFolderId = actor?.companyFolderId || actor?.companyId || companyFolderId;
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
    const resolved = await resolveCompanyScheduleContext(
      authed,
      { ...registryDeps, ...scheduleDeps },
      {
        companyId: sessionCompanyFolderId,
        companyFolderId: sessionCompanyFolderId,
        masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
        companyName: String(req.body?.companyName || actor?.companyName || "").trim(),
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
      !actorCanAccessCompanyDocumentControl(actor, resolved.companyFolderId, [
        companyFolderId,
        resolved.companyId,
        ...(resolved.alternateIds || []),
      ])
    ) {
      res.status(403).json({
        ok: false,
        code: "DOCUMENT_CONTROL_COMPANY_MISMATCH",
        error: "Your session does not belong to this company.",
        message: "Your session does not belong to this company.",
      });
      return null;
    }
    return { authed, actor, resolved };
  };

  const documentControlRouteError = (res, result, fallbackCode) => {
    return res.status(result?.httpStatus || 400).json({
      ok: false,
      code: result?.code || fallbackCode,
      error: result?.error || result?.message || "Request failed.",
      message: result?.message || result?.error || "Request failed.",
      details: result?.details || undefined,
      warning: result?.warning || undefined,
    });
  };

  const runDocumentControlRoute = async (req, res, options, run, failure) => {
    const routeContext = await resolveDocumentControlRouteContext(req, res, options);
    if (!routeContext) {
      return undefined;
    }
    try {
      const result = await withOperationTimeout(
        run(routeContext),
        failure.operation,
        DOCUMENT_CONTROL_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return documentControlRouteError(res, result, failure.code);
      }
      return res.json(result);
    } catch (error) {
      console.info("[document-control]", {
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

  app.get("/api/companies/:companyFolderId/document-control/documents", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listDocumentControlDocuments(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, {
          status: String(req.query?.status || "").trim(),
          includeArchived: String(req.query?.includeArchived || "") === "1",
        }),
      { operation: "document_control_list", code: "DOCUMENT_CONTROL_LIST_FAILED", message: "Could not load controlled documents." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/documents", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createControlledDocument(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor, req.body || {}),
      { operation: "document_control_create", code: "DOCUMENT_CONTROL_CREATE_FAILED", message: "Could not create controlled document." },
    );
  });

  app.get("/api/companies/:companyFolderId/document-control/documents/:documentId", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getDocumentControlDocument(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
        ),
      { operation: "document_control_get", code: "DOCUMENT_CONTROL_GET_FAILED", message: "Could not load controlled document." },
    );
  });

  app.patch("/api/companies/:companyFolderId/document-control/documents/:documentId", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        updateControlledDocument(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
          req.body || {},
        ),
      { operation: "document_control_update", code: "DOCUMENT_CONTROL_UPDATE_FAILED", message: "Could not update controlled document." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/documents/:documentId/archive", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        archiveControlledDocument(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
        ),
      { operation: "document_control_archive", code: "DOCUMENT_CONTROL_ARCHIVE_FAILED", message: "Could not archive controlled document." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/documents/:documentId/restore", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { approve: true },
      ({ authed, actor, resolved }) =>
        restoreControlledDocument(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
        ),
      { operation: "document_control_restore", code: "DOCUMENT_CONTROL_RESTORE_FAILED", message: "Could not restore controlled document." },
    );
  });

  app.get("/api/companies/:companyFolderId/document-control/documents/:documentId/revisions", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      {},
      async ({ authed, actor, resolved }) => {
        const result = await getDocumentControlDocument(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
        );
        if (!result.ok) {
          return result;
        }
        return { ok: true, revisions: result.revisions || [], document: result.document };
      },
      { operation: "document_control_revisions", code: "DOCUMENT_CONTROL_REVISIONS_FAILED", message: "Could not load revisions." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/documents/:documentId/revisions", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        createDocumentRevision(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.documentId || "").trim(),
          req.body || {},
        ),
      { operation: "document_control_revision_create", code: "DOCUMENT_CONTROL_REVISION_FAILED", message: "Could not create revision." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/revisions/:revisionId/submit", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        submitDocumentRevision(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.revisionId || "").trim(),
        ),
      { operation: "document_control_revision_submit", code: "DOCUMENT_CONTROL_SUBMIT_FAILED", message: "Could not submit revision." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/revisions/:revisionId/approve", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { approve: true },
      ({ authed, actor, resolved }) =>
        approveDocumentRevision(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.revisionId || "").trim(),
        ),
      { operation: "document_control_revision_approve", code: "DOCUMENT_CONTROL_APPROVE_FAILED", message: "Could not approve revision." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/revisions/:revisionId/reject", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { approve: true },
      ({ authed, actor, resolved }) =>
        rejectDocumentRevision(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.revisionId || "").trim(),
          req.body || {},
        ),
      { operation: "document_control_revision_reject", code: "DOCUMENT_CONTROL_REJECT_FAILED", message: "Could not reject revision." },
    );
  });

  app.get("/api/companies/:companyFolderId/document-control/revisions/:revisionId/file", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        getDocumentRevisionFile(
          authed,
          { ...registryDeps, ...scheduleDeps },
          resolved,
          actor,
          String(req.params?.revisionId || "").trim(),
          {
            acknowledgedSupersededWarning:
              String(req.query?.acknowledge || req.query?.acknowledged || "") === "1" ||
              req.body?.acknowledgedSupersededWarning === true,
          },
        ),
      { operation: "document_control_revision_file", code: "DOCUMENT_CONTROL_FILE_FAILED", message: "Could not open revision file." },
    );
  });

  app.get("/api/companies/:companyFolderId/document-control/index", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      {},
      ({ authed, actor, resolved }) =>
        listDocumentControlIndex(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "document_control_index", code: "DOCUMENT_CONTROL_INDEX_FAILED", message: "Could not load document control index." },
    );
  });

  app.post("/api/companies/:companyFolderId/document-control/index/rebuild", async (req, res) => {
    return runDocumentControlRoute(
      req,
      res,
      { manage: true },
      ({ authed, actor, resolved }) =>
        rebuildDocumentControlIndex(authed, { ...registryDeps, ...scheduleDeps }, resolved, actor),
      { operation: "document_control_index_rebuild", code: "DOCUMENT_CONTROL_INDEX_REBUILD_FAILED", message: "Could not rebuild document control index." },
    );
  });

  app.get("/api/companies/:companyFolderId/briefings/mine", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not load briefings.", message: "Could not load briefings." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canAccessBriefings(actor)) {
      return res.status(403).json({
        ok: false,
        code: "BRIEFING_FORBIDDEN",
        error: "You do not have permission to view briefings.",
        message: "You do not have permission to view briefings.",
      });
    }
    try {
      const result = await withOperationTimeout(
        listMyBriefings(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId),
        "briefings_mine",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "BRIEFINGS_LOAD_FAILED",
        error: "Could not load briefings.",
        message: "Could not load briefings.",
      });
    }
  });

  app.get("/api/companies/:companyFolderId/briefings/todo", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Could not load briefing to-do items.",
        message: "Could not load briefing to-do items.",
      });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const limit = parseOptionalPositiveInt(req.query.limit, 5);
    try {
      const result = await withOperationTimeout(
        listBriefingsTodoPreview(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, limit),
        "briefings_todo",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "BRIEFINGS_TODO_FAILED",
        error: "Could not load briefing to-do items.",
        message: "Could not load briefing to-do items.",
      });
    }
  });

  app.get("/api/companies/:companyFolderId/briefings/tracker", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Could not load briefing tracker.",
        message: "Could not load briefing tracker.",
      });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canViewBriefingsTracker(actor)) {
      return res.status(403).json({
        ok: false,
        code: "BRIEFING_TRACKER_FORBIDDEN",
        error: "Tracker is available to managers and admins only.",
        message: "Tracker is available to managers and admins only.",
      });
    }
    try {
      const result = await withOperationTimeout(
        listBriefingsTracker(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId),
        "briefings_tracker",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "BRIEFINGS_TRACKER_FAILED",
        error: "Could not load briefing tracker.",
        message: "Could not load briefing tracker.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/briefings", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not send briefing.", message: "Could not send briefing." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({
        ok: false,
        code: "BRIEFING_FORBIDDEN",
        error: "You do not have permission to send briefings.",
        message: "You do not have permission to send briefings.",
      });
    }
    try {
      const body = req.body || {};
      const createHandler =
        body.saveAsDraft === true || body.saveAsDraft === "true"
          ? () => createDraftVerificationBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, body)
          : () => createAndSendBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, body);
      const result = await withOperationTimeout(createHandler(), "briefings_create", BRIEFINGS_ROUTE_TIMEOUT_MS);
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "BRIEFING_SEND_FAILED",
        error: "Could not send briefing.",
        message: "Could not send briefing.",
      });
    }
  });

  async function handleBriefingAction(req, res, action) {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, message: "Could not update briefing." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const briefingId = String(req.params?.briefingId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const handlers = {
      open: () => openBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId),
      read: () => readBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId),
      acknowledge: () => acknowledgeBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId),
      sign: () => signBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId, req.body || {}),
      reply: () => replyToBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId, req.body || {}),
    };
    try {
      const result = await withOperationTimeout(handlers[action](), `briefing_${action}`, BRIEFINGS_ROUTE_TIMEOUT_MS);
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "BRIEFING_ACTION_FAILED",
        error: "Could not update briefing.",
        message: "Could not update briefing.",
      });
    }
  }

  app.post("/api/companies/:companyFolderId/briefings/:briefingId/open", (req, res) => handleBriefingAction(req, res, "open"));
  app.post("/api/companies/:companyFolderId/briefings/:briefingId/read", (req, res) => handleBriefingAction(req, res, "read"));
  app.post("/api/companies/:companyFolderId/briefings/:briefingId/acknowledge", (req, res) => handleBriefingAction(req, res, "acknowledge"));
  app.post("/api/companies/:companyFolderId/briefings/:briefingId/sign", (req, res) => handleBriefingAction(req, res, "sign"));
  app.post("/api/companies/:companyFolderId/briefings/:briefingId/reply", (req, res) => handleBriefingAction(req, res, "reply"));

  app.patch("/api/companies/:companyFolderId/briefings/:briefingId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not update briefing.", message: "Could not update briefing." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const briefingId = String(req.params?.briefingId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({ ok: false, code: "BRIEFING_FORBIDDEN", error: "You do not have permission to edit briefings." });
    }
    try {
      const result = await withOperationTimeout(
        patchVerificationBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId, req.body || {}),
        "briefings_patch",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, code: "BRIEFING_PATCH_FAILED", error: "Could not update briefing." });
    }
  });

  app.post("/api/companies/:companyFolderId/briefings/:briefingId/recipients", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not assign recipients.", message: "Could not assign recipients." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const briefingId = String(req.params?.briefingId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({ ok: false, code: "BRIEFING_FORBIDDEN", error: "You do not have permission to assign recipients." });
    }
    try {
      const result = await withOperationTimeout(
        assignVerificationBriefingRecipients(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId, req.body || {}),
        "briefings_assign_recipients",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, code: "BRIEFING_RECIPIENTS_FAILED", error: "Could not assign recipients." });
    }
  });

  app.post("/api/companies/:companyFolderId/briefings/:briefingId/publish", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not publish briefing.", message: "Could not publish briefing." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const briefingId = String(req.params?.briefingId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({ ok: false, code: "BRIEFING_FORBIDDEN", error: "You do not have permission to publish briefings." });
    }
    try {
      const result = await withOperationTimeout(
        publishVerificationBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId),
        "briefings_publish",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, code: "BRIEFING_PUBLISH_FAILED", error: "Could not publish briefing." });
    }
  });

  app.post("/api/companies/:companyFolderId/briefings/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not clean up verification briefings." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({ ok: false, code: "BRIEFING_FORBIDDEN", error: "You do not have permission to clean up briefings." });
    }
    try {
      const result = await withOperationTimeout(
        cleanupStaleVerificationBriefings(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, req.body || {}),
        "briefings_verification_cleanup",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, code: "BRIEFING_CLEANUP_FAILED", error: "Could not clean up verification briefings." });
    }
  });

  app.post("/api/companies/:companyFolderId/briefings/:briefingId/verification-cleanup", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Could not clean up verification briefing." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const briefingId = String(req.params?.briefingId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    if (!canManageBriefings(actor)) {
      return res.status(403).json({ ok: false, code: "BRIEFING_FORBIDDEN", error: "You do not have permission to clean up briefings." });
    }
    try {
      const result = await withOperationTimeout(
        cleanupVerificationBriefing(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, briefingId, req.body || {}),
        "briefing_verification_cleanup",
        BRIEFINGS_ROUTE_TIMEOUT_MS,
      );
      if (!result.ok) {
        return briefingRouteError(res, result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, code: "BRIEFING_CLEANUP_FAILED", error: "Could not clean up verification briefing." });
    }
  });

  app.get("/api/companies/:companyFolderId/archive", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, code: "GOOGLE_AUTH_REQUIRED", error: "Please connect Google first." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...getCompanyUsersDeps() },
      companyFolderId,
      String(req.query.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }
    try {
      const debugArchive =
        String(req.query?.debugArchive || "").trim() === "1" ||
        String(req.query?.debug_archive || "").trim() === "1";
      const result = await listCompanyArchive(
        authed,
        { ...registryDeps, ...scheduleDeps, sessionDir },
        actor,
        companyFolderId,
        { debugArchive },
      );
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json(result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "ARCHIVE_LIST_FAILED",
        error: "Could not load archived records.",
        message: "Could not load archived records.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/archive", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, code: "GOOGLE_AUTH_REQUIRED", error: "Please connect Google first." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...getCompanyUsersDeps() },
      companyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }
    try {
      const result = await archiveCompanyRecord(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, req.body || {});
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json(result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "ARCHIVE_WRITE_FAILED",
        error: "Could not archive item. Try again.",
        message: "Could not archive item. Try again.",
      });
    }
  });

  app.post("/api/companies/:companyFolderId/restore", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, code: "GOOGLE_AUTH_REQUIRED", error: "Please connect Google first." });
    }
    const companyFolderId = String(req.params?.companyFolderId || "").trim();
    const actor = typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null;
    const folderDenial = await rejectCompanyApiIfFolderInvalid(
      authed,
      { ...registryDeps, ...getCompanyUsersDeps() },
      companyFolderId,
      String(req.body?.companyName || actor?.companyName || "").trim(),
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }
    try {
      const result = await restoreCompanyRecord(authed, { ...registryDeps, ...scheduleDeps }, actor, companyFolderId, req.body || {});
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json(result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "RESTORE_WRITE_FAILED",
        error: "Could not restore item. Try again.",
        message: "Could not restore item. Try again.",
      });
    }
  });

  installDocumentRoutes(app, {
    getAuthedClient,
    envConfigured,
    parseBertActorFromRequest,
    registryDeps,
    scheduleDeps,
    google,
    rejectCompanyApiIfFolderInvalid,
  });

  installHealthSafetyRoutes(app, {
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
  });

  installRiskAssessmentRoutes(app, {
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
  });
}
