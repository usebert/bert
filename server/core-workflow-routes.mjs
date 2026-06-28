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
import { readTabRecords } from "./workbook-service.mjs";
import {
  canListCompanySchedules,
  getCompanySchedule,
  listCompanySchedules,
  listSchedulerAssignees,
  resolveCompanyScheduleContext,
  saveCompanySchedules,
} from "./schedule-service.mjs";
import { getReportsDashboard } from "./reports-dashboard-service.mjs";
import { BACKGROUND_SCHEDULE_SAVED_MESSAGE } from "../shared/background-jobs.mjs";
import { rejectIfCompanyFolderNotUnderCompaniesRoot } from "./company-folder-placement.mjs";
import {
  canListCompanyAuditResults,
  CHECK_COMPLETION_GOOGLE_TIMEOUT_MS,
  CHECK_COMPLETION_ROUTE_TIMEOUT_MS,
  DEFAULT_RESULTS_LIST_LIMIT,
  DEFAULT_RESULTS_LIST_SINCE_DAYS,
  getAuditResult,
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
  } = deps;

  const scheduleDeps = {
    readCompanySheetById,
    ...getCompanyUsersDeps(),
    readTabRecords,
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
      const result = await listCompanyProfiles(authed, { ...registryDeps, ...getCompanyUsersDeps(), getConfig: deps.getConfig }, {
        companyId: companyFolderId,
        companyFolderId,
        masterSheetId,
        companyName,
        sessionActor,
      });

      if (!result.ok) {
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

      await syncAuthIndexAfterUsersRead(authed, { ...registryDeps, ...getCompanyUsersDeps(), authIndex: deps.authIndex, getCompanyUsersDeps }, {
        companyId: result.companyFolderId || companyFolderId,
        companyFolderId: result.companyFolderId || companyFolderId,
        masterSheetId: result.masterSheetId || masterSheetId,
        companyName: result.companyName || companyName,
      }).catch(() => null);

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
    const companyFolderId = String(req.query.companyFolderId || actor?.companyFolderId || companyId).trim();

    try {
      const result = await listSchedulerAssignees(authed, { ...registryDeps, ...scheduleDeps }, {
        companyId,
        companyFolderId,
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

    try {
      const result = await listAssignedChecks(authed, { ...registryDeps, ...scheduleDeps }, {
        email: signedInEmail,
        companyFolderId,
        companyId: companyFolderId,
        companyName: String(actor?.companyName || "").trim(),
        masterSheetId,
        trustSessionContext,
        includeDiagnostics,
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
        code: "CHECK_SUBMIT_TIMEOUT",
        reasonCode: "REQUEST_TIMEOUT",
        error:
          "Submitting your check timed out before the server finished saving to your company workbook.",
        message:
          "Submitting your check timed out before the server finished saving to your company workbook.",
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
}
