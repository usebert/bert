/**
 * Schedule builder assignee loading — Users tab ACTIVE rows only (no session fallback).
 */
import { getAssignableUsers } from "./company-users-foundation.mjs";
import { resolveCompanyContextFields } from "./company-context-service.mjs";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
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

  if (!companyFolderId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  const resolved = await resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    companyName,
  });
  masterSheetId = String(resolved.masterSheetId || masterSheetId).trim();
  companyName = String(resolved.companyName || companyName).trim();
  const resolvedCompanyId = String(resolved.companyFolderId || companyFolderId).trim();

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
    const result = await getAssignableUsers(auth, deps, {
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      masterSheetId,
      companyName,
      selectedArea,
      includeDiagnostics: true,
      sessionActor,
    });

    const assignees = Array.isArray(result.assignees) ? result.assignees : [];
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
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
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
