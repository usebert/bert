/**
 * Schedule builder assignee loading — all active assignable company roles.
 */
import { parseRoleForClient } from "../shared/schedule-assignees.mjs";
import { getAssignableUsers } from "./company-user-service.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value ?? "").trim();
}

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function isActiveSessionActor(actor) {
  if (!actor?.email) {
    return false;
  }
  const status = String(actor.status || "active").trim().toLowerCase();
  return status === "active" || status === "";
}

function buildSessionActorAssignee(actor, companyId) {
  const email = normalizeEmail(actor.email);
  if (!email) {
    return null;
  }
  return {
    id: email,
    name: String(actor.name || email.split("@")[0] || email).trim() || email,
    role: parseRoleForClient(actor.role || actor.accessLevel || "User"),
    email,
    companyAreas: Array.isArray(actor.companyAreas) ? actor.companyAreas : [],
    areaWarning: undefined,
  };
}

function buildApiDiagnostics(baseDiagnostics = {}, context = {}) {
  const totalUsersRead = Number(baseDiagnostics.totalRows ?? 0);
  const activeUsersFound = Number(baseDiagnostics.activeCount ?? 0);
  const assignableUsersReturned = Number(baseDiagnostics.finalCount ?? context.assignableUsersReturned ?? 0);

  return {
    ...baseDiagnostics,
    currentCompanyId: String(context.companyId || baseDiagnostics.companyId || "").trim(),
    currentCompanyName: String(context.companyName || "").trim() || undefined,
    masterSheetId: String(context.masterSheetId || baseDiagnostics.masterSheetId || "").trim(),
    signedInEmail: String(context.signedInEmail || "").trim() || undefined,
    totalRowsRead: totalUsersRead,
    totalUsersRead,
    activeUsersFound,
    assignableUsersReturned,
    excludedByStatus: Number(baseDiagnostics.excludedByStatus ?? 0),
    excludedByCompany: Number(baseDiagnostics.excludedByCompany ?? 0),
    excludedByArea: Number(baseDiagnostics.excludedByArea ?? 0),
    dataSource: String(context.dataSource || "").trim() || undefined,
  };
}

export async function getScheduleAssigneesForCompany(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  let masterSheetId = String(input.masterSheetId || "").trim();
  let companyName = String(input.companyName || "").trim();
  const companyFolderId = String(input.companyFolderId || companyId).trim();
  const selectedArea = String(input.selectedArea || input.area || "").trim();
  const includeDiagnostics = input.includeDiagnostics === true;
  const sessionActor = input.sessionActor || null;
  const signedInEmail = normalizeEmail(sessionActor?.email || input.signedInEmail || "");

  let registryRecord = null;
  if (companyId) {
    registryRecord = await resolveCompanyById(auth, deps, companyId).catch(() => null);
  }

  if (!registryRecord && !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
    companyName =
      companyName ||
      String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
  }

  const resolvedCompanyId = String(
    companyFolderId ||
      registryRecord?.companyId ||
      registryRecord?.rootFolderId ||
      registryRecord?.companyFolderId ||
      companyId,
  ).trim();

  if (!masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company master sheet is not configured.",
      message: "Company master sheet is not configured.",
      httpStatus: 404,
    };
  }

  const dataSource = `company-workbook-users:${masterSheetId}`;

  try {
    const result = await getAssignableUsers(auth, masterSheetId, deps, {
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      selectedArea,
      includeDiagnostics: true,
    });

    let assignees = Array.isArray(result.assignees) ? [...result.assignees] : [];
    let warning = undefined;

    if (
      assignees.length === 0 &&
      sessionActor &&
      isActiveSessionActor(sessionActor) &&
      normalizeId(sessionActor.companyId || sessionActor.companyFolderId || "") === normalizeId(resolvedCompanyId)
    ) {
      const fallbackAssignee = buildSessionActorAssignee(sessionActor, resolvedCompanyId);
      if (fallbackAssignee && !assignees.some((item) => item.id === fallbackAssignee.id)) {
        assignees = [fallbackAssignee];
        warning = "Using signed-in user because no assignable users matched the current filters.";
      }
    }

    const diagnostics = includeDiagnostics
      ? buildApiDiagnostics(result.diagnostics, {
          companyId: resolvedCompanyId,
          companyName,
          masterSheetId,
          signedInEmail,
          assignableUsersReturned: assignees.length,
          dataSource,
        })
      : undefined;

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      assignees,
      auditors: assignees,
      diagnostics,
      warning,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);

    if (sessionActor && isActiveSessionActor(sessionActor)) {
      const fallbackAssignee = buildSessionActorAssignee(sessionActor, resolvedCompanyId);
      if (fallbackAssignee) {
        const diagnostics = includeDiagnostics
          ? buildApiDiagnostics(
              {
                totalRows: 0,
                activeCount: 1,
                finalCount: 1,
                excludedByStatus: 0,
                excludedByCompany: 0,
                excludedByArea: 0,
                companyId: resolvedCompanyId,
                masterSheetId,
                selectedArea,
              },
              {
                companyId: resolvedCompanyId,
                companyName,
                masterSheetId,
                signedInEmail,
                assignableUsersReturned: 1,
                dataSource: "session-fallback",
              },
            )
          : undefined;

        return {
          ok: true,
          companyId: resolvedCompanyId,
          companyName: companyName || undefined,
          masterSheetId,
          assignees: [fallbackAssignee],
          auditors: [fallbackAssignee],
          diagnostics,
          warning: "Using signed-in user because Users tab could not be loaded.",
        };
      }
    }

    return {
      ok: false,
      code: "USERS_TAB_READ_FAILED",
      error: "Could not load users from the company workbook.",
      message: "Could not load users from the company workbook.",
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}
