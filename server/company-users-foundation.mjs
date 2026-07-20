/**
 * BERT company users foundation — single canonical module for People, assignees, re-sync, Godmode.
 *
 * Routes and services must import listCompanyProfiles (or syncAndListActiveUsers alias) from here.
 * Never expose PasswordHash to API clients.
 */
import { migrateUsersTabColumns } from "./company-users.mjs";
import { readCompanyNameFromDriveFolder } from "./company-context-service.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { listableProfilesFromUsersTabRecords, activeProfilesFromUsersTabRecords } from "./users-tab-profiles.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";
import { buildCompanyFolderUrl, buildShareCompanyFolderHint } from "../shared/company-folder-links.mjs";
import {
  isValidCompanyFolderId,
  isValidGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";
import {
  dedupeCompanyProfileLoad,
  resolveProfileLoadDedupeKey,
} from "./company-users-profile-dedupe.mjs";

const COMPANY_USERS_LOAD_FAILED = "COMPANY_USERS_LOAD_FAILED";
const COMPANY_USERS_USER_MESSAGE = "Could not load company users.";
const GOOGLE_SHEET_ACCESS_DENIED_MESSAGE =
  "Google cannot read the company workbook. Ask your operator to share the company folder with the BERT Google connection.";
const WORKBOOK_NOT_FOUND_MESSAGE =
  "No BERT Master Sheet was found in your company Drive folder. Ask your operator to add or move the workbook into 01 - BERT System Files / Company Workbook.";
const WORKBOOK_NON_NATIVE_MESSAGE =
  "An Excel workbook was found but BERT needs a Google Sheet. Ask your operator to open the file in Google Drive and choose File → Save as Google Sheets.";
const WORKBOOK_STALE_HINT_MESSAGE =
  "The linked company workbook is missing or was moved. Sign out and back in after your operator repairs the company folder, or ask them to re-link the BERT Master Sheet.";

function trim(value) {
  return String(value ?? "").trim();
}

function uniqueIds(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const id = trim(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function looksLikeDriveId(value) {
  return isValidCompanyFolderId(value);
}

function buildDiagnostics(base = {}) {
  const companyFolderId = trim(base.companyFolderId || base.companyId);
  const companyId = trim(base.companyId || companyFolderId);
  return {
    companyId: companyId || undefined,
    companyFolderId: companyFolderId || companyId || undefined,
    companyFolderUrl: buildCompanyFolderUrl(companyFolderId || companyId) || undefined,
    companyName: trim(base.companyName) || undefined,
    masterSheetId: trim(base.masterSheetId) || undefined,
    signedInEmail: normalizeEmail(base.signedInEmail) || undefined,
    signedInRole: trim(base.signedInRole) || undefined,
    dataSource: trim(base.dataSource) || undefined,
    failedStep: trim(base.failedStep) || undefined,
    durationMs: typeof base.durationMs === "number" ? base.durationMs : undefined,
    upstreamStatus:
      typeof base.upstreamStatus === "number" && Number.isFinite(base.upstreamStatus)
        ? base.upstreamStatus
        : undefined,
    upstreamMessage: trim(base.upstreamMessage) || undefined,
    totalRowsRead: typeof base.totalRowsRead === "number" ? base.totalRowsRead : undefined,
    profilesReturned: typeof base.profilesReturned === "number" ? base.profilesReturned : undefined,
    activeOnlyCount: typeof base.activeOnlyCount === "number" ? base.activeOnlyCount : undefined,
    activeRowsFound: typeof base.activeRowsFound === "number" ? base.activeRowsFound : undefined,
    totalSheetRows: typeof base.totalRowsRead === "number" ? base.totalRowsRead : undefined,
    activeSheetUsers: typeof base.profilesReturned === "number" ? base.profilesReturned : undefined,
    cacheUsersBefore: typeof base.cacheUsersBefore === "number" ? base.cacheUsersBefore : undefined,
    cacheOnlyUsersRemoved:
      typeof base.cacheOnlyUsersRemoved === "number" ? base.cacheOnlyUsersRemoved : undefined,
    masterSheetIdsTried: Array.isArray(base.masterSheetIdsTried)
      ? uniqueIds(base.masterSheetIdsTried)
      : undefined,
    masterSheetResolutionSource: trim(base.masterSheetResolutionSource) || undefined,
  };
}

function buildFailure(reasonCode, message, diagnostics = {}, extra = {}) {
  const builtDiagnostics = buildDiagnostics(diagnostics);
  const failedStep = trim(extra.failedStep || builtDiagnostics.failedStep) || undefined;
  return {
    ok: false,
    code: COMPANY_USERS_LOAD_FAILED,
    reasonCode,
    failedStep,
    message: message || COMPANY_USERS_USER_MESSAGE,
    error: message || COMPANY_USERS_USER_MESSAGE,
    httpStatus: extra.httpStatus || 400,
    diagnostics: builtDiagnostics,
    technicalError: extra.technicalError,
  };
}

function classifyReadError(error) {
  const message = trim(error instanceof Error ? error.message : error);
  const lower = message.toLowerCase();
  const code = trim(error?.code || "");
  const upstreamStatus = Number(error?.response?.status || error?.status || 0);

  if (
    code === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
    code === "GOOGLE_PERMISSION_DENIED" ||
    code === "GOOGLE_SHEET_ACCESS_DENIED" ||
    upstreamStatus === 403 ||
    lower.includes("permission")
  ) {
    return {
      reasonCode: "GOOGLE_SHEET_ACCESS_DENIED",
      failedStep: trim(error?.failedStep) || "google_sheets_read",
      upstreamStatus: upstreamStatus || 403,
      upstreamMessage: message,
      userMessage: GOOGLE_SHEET_ACCESS_DENIED_MESSAGE,
    };
  }
  if (
    code === "GOOGLE_AUTH_FAILED" ||
    lower.includes("invalid_grant") ||
    lower.includes("invalid credentials") ||
    lower.includes("not connected")
  ) {
    return {
      reasonCode: "GOOGLE_AUTH_FAILED",
      failedStep: trim(error?.failedStep) || "connect_google",
      upstreamStatus: upstreamStatus || 401,
      upstreamMessage: message,
    };
  }
  if (code === "USERS_TAB_SCHEMA_FAILED" || lower.includes("schema repair") || lower.includes("users_tab_schema")) {
    return {
      reasonCode: "USERS_TAB_SCHEMA_FAILED",
      failedStep: trim(error?.failedStep) || "users_tab_schema_repair",
      upstreamStatus: upstreamStatus || undefined,
      upstreamMessage: message,
    };
  }
  if (code === "USERS_TAB_MISSING" || lower.includes("users tab is missing")) {
    return {
      reasonCode: "USERS_TAB_READ_FAILED",
      failedStep: trim(error?.failedStep) || "users_tab_headers",
      upstreamMessage: message,
    };
  }
  if (
    code === "MASTER_SHEET_UNAVAILABLE" ||
    upstreamStatus === 404 ||
    lower.includes("not found") ||
    lower.includes("requested entity was not found")
  ) {
    return {
      reasonCode: "COMPANY_CONTEXT_FAILED",
      failedStep: trim(error?.failedStep) || "master_sheet_resolve",
      upstreamStatus: upstreamStatus || 404,
      upstreamMessage: message,
    };
  }
  return {
    reasonCode: "USERS_TAB_READ_FAILED",
    failedStep: trim(error?.failedStep) || "google_sheets_read",
    upstreamStatus: upstreamStatus || undefined,
    upstreamMessage: message,
  };
}

function isStaleMasterSheetError(error) {
  const code = trim(error?.code);
  const message = trim(error instanceof Error ? error.message : error).toLowerCase();
  const upstreamStatus = Number(error?.upstreamStatus || error?.response?.status || error?.status || 0);
  return (
    code === "MASTER_SHEET_UNAVAILABLE" ||
    upstreamStatus === 404 ||
    message.includes("not found") ||
    message.includes("unable to parse range") ||
    message.includes("requested entity was not found")
  );
}

function logCompanyMembersLoad(payload = {}) {
  console.info("[company-members]", JSON.stringify(payload));
}

function resolveGoogleConnectedEmail(deps) {
  return trim(typeof deps?.getGoogleConnectedEmail === "function" ? deps.getGoogleConnectedEmail() : "");
}

function appendShareFolderHint(message, companyFolderId, deps) {
  const hint = buildShareCompanyFolderHint({
    companyFolderId,
    googleConnectedEmail: resolveGoogleConnectedEmail(deps),
  });
  if (!hint) {
    return message;
  }
  return `${message} ${hint}`;
}

function workbookNotFoundUserMessage(input = {}, deps) {
  const nonNativeName = trim(input.nonNativeWorkbookName);
  if (nonNativeName) {
    return `${WORKBOOK_NON_NATIVE_MESSAGE} (Found: ${nonNativeName})`;
  }
  if (input.staleSessionHint) {
    return WORKBOOK_STALE_HINT_MESSAGE;
  }
  return appendShareFolderHint(WORKBOOK_NOT_FOUND_MESSAGE, input.companyFolderId, deps);
}

function driveAccessUserMessage(companyFolderId, deps) {
  return appendShareFolderHint(GOOGLE_SHEET_ACCESS_DENIED_MESSAGE, companyFolderId, deps);
}

function logCompanyUsersTimings(stage, stageStartMs, meta = {}) {
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

export function resolveTrustedWorkbookForProfiles(companyContext = {}, deps = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const inputMasterSheetId = trim(companyContext.masterSheetId);
  const actorFolderId = trim(companyContext.sessionActor?.companyFolderId || companyContext.sessionActor?.companyId);

  if (companyContext.trustSessionContext === true && inputMasterSheetId) {
    if (actorFolderId && actorFolderId !== companyFolderId) {
      return { trusted: false, reason: "session_folder_mismatch" };
    }
    return { trusted: true, masterSheetId: inputMasterSheetId, source: "session" };
  }

  const cache = deps?.masterSheetCache;
  const cacheEntry = cache && typeof cache.getEntry === "function" ? cache.getEntry(companyFolderId) : null;
  const cachedMasterSheetId = trim(cacheEntry?.masterSheetId);
  if (cachedMasterSheetId) {
    if (inputMasterSheetId && inputMasterSheetId !== cachedMasterSheetId) {
      return { trusted: false, reason: "untrusted_sheet_mismatch" };
    }
    return { trusted: true, masterSheetId: cachedMasterSheetId, source: "cache" };
  }

  if (inputMasterSheetId) {
    return { trusted: false, reason: "untrusted_client_sheet" };
  }

  return { trusted: false, reason: "missing_trusted_sheet" };
}

async function resolveMasterSheetFromCompanyFolder(auth, deps, companyFolderId, companyName, options = {}) {
  const preferFolderResolution = options.preferFolderResolution !== false;
  const createIfMissing = options.createIfMissing === true;
  const skipRecursiveDiscovery = options.skipRecursiveDiscovery === true;
  const resolveFolderContextFn =
    typeof deps?.resolveCompanyFromFolder === "function" ? deps.resolveCompanyFromFolder : resolveCompanyFromFolder;
  try {
    const resolved = await resolveFolderContextFn(auth, deps, companyFolderId, {
      companyName,
      skipFolderPlacementCheck: true,
      preferFolderResolution,
      createIfMissing,
      ensureStructure: createIfMissing,
      skipRecursiveDiscovery,
      ensureTabsSync: false,
    });
    const folderSheetId = trim(resolved?.masterSheetId);
    if (resolved?.ok && folderSheetId) {
      return {
        ok: true,
        masterSheetId: folderSheetId,
        companyName: trim(resolved.companyName) || companyName,
        source: trim(resolved.source || resolved.masterSheet?.source) || "company_folder",
      };
    }
    const reasonCode = trim(resolved?.reasonCode);
    if (reasonCode === "GOOGLE_NOT_CONNECTED") {
      return { ok: false, reasonCode: "GOOGLE_AUTH_FAILED", resolved, masterSheet: resolved?.masterSheet };
    }
    const mappedReason =
      reasonCode === "MASTER_SHEET_MISSING" || reasonCode === "WORKBOOK_NOT_FOUND"
        ? "WORKBOOK_NOT_FOUND"
        : reasonCode || "WORKBOOK_NOT_FOUND";
    return { ok: false, reasonCode: mappedReason, resolved, masterSheet: resolved?.masterSheet };
  } catch (error) {
    const message = trim(error instanceof Error ? error.message : error).toLowerCase();
    if (message.includes("permission") || message.includes("forbidden")) {
      return { ok: false, reasonCode: "GOOGLE_SHEET_ACCESS_DENIED", error };
    }
    return { ok: false, reasonCode: "WORKBOOK_NOT_FOUND", error };
  }
}

async function readUsersTabProfilesWithRetry(auth, deps, companyCtx, options = {}) {
  const masterSheetIdsTried = uniqueIds([...(options.masterSheetIdsTried || []), companyCtx.masterSheetId]);
  try {
    const sheetResult = await readUsersTabProfiles(auth, deps, companyCtx);
    return { ok: true, sheetResult, masterSheetIdsTried, companyCtx };
  } catch (error) {
    if (!options.allowFolderRetry || !isStaleMasterSheetError(error)) {
      throw error;
    }
    const folderResolved = await resolveMasterSheetFromCompanyFolder(
      auth,
      deps,
      companyCtx.companyFolderId,
      companyCtx.companyName,
      { preferFolderResolution: true, createIfMissing: false },
    );
    const refreshedSheetId = trim(folderResolved?.masterSheetId);
    masterSheetIdsTried.push(refreshedSheetId);
    if (!folderResolved?.ok || !refreshedSheetId || refreshedSheetId === trim(companyCtx.masterSheetId)) {
      throw error;
    }
    const refreshedCtx = {
      ...companyCtx,
      masterSheetId: refreshedSheetId,
      companyName: trim(folderResolved.companyName) || companyCtx.companyName,
    };
    const sheetResult = await readUsersTabProfiles(auth, deps, refreshedCtx);
    return {
      ok: true,
      sheetResult,
      masterSheetIdsTried: uniqueIds(masterSheetIdsTried),
      companyCtx: refreshedCtx,
      resolutionSource: folderResolved.source || "company_folder_retry",
    };
  }
}

async function readUsersTabRecordsForCompany(auth, deps, companyContext = {}, options = {}) {
  const masterSheetId = trim(companyContext.masterSheetId);
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const companyName = trim(companyContext.companyName);
  const enrichedDeps = {
    ...deps,
    resolveUsersTab: deps.resolveUsersTab || resolveUsersTab,
    migrateUsersTabColumns: deps.migrateUsersTabColumns || migrateUsersTabColumns,
  };

  if (
    !options.skipUsersTabColumnMigration &&
    typeof enrichedDeps.migrateUsersTabColumns === "function" &&
    enrichedDeps.getTabValues
  ) {
    await enrichedDeps
      .migrateUsersTabColumns(auth, masterSheetId, enrichedDeps, {
        companyContext: { companyFolderId, companyId: companyFolderId, companyName, masterSheetId },
      })
      .catch(() => null);
  }

  const readResult = await readCompanyUsers(auth, masterSheetId, enrichedDeps, {
    companyFolderId,
    companyId: companyFolderId,
    companyName,
    masterSheetId,
  });
  if (!readResult?.ok || !Array.isArray(readResult.records)) {
    const error = new Error("Company workbook Users tab is missing or unreadable.");
    error.code = "USERS_TAB_READ_FAILED";
    error.failedStep = "users_tab_parse";
    throw error;
  }
  return readResult.records;
}

/**
 * Resolve company folder, workbook, and display name from a session or API actor.
 * companyFolderId === companyId everywhere.
 */
export async function resolveCompanyContextFromSession(auth, deps, session = {}) {
  const companyFolderId = trim(session.companyFolderId || session.companyId);
  return resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: session.masterSheetId,
    companyName: session.companyName || session.selectedCompanyName,
  });
}

/** @deprecated Prefer resolveCompanyContextFromSession — kept for route parity with docs. */
export const resolveCompanyContext = resolveCompanyContextFromSession;

/**
 * Read profile rows from the company workbook Users tab (header names, legacy + new schema).
 * Returns { members, totalSheetRows, profilesReturned, activeOnlyCount, ... } — never PasswordHash.
 */
export async function readUsersTabProfiles(auth, deps, companyContext = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const companyName = trim(companyContext.companyName);
  if (!auth) {
    const error = new Error("Google auth is required to read company users.");
    error.code = "USERS_TAB_READ_FAILED";
    error.reasonCode = "USERS_TAB_READ_FAILED";
    throw error;
  }
  if (!companyFolderId || !masterSheetId) {
    const error = new Error("companyFolderId and masterSheetId are required to read company users.");
    error.code = "COMPANY_CONTEXT_FAILED";
    error.reasonCode = "COMPANY_CONTEXT_FAILED";
    throw error;
  }

  const companyCtx = {
    ...companyContext,
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    companyName,
  };

  const usersTabReadStart = Date.now();
  let records = await readUsersTabRecordsForCompany(auth, deps, companyCtx, {
    skipUsersTabColumnMigration: true,
  });
  logCompanyUsersTimings("users_tab_records_read", usersTabReadStart, {
    companyFolderId,
    masterSheetId,
    rowCount: Array.isArray(records) ? records.length : 0,
  });

  const profileMapStart = Date.now();
  let result = activeProfilesFromUsersTabRecords(records, companyCtx);

  if (result.members.length === 0 && result.totalSheetRows === 0) {
    const retryReadStart = Date.now();
    records = await readUsersTabRecordsForCompany(auth, deps, companyCtx, {
      skipUsersTabColumnMigration: false,
    });
    logCompanyUsersTimings("users_tab_records_read_retry", retryReadStart, {
      companyFolderId,
      masterSheetId,
      rowCount: Array.isArray(records) ? records.length : 0,
      withColumnMigration: true,
    });
    result = activeProfilesFromUsersTabRecords(records, companyCtx);
  }
  logCompanyUsersTimings("member_profile_mapping", profileMapStart, {
    companyFolderId,
    masterSheetId,
    totalSheetRows: result.totalSheetRows,
    profilesReturned: result.members.length,
    activeOnlyCount: result.activeOnlyCount,
  });

  return result;
}

/**
 * Rebuild server company-users cache after a successful sheet read.
 */
export function syncCompanyUsersCache(deps, companyContext = {}, profiles = []) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const cache = deps?.companyUsersCache;
  if (!cache || typeof cache.rebuildCompanyUsersCache !== "function" || !companyFolderId) {
    return {
      cacheUsersBefore: 0,
      cacheOnlyUsersRemoved: 0,
      cacheOnlyEmails: [],
      keptEmails: Array.isArray(profiles) ? profiles.map((row) => trim(row.email)).filter(Boolean) : [],
    };
  }
  return cache.rebuildCompanyUsersCache(companyFolderId, profiles, { masterSheetId });
}

/**
 * Canonical ACTIVE company users — resolve folder/workbook, read Users tab, sync cache.
 * Single path: folder resolve → sheet read → ACTIVE + CompanyFolderId filter → rebuild cache.
 * Never falls back to cache/session/auth index as active-user truth.
 */
export async function listCompanyProfiles(auth, deps, companyContext = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const dedupeKey = resolveProfileLoadDedupeKey(companyContext, deps);
  const trustedSheetForMeta =
    companyContext.trustSessionContext === true ? trim(companyContext.masterSheetId) : "";
  const cacheSheet =
    deps?.masterSheetCache && typeof deps.masterSheetCache.getEntry === "function"
      ? trim(deps.masterSheetCache.getEntry(companyFolderId)?.masterSheetId)
      : "";
  return dedupeCompanyProfileLoad(
    dedupeKey,
    () => listCompanyProfilesCore(auth, deps, companyContext),
    {
      companyFolderId: companyFolderId || undefined,
      masterSheetId: trustedSheetForMeta || cacheSheet || undefined,
      dedupeKey: dedupeKey || undefined,
    },
  );
}

async function listCompanyProfilesCore(auth, deps, companyContext = {}) {
  const startedAt = Date.now();
  const sessionActor = companyContext.sessionActor || null;
  const signedInEmail = normalizeEmail(sessionActor?.email || "");
  const signedInRole = trim(sessionActor?.role || sessionActor?.accessLevel);

  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  let masterSheetId = trim(companyContext.masterSheetId);
  let companyName = trim(companyContext.companyName);
  const sessionMasterSheetId = masterSheetId;
  const masterSheetIdsTried = uniqueIds([sessionMasterSheetId]);
  let masterSheetResolutionSource = undefined;

  const baseDiagnostics = () =>
    buildDiagnostics({
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      signedInEmail,
      signedInRole,
      dataSource: "users_tab",
      durationMs: Date.now() - startedAt,
      masterSheetIdsTried,
      masterSheetResolutionSource,
    });

  if (!auth) {
    return buildFailure(
      "GOOGLE_AUTH_FAILED",
      "Please connect Google before loading company users.",
      { ...baseDiagnostics(), failedStep: "connect_google" },
      { httpStatus: 401, failedStep: "connect_google" },
    );
  }

  if (!companyFolderId) {
    return buildFailure(
      "COMPANY_CONTEXT_FAILED",
      COMPANY_USERS_USER_MESSAGE,
      { ...baseDiagnostics(), failedStep: "company_context_resolve" },
      { httpStatus: 404, failedStep: "company_context_resolve" },
    );
  }

  if (!looksLikeDriveId(companyFolderId)) {
    return buildFailure(
      "COMPANY_CONTEXT_FAILED",
      "Company workspace id is invalid.",
      { ...baseDiagnostics(), failedStep: "company_context_resolve" },
      { httpStatus: 400, failedStep: "company_context_resolve" },
    );
  }

  const driveFolderNameStart = Date.now();
  companyName = (await readCompanyNameFromDriveFolder(auth, deps, companyFolderId)) || companyName;
  logCompanyUsersTimings("drive_folder_name", driveFolderNameStart, { companyFolderId });

  let folderResolved = null;
  let resolvedMasterSheet = null;
  let nonNativeWorkbookName = "";
  masterSheetResolutionSource = "company_folder";

  const folderValidationStart = Date.now();
  const folderPlacementPromise = validateCompanyFolderUnderCompaniesRoot(auth, deps, companyFolderId, {
    companyFolderName: companyName,
  }).catch(() => ({ ok: false, reasonCode: "FOLDER_NOT_IN_COMPANIES_ROOT" }));

  const masterSheetResolveStart = Date.now();
  const trustedWorkbook = resolveTrustedWorkbookForProfiles(companyContext, deps);
  if (trustedWorkbook.trusted) {
    masterSheetId = trustedWorkbook.masterSheetId;
    masterSheetResolutionSource = trustedWorkbook.source;
    masterSheetIdsTried.push(masterSheetId);
    logCompanyUsersTimings("master_sheet_resolve", masterSheetResolveStart, {
      companyFolderId,
      ok: true,
      masterSheetId,
      source: trustedWorkbook.source,
      skippedFolderDiscovery: true,
    });
  } else {
    folderResolved = await resolveMasterSheetFromCompanyFolder(auth, deps, companyFolderId, companyName, {
      preferFolderResolution: true,
      createIfMissing: false,
      skipRecursiveDiscovery: false,
    });
    logCompanyUsersTimings("master_sheet_resolve", masterSheetResolveStart, {
      companyFolderId,
      ok: folderResolved?.ok === true,
      masterSheetId: trim(folderResolved?.masterSheetId) || undefined,
      source: trim(folderResolved?.source) || undefined,
      skippedFolderDiscovery: false,
      fallbackReason: trustedWorkbook.reason || undefined,
    });
    const folderSheetId = trim(folderResolved?.masterSheetId);
    resolvedMasterSheet = folderResolved?.resolved?.masterSheet || folderResolved?.masterSheet;
    nonNativeWorkbookName =
      trim(resolvedMasterSheet?.source) === "non_native_workbook"
        ? trim(resolvedMasterSheet?.masterSheetName)
        : "";

    masterSheetId = "";
    if (folderResolved?.ok && folderSheetId) {
      masterSheetResolutionSource = trim(folderResolved.source) || "company_folder";
      masterSheetId = folderSheetId;
      companyName = trim(folderResolved.companyName) || companyName;
      masterSheetIdsTried.push(folderSheetId);
    }
  }

  if (!masterSheetId) {
    const folderReason = trim(folderResolved?.reasonCode);
    if (folderReason === "GOOGLE_SHEET_ACCESS_DENIED") {
      return buildFailure(
        "GOOGLE_SHEET_ACCESS_DENIED",
        driveAccessUserMessage(companyFolderId, deps),
        { ...baseDiagnostics(), failedStep: "company_folder_list" },
        { httpStatus: 403, failedStep: "company_folder_list" },
      );
    }
    const staleSessionHint = Boolean(sessionMasterSheetId);
    const workbookMessage = workbookNotFoundUserMessage(
      {
        companyFolderId,
        nonNativeWorkbookName,
        staleSessionHint,
      },
      deps,
    );
    return buildFailure(
      folderReason === "WORKBOOK_NOT_FOUND" || staleSessionHint ? "COMPANY_CONTEXT_FAILED" : "COMPANY_CONTEXT_FAILED",
      workbookMessage,
      {
        ...baseDiagnostics(),
        companyName,
        failedStep: "master_sheet_resolve",
        masterSheetIdsTried: uniqueIds(masterSheetIdsTried),
      },
      { httpStatus: 404, failedStep: "master_sheet_resolve" },
    );
  }

  const resolvedCompanyId = companyFolderId;
  const companyCtx = {
    companyFolderId: resolvedCompanyId,
    companyId: resolvedCompanyId,
    companyName,
    masterSheetId,
  };

  try {
    const usersTabReadStart = Date.now();
    const readAttempt = await readUsersTabProfilesWithRetry(auth, deps, companyCtx, {
      masterSheetIdsTried,
      allowFolderRetry: true,
    });
    logCompanyUsersTimings("users_tab_read", usersTabReadStart, {
      companyFolderId: resolvedCompanyId,
      masterSheetId: trim(readAttempt.companyCtx?.masterSheetId) || masterSheetId,
      resolutionSource: readAttempt.resolutionSource || masterSheetResolutionSource,
    });
    const sheetResult = readAttempt.sheetResult;
    const resolvedCtx = readAttempt.companyCtx;
    masterSheetId = trim(resolvedCtx.masterSheetId) || masterSheetId;
    companyName = trim(resolvedCtx.companyName) || companyName;
    if (readAttempt.resolutionSource) {
      masterSheetResolutionSource = readAttempt.resolutionSource;
    }
    const triedIds = uniqueIds(readAttempt.masterSheetIdsTried || masterSheetIdsTried);
    const members = sheetResult.members;
    const cacheSyncStart = Date.now();
    const cacheStats = syncCompanyUsersCache(deps, resolvedCtx, members);
    logCompanyUsersTimings("cache_sync", cacheSyncStart, {
      companyFolderId: resolvedCompanyId,
      masterSheetId,
      cacheUsersBefore: cacheStats.cacheUsersBefore,
      cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
      profilesReturned: members.length,
    });
    const folderPlacement = await folderPlacementPromise;
    logCompanyUsersTimings("folder_validation", folderValidationStart, {
      companyFolderId: resolvedCompanyId,
      ok: folderPlacement?.ok === true,
      reasonCode: trim(folderPlacement?.reasonCode) || undefined,
    });
    const folderPlacementWarning =
      folderPlacement?.ok === false
        ? trim(folderPlacement.userMessage || folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT")
        : "";
    const placementWarning = folderPlacementWarning
      ? `Company folder placement needs attention (${folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT"}).`
      : "";

    logCompanyMembersLoad({
      companyFolderId: resolvedCompanyId,
      masterSheetId,
      dataSource: "users_tab",
      totalRowsRead: sheetResult.totalSheetRows,
      profilesReturned: members.length,
      activeOnlyCount: sheetResult.activeOnlyCount,
      cacheUsersBefore: cacheStats.cacheUsersBefore,
      cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
    });
    logCompanyUsersTimings("total", startedAt, {
      companyFolderId: resolvedCompanyId,
      masterSheetId,
      profilesReturned: members.length,
      activeOnlyCount: sheetResult.activeOnlyCount,
      masterSheetResolutionSource,
    });

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      users: members,
      activeCount: members.length,
      warning: placementWarning || undefined,
      diagnostics: buildDiagnostics({
        companyId: resolvedCompanyId,
        companyFolderId: resolvedCompanyId,
        companyName,
        masterSheetId,
        signedInEmail,
        signedInRole,
        dataSource: "users_tab",
        durationMs: Date.now() - startedAt,
        totalRowsRead: sheetResult.totalSheetRows,
        profilesReturned: members.length,
        activeOnlyCount: sheetResult.activeOnlyCount,
        cacheUsersBefore: cacheStats.cacheUsersBefore,
        cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
        masterSheetIdsTried: triedIds,
        masterSheetResolutionSource,
      }),
      cacheReconciliation: cacheStats,
    };
  } catch (error) {
    const classified = classifyReadError(error);
    const technicalError = error instanceof Error ? error.message : String(error);
    const failureMessage =
      classified.reasonCode === "COMPANY_CONTEXT_FAILED"
        ? workbookNotFoundUserMessage(
            { companyFolderId, staleSessionHint: Boolean(sessionMasterSheetId) },
            deps,
          )
        : classified.reasonCode === "GOOGLE_SHEET_ACCESS_DENIED"
          ? driveAccessUserMessage(companyFolderId, deps)
          : classified.userMessage || COMPANY_USERS_USER_MESSAGE;
    return buildFailure(
      classified.reasonCode,
      failureMessage,
      {
        ...baseDiagnostics(),
        companyName,
        masterSheetId,
        failedStep: classified.failedStep,
        upstreamStatus: classified.upstreamStatus,
        upstreamMessage: classified.upstreamMessage || technicalError,
        masterSheetIdsTried: uniqueIds(masterSheetIdsTried),
        masterSheetResolutionSource,
      },
      {
        httpStatus:
          classified.reasonCode === "GOOGLE_SHEET_ACCESS_DENIED" ||
          classified.reasonCode === "GOOGLE_PERMISSION_DENIED" ||
          classified.reasonCode === "GOOGLE_SHEETS_PERMISSION_DENIED"
            ? 403
            : classified.reasonCode === "COMPANY_CONTEXT_FAILED"
              ? 404
              : classified.reasonCode === "USERS_TAB_SCHEMA_FAILED"
                ? 502
                : 502,
        technicalError,
        failedStep: classified.failedStep,
      },
    );
  }
}

/** Backward-compatible alias — same implementation as listCompanyProfiles. */
export async function syncAndListActiveUsers(auth, deps, companyContext = {}) {
  return listCompanyProfiles(auth, deps, companyContext);
}

/**
 * Godmode — read Users tab and replace server cache (remove cache-only users).
 */
export async function rebuildUsersFromSheet(auth, deps, companyContext = {}) {
  const listed = await listCompanyProfiles(auth, deps, companyContext);
  if (!listed.ok) {
    return listed;
  }
  const reconciliation = listed.cacheReconciliation || {
    cacheUsersBefore: listed.diagnostics?.cacheUsersBefore ?? 0,
    cacheOnlyUsersRemoved: listed.diagnostics?.cacheOnlyUsersRemoved ?? 0,
    cacheOnlyEmails: [],
    keptEmails: (listed.users || []).map((row) => row.email),
  };
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    companyName: listed.companyName,
    masterSheetId: listed.masterSheetId,
    users: listed.users,
    activeCount: listed.activeCount,
    diagnostics: listed.diagnostics,
    removed: reconciliation.cacheOnlyEmails || [],
    kept: reconciliation.keptEmails || (listed.users || []).map((row) => row.email),
    cacheUsersBefore: reconciliation.cacheUsersBefore,
    cacheOnlyUsersRemoved: reconciliation.cacheOnlyUsersRemoved,
  };
}

export async function getAssignableUsers(auth, deps, companyContext = {}) {
  const companyId = trim(companyContext.companyId || companyContext.companyFolderId);
  const selectedArea = trim(companyContext.selectedArea);
  const includeDiagnostics = companyContext.includeDiagnostics === true;

  const listed = await listCompanyProfiles(auth, deps, companyContext);
  if (!listed.ok) {
    throw new Error(listed.message || listed.error || "Could not load company users.");
  }

  const mapped = (listed.users || []).map((row) => ({
    email: row.email,
    name: row.name,
    role: row.role,
    accessLevel: row.accessLevel,
    status: row.status,
    companyId: row.companyId || companyId,
    companyFolderId: row.companyFolderId || companyId,
    companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : [],
    companyAreasRaw: row.companyAreasRaw || "",
  }));

  const result = buildAvailableScheduleAssigneesFromUsers(mapped, {
    companyId,
    masterSheetId: trim(companyContext.masterSheetId),
    selectedArea,
    includeDiagnostics,
  });

  return {
    users: mapped,
    assignees: result.assignees,
    auditors: result.auditors,
    diagnostics: result.diagnostics,
  };
}
