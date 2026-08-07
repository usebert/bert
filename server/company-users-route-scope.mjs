import { isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";

const SESSION_COMPANY_MISMATCH_MESSAGE =
  "You do not have permission to access users for this company workspace.";

export function logCompanyScopeServerDiagnostic(payload = {}) {
  try {
    console.info("[user-permissions:company-scope-server]", JSON.stringify(payload));
  } catch {
    /* diagnostic must never affect request */
  }
}

function buildScopeDiagnostic({
  route,
  actor,
  sessionCompanyFolderId,
  requestedCompanyFolderId,
  requestedCompanyFolderIdRaw,
  companyFolderMatch,
  masterSheetMatch,
  httpStatus,
}) {
  return {
    route: String(route || "").trim() || undefined,
    actorRole: String(actor?.role || actor?.accessLevel || "").trim() || undefined,
    sessionCompanyFolderId: sessionCompanyFolderId || undefined,
    requestedCompanyFolderId: requestedCompanyFolderId || requestedCompanyFolderIdRaw || undefined,
    companyFolderMatch: companyFolderMatch === true,
    masterSheetMatch: masterSheetMatch === true,
    httpStatus: typeof httpStatus === "number" ? httpStatus : undefined,
  };
}

function denyScope(diagnostic, body, httpStatus = 403) {
  logCompanyScopeServerDiagnostic({ ...diagnostic, httpStatus });
  return { ok: false, httpStatus, body };
}

/**
 * Canonical company-users route scope guard.
 * Route :companyFolderId / :companyId is authoritative for company actors.
 * Never substitute the authenticated session folder when the route folder differs.
 */
export function assertCompanyUsersRouteScope(input = {}) {
  const route = String(input.route || "").trim();
  const requestedCompanyFolderIdRaw = String(input.routeCompanyFolderId || "").trim();
  const routeCompanyFolderId = sanitizeCompanyFolderId(requestedCompanyFolderIdRaw);
  const queryCompanyFolderId = sanitizeCompanyFolderId(input.queryCompanyFolderId);
  const queryMasterSheetId = sanitizeGoogleSpreadsheetId(input.queryMasterSheetId);
  const actor = input.actor || null;
  const sessionCompanyFolderId = sanitizeCompanyFolderId(actor?.companyFolderId || actor?.companyId);
  const sessionMasterSheetId = sanitizeGoogleSpreadsheetId(actor?.masterSheetId);
  const godmode = isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role });
  const isCompanyActor = actor?.kind === "company";

  const diagnosticBase = buildScopeDiagnostic({
    route,
    actor,
    sessionCompanyFolderId,
    requestedCompanyFolderId: routeCompanyFolderId,
    requestedCompanyFolderIdRaw,
    companyFolderMatch: false,
    masterSheetMatch: false,
  });

  const rawQueryFolder = String(input.queryCompanyFolderId || "").trim();
  if (rawQueryFolder) {
    if (queryCompanyFolderId && routeCompanyFolderId && queryCompanyFolderId !== routeCompanyFolderId) {
      return denyScope(diagnosticBase, {
        ok: false,
        code: "SESSION_COMPANY_MISMATCH",
        error: SESSION_COMPANY_MISMATCH_MESSAGE,
        message: SESSION_COMPANY_MISMATCH_MESSAGE,
      });
    }
    if (!queryCompanyFolderId && routeCompanyFolderId) {
      return denyScope(diagnosticBase, {
        ok: false,
        code: "SESSION_COMPANY_MISMATCH",
        error: SESSION_COMPANY_MISMATCH_MESSAGE,
        message: SESSION_COMPANY_MISMATCH_MESSAGE,
      });
    }
  }

  if (!godmode && isCompanyActor) {
    if (!requestedCompanyFolderIdRaw || !routeCompanyFolderId) {
      return denyScope(diagnosticBase, {
        ok: false,
        code: "SESSION_COMPANY_MISMATCH",
        error: SESSION_COMPANY_MISMATCH_MESSAGE,
        message: SESSION_COMPANY_MISMATCH_MESSAGE,
      });
    }

    const companyFolderMatch = Boolean(
      sessionCompanyFolderId && sessionCompanyFolderId === routeCompanyFolderId,
    );
    if (!companyFolderMatch) {
      return denyScope(
        buildScopeDiagnostic({
          route,
          actor,
          sessionCompanyFolderId,
          requestedCompanyFolderId: routeCompanyFolderId,
          requestedCompanyFolderIdRaw,
          companyFolderMatch: false,
          masterSheetMatch: false,
        }),
        {
          ok: false,
          code: "SESSION_COMPANY_MISMATCH",
          error: SESSION_COMPANY_MISMATCH_MESSAGE,
          message: SESSION_COMPANY_MISMATCH_MESSAGE,
        },
      );
    }

    if (queryMasterSheetId && sessionMasterSheetId && queryMasterSheetId !== sessionMasterSheetId) {
      return denyScope(
        buildScopeDiagnostic({
          route,
          actor,
          sessionCompanyFolderId,
          requestedCompanyFolderId: routeCompanyFolderId,
          companyFolderMatch: true,
          masterSheetMatch: false,
        }),
        {
          ok: false,
          blocker: "forbidden",
          error: "You can only access users in your own company workspace.",
        },
      );
    }

    const masterSheetMatch =
      !queryMasterSheetId || !sessionMasterSheetId || queryMasterSheetId === sessionMasterSheetId;
    const resolvedMasterSheetId = sessionMasterSheetId || queryMasterSheetId;
    const trustSessionContext = Boolean(sessionMasterSheetId && companyFolderMatch);

    logCompanyScopeServerDiagnostic(
      buildScopeDiagnostic({
        route,
        actor,
        sessionCompanyFolderId,
        requestedCompanyFolderId: routeCompanyFolderId,
        companyFolderMatch: true,
        masterSheetMatch,
        httpStatus: 200,
      }),
    );

    return {
      ok: true,
      companyFolderId: routeCompanyFolderId,
      masterSheetId: resolvedMasterSheetId,
      sessionMasterSheetId,
      trustSessionContext,
    };
  }

  const companyFolderId = routeCompanyFolderId || requestedCompanyFolderIdRaw;
  const masterSheetId = queryMasterSheetId || sessionMasterSheetId;
  const companyFolderMatch =
    !sessionCompanyFolderId || !routeCompanyFolderId || sessionCompanyFolderId === routeCompanyFolderId;
  const masterSheetMatch =
    !queryMasterSheetId || !sessionMasterSheetId || queryMasterSheetId === sessionMasterSheetId;

  logCompanyScopeServerDiagnostic(
    buildScopeDiagnostic({
      route,
      actor,
      sessionCompanyFolderId,
      requestedCompanyFolderId: routeCompanyFolderId || requestedCompanyFolderIdRaw,
      companyFolderMatch,
      masterSheetMatch,
      httpStatus: 200,
    }),
  );

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    sessionMasterSheetId,
    trustSessionContext: false,
  };
}
