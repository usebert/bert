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
  assertCompanyLiveForInvite,
  buildAuditorInviteBody,
  resolveCompanyUserInviteAccess,
} from "./invite-service.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { getScheduleAssigneesForCompany } from "./schedule-assignee-service.mjs";

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
  } = deps;

  const scheduleDeps = {
    readCompanySheetById,
    ...getCompanyUsersDeps(),
  };

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

      if (!isGodmode && authed) {
        const liveGate = await assertCompanyLiveForInvite(authed, registryDeps, companyId);
        if (!liveGate.ok) {
          return res.status(liveGate.httpStatus).json({
            ok: false,
            code: liveGate.code,
            error: liveGate.message,
            blocker: liveGate.code,
          });
        }
        req.body = buildAuditorInviteBody(companyId, req.body, liveGate.record);
      } else if (authed) {
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
}
