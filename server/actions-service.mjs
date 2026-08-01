/**
 * Folder-first corrective actions — resolve company workbook, read/write Actions tab.
 */
import { resolveCompanyScheduleContext as defaultResolveCompanyScheduleContext } from "./schedule-service.mjs";
import { readTabRecords as defaultReadTabRecords } from "./workbook-service.mjs";
import {
  isActiveVerificationAction,
  isVerificationAction,
  mapWorkbookRowToAction,
  PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
} from "../shared/production-verification-action.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function resolveContext(deps) {
  return typeof deps.resolveCompanyScheduleContext === "function"
    ? deps.resolveCompanyScheduleContext
    : defaultResolveCompanyScheduleContext;
}

export async function loadCompanyActions(auth, deps, input = {}) {
  const context = await resolveContext(deps)(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const readTabRecords =
    typeof deps.readTabRecords === "function" ? deps.readTabRecords : defaultReadTabRecords;

  try {
    const tabResult = await readTabRecords(auth, deps, context.masterSheetId, "Actions", {});
    const records = Array.isArray(tabResult?.records) ? tabResult.records : [];
    const companyFolderId = context.companyFolderId;
    const actions = records
      .map((record) => mapWorkbookRowToAction(record, companyFolderId))
      .filter((action) => trim(action.id) && trim(action.companyId || companyFolderId) === companyFolderId);

    return {
      ok: true,
      companyId: companyFolderId,
      companyFolderId,
      masterSheetId: context.masterSheetId,
      actions,
    };
  } catch (error) {
    return {
      ok: false,
      code: "ACTIONS_LOAD_FAILED",
      error: "Could not load actions for this company workspace.",
      message: "Could not load actions for this company workspace.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 500,
    };
  }
}

export async function saveCompanyActions(auth, deps, input = {}) {
  const context = await resolveContext(deps)(auth, deps, input);
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

export async function cleanupVerificationAction(auth, deps, input = {}) {
  const actionId = trim(input.actionId);
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);

  if (!actionId || !companyFolderId) {
    return {
      ok: false,
      code: "CLEANUP_CONTEXT_MISSING",
      error: "Action ID and company folder are required.",
      httpStatus: 400,
    };
  }

  const loaded = await loadCompanyActions(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    trustSessionContext: input.trustSessionContext === true,
  });
  if (!loaded.ok) {
    return loaded;
  }

  const match = loaded.actions.find((action) => trim(action.id) === actionId);
  if (!match) {
    return {
      ok: false,
      code: "ACTION_NOT_FOUND",
      error: "This action was not found in your company workspace.",
      message: "This action was not found in your company workspace.",
      httpStatus: 404,
    };
  }

  if (!isVerificationAction(match)) {
    return {
      ok: false,
      code: "CLEANUP_NOT_VERIFICATION_ACTION",
      error: "Only verification actions can be cleaned up through this path.",
      message: "Only verification actions can be cleaned up through this path.",
      httpStatus: 403,
    };
  }

  const now = new Date().toISOString();
  const cleaned = {
    ...match,
    status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
    closedAt: match.closedAt || now,
    updatedAt: now,
    verificationNotes: trim(input.cleanupNote) || "Production verification action cleaned.",
  };

  const nextActions = loaded.actions.map((action) => (trim(action.id) === actionId ? cleaned : action));
  const saved = await saveCompanyActions(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: loaded.masterSheetId,
    actions: nextActions,
    trustSessionContext: input.trustSessionContext === true,
  });
  if (!saved.ok) {
    return saved;
  }

  return {
    ok: true,
    actionId,
    cleaned: true,
    status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
    companyFolderId: loaded.companyFolderId,
    masterSheetId: loaded.masterSheetId,
  };
}

export async function cleanupStaleVerificationActions(auth, deps, input = {}) {
  const loaded = await loadCompanyActions(auth, deps, input);
  if (!loaded.ok) {
    return loaded;
  }

  const stale = loaded.actions.filter((action) => isActiveVerificationAction(action));
  if (stale.length === 0) {
    return {
      ok: true,
      cleanedCount: 0,
      cleanedActionIds: [],
      companyFolderId: loaded.companyFolderId,
      masterSheetId: loaded.masterSheetId,
    };
  }

  const now = new Date().toISOString();
  const staleIds = new Set(stale.map((action) => trim(action.id)));
  const nextActions = loaded.actions.map((action) => {
    if (!staleIds.has(trim(action.id))) {
      return action;
    }
    return {
      ...action,
      status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
      closedAt: action.closedAt || now,
      updatedAt: now,
      verificationNotes: "Stale production verification action cleaned before rerun.",
    };
  });

  const saved = await saveCompanyActions(auth, deps, {
    companyFolderId: loaded.companyFolderId,
    companyId: loaded.companyFolderId,
    masterSheetId: loaded.masterSheetId,
    actions: nextActions,
    trustSessionContext: input.trustSessionContext === true,
  });
  if (!saved.ok) {
    return saved;
  }

  return {
    ok: true,
    cleanedCount: stale.length,
    cleanedActionIds: [...staleIds],
    companyFolderId: loaded.companyFolderId,
    masterSheetId: loaded.masterSheetId,
  };
}
