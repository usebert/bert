/**
 * Godmode service — selected company context; same Users/Schedules tabs as company users.
 */
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { listCompanyProfiles } from "./company-users-foundation.mjs";
import { listCompanySchedules } from "./schedule-service.mjs";
import { listAuditResults } from "./completion-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

/** Resolve Godmode-selected company folder → workbook context. */
export async function resolveGodmodeCompanyContext(auth, deps, companyFolderId, options = {}) {
  return resolveCompanyFromFolder(auth, deps, companyFolderId, {
    ...options,
    requestedBy: trim(options.requestedBy) || "godmode",
  });
}

/** Active users from company workbook Users tab (no PasswordHash). */
export async function listGodmodeCompanyUsers(auth, deps, context = {}) {
  const companyFolderId = trim(context.companyFolderId || context.companyId);
  const masterSheetId = trim(context.masterSheetId);
  return listCompanyProfiles(auth, deps, {
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId,
    companyName: trim(context.companyName),
    sessionActor: context.sessionActor,
    signedInEmail: context.signedInEmail,
  });
}

/** Schedules from company workbook Schedules tab. */
export async function listGodmodeCompanySchedules(auth, deps, context = {}) {
  const companyFolderId = trim(context.companyFolderId || context.companyId);
  return listCompanySchedules(auth, deps, {
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId: trim(context.masterSheetId),
    companyName: trim(context.companyName),
  });
}

/** AuditResults from company workbook for Godmode visibility. */
export async function listGodmodeCompanyAuditResults(auth, deps, context = {}) {
  return listAuditResults(auth, deps, {
    companyFolderId: trim(context.companyFolderId || context.companyId),
    companyId: trim(context.companyId || context.companyFolderId),
    masterSheetId: trim(context.masterSheetId),
  });
}
