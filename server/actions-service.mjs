/**
 * Folder-first corrective actions write — resolves company workbook then writes Actions tab.
 */
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";

export async function saveCompanyActions(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const actions = Array.isArray(input.actions) ? input.actions : [];
  const companyFolderId = context.companyFolderId;
  const writeFn = deps.writeCompanyActions;
  if (typeof writeFn !== "function") {
    return {
      ok: false,
      code: "ACTIONS_WRITE_UNAVAILABLE",
      error: "Actions sync is not available on this server.",
      message: "Actions sync is not available on this server.",
      httpStatus: 503,
    };
  }

  try {
    const result = await writeFn(auth, context.masterSheetId, companyFolderId, actions);
    return {
      ok: true,
      companyId: companyFolderId,
      companyFolderId,
      masterSheetId: context.masterSheetId,
      written: result?.written ?? actions.length,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    const conflict = /conflict:/i.test(technicalError);
    return {
      ok: false,
      code: conflict ? "ACTIONS_SYNC_CONFLICT" : "ACTIONS_SAVE_FAILED",
      error: conflict
        ? "This action was updated in Google Sheets while you were offline. Refresh and try again."
        : "BERT could not save these actions. Try again.",
      message: conflict
        ? "This action was updated in Google Sheets while you were offline. Refresh and try again."
        : "BERT could not save these actions. Try again.",
      technicalError,
      httpStatus: conflict ? 409 : 500,
    };
  }
}
