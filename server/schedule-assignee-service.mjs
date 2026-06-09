/**
 * Schedule builder assignee loading — all active assignable company roles.
 */
import { getAssignableUsers } from "./company-user-service.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";

export async function getScheduleAssigneesForCompany(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  let masterSheetId = String(input.masterSheetId || "").trim();
  const companyFolderId = String(input.companyFolderId || companyId).trim();
  const selectedArea = String(input.selectedArea || input.area || "").trim();
  const includeDiagnostics = input.includeDiagnostics === true;

  if (!masterSheetId && companyId) {
    const record = await resolveCompanyById(auth, deps, companyId).catch(() => null);
    masterSheetId = String(record?.masterSheetId || "").trim();
  }

  if (!masterSheetId) {
    return {
      ok: false,
      error: "masterSheetId is required to load schedule assignees.",
      httpStatus: 400,
    };
  }

  const result = await getAssignableUsers(auth, masterSheetId, deps, {
    companyId: companyFolderId,
    companyFolderId,
    selectedArea,
    includeDiagnostics,
  });

  return {
    ok: true,
    companyId: companyFolderId,
    companyName: String(input.companyName || "").trim() || undefined,
    masterSheetId,
    assignees: result.assignees,
    auditors: result.auditors,
    diagnostics: result.diagnostics,
  };
}
