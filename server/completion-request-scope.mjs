/**
 * Request-scoped completion deps — single company context, tab read cache, Google op timings.
 */
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  getTabValues as workbookGetTabValues,
  getTabValuesSummary as workbookGetTabValuesSummary,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function tabReadCacheKey(spreadsheetId, tabName, suffix = "") {
  return `${trim(spreadsheetId)}|${trim(tabName)}|${suffix}`;
}

function summarizeOpsByKind(googleOps = []) {
  const byKind = {};
  for (const entry of googleOps) {
    const kind = trim(entry.kind) || "unknown";
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return byKind;
}

function countDuplicateTabReads(tabReads = []) {
  return tabReads.filter((entry) => entry.cacheHit === true).length;
}

/**
 * @param {object} baseDeps
 * @param {object} [options]
 * @param {boolean} [options.trustSessionContext]
 * @param {string} [options.masterSheetId]
 * @param {string} [options.companyFolderId]
 * @param {(entry: object) => void} [options.logGoogleOp]
 */
export function createCompletionRequestScope(baseDeps = {}, options = {}) {
  const logGoogleOp = typeof options.logGoogleOp === "function" ? options.logGoogleOp : () => {};
  const trustSessionContext = options.trustSessionContext === true;
  const requestMasterSheetId = trim(options.masterSheetId);
  const requestCompanyFolderId = trim(options.companyFolderId);

  const tabReadCache = new Map();
  const configCache = new Map();
  const stats = {
    companyResolutionCount: 0,
    tabReads: [],
    googleOps: [],
    driveStructureScans: 0,
    driveStructureScansSkipped: 0,
  };

  let cachedCompanyContext =
    options.resolvedContext?.ok === true ? { ...options.resolvedContext } : null;

  function recordGoogleOp(kind, operation, startedAt, meta = {}) {
    const entry = {
      kind,
      operation,
      durationMs: Date.now() - startedAt,
      ...meta,
    };
    stats.googleOps.push(entry);
    logGoogleOp(entry);
    return entry;
  }

  function trackTabRead(key, cacheHit) {
    stats.tabReads.push({ key, cacheHit: cacheHit === true });
  }

  function invalidateTabCache(spreadsheetId, tabName) {
    const prefix = `${trim(spreadsheetId)}|${trim(tabName)}|`;
    for (const key of tabReadCache.keys()) {
      if (key.startsWith(prefix)) {
        tabReadCache.delete(key);
      }
    }
  }

  async function cachedGetTabValues(auth, deps, spreadsheetId, tabName, range = "A1:ZZ5000") {
    const key = tabReadCacheKey(spreadsheetId, tabName, `values:${range}`);
    if (tabReadCache.has(key)) {
      trackTabRead(key, true);
      return tabReadCache.get(key);
    }
    const startedAt = Date.now();
    const fn = baseDeps.getTabValues || workbookGetTabValues;
    const values = await fn(auth, deps, spreadsheetId, tabName, range);
    tabReadCache.set(key, values);
    trackTabRead(key, false);
    recordGoogleOp("sheets_read", "get_tab_values", startedAt, {
      spreadsheetId,
      tabName,
      range,
    });
    return values;
  }

  async function cachedGetTabValuesSummary(auth, deps, spreadsheetId, tabName, rowLimit = 5000) {
    const key = tabReadCacheKey(spreadsheetId, tabName, `summary:${rowLimit}`);
    if (tabReadCache.has(key)) {
      trackTabRead(key, true);
      return tabReadCache.get(key);
    }
    const startedAt = Date.now();
    const fn = baseDeps.getTabValuesSummary || workbookGetTabValuesSummary;
    const values = await fn(auth, deps, spreadsheetId, tabName, rowLimit);
    tabReadCache.set(key, values);
    trackTabRead(key, false);
    recordGoogleOp("sheets_batch_read", "get_tab_values_summary", startedAt, {
      spreadsheetId,
      tabName,
      rowLimit,
    });
    return values;
  }

  async function wrappedReadTabRecords(auth, deps, masterSheetId, tabName, readOptions = {}) {
    const summaryOnly = readOptions.summaryOnly === true;
    const range = trim(readOptions.range) || (summaryOnly ? "summary" : "full");
    const expectedKey =
      Array.isArray(readOptions.expectedHeaders) && readOptions.expectedHeaders.length > 0
        ? readOptions.expectedHeaders.join(",")
        : "";
    const key = tabReadCacheKey(masterSheetId, tabName, `records:${summaryOnly ? "summary" : range}:${expectedKey}`);
    if (tabReadCache.has(key)) {
      trackTabRead(key, true);
      return tabReadCache.get(key);
    }
    const startedAt = Date.now();
    const fn = baseDeps.readTabRecords || workbookReadTabRecords;
    const result = await fn(auth, scopedDeps, masterSheetId, tabName, readOptions);
    tabReadCache.set(key, result);
    trackTabRead(key, false);
    recordGoogleOp(summaryOnly ? "sheets_batch_read" : "sheets_read", "read_tab_records", startedAt, {
      spreadsheetId: masterSheetId,
      tabName,
      summaryOnly,
    });
    return result;
  }

  async function wrappedEnsureTabColumns(auth, deps, spreadsheetId, tabName, expectedHeaders) {
    const startedAt = Date.now();
    const fn = baseDeps.ensureTabColumns || workbookEnsureTabColumns;
    const result = await fn(auth, scopedDeps, spreadsheetId, tabName, expectedHeaders);
    recordGoogleOp("sheets_read", "ensure_tab_columns", startedAt, {
      spreadsheetId,
      tabName,
    });
    return result;
  }

  async function wrappedAppendTabRows(auth, deps, masterSheetId, tabName, expectedHeaders, rowObjects = []) {
    const startedAt = Date.now();
    const fn = baseDeps.appendTabRows || workbookAppendTabRows;
    const result = await fn(auth, scopedDeps, masterSheetId, tabName, expectedHeaders, rowObjects);
    invalidateTabCache(masterSheetId, tabName);
    recordGoogleOp("sheets_append", "append_tab_rows", startedAt, {
      spreadsheetId: masterSheetId,
      tabName,
      rowCount: Array.isArray(rowObjects) ? rowObjects.length : 0,
    });
    return result;
  }

  async function wrappedPatchTabRowByHeader(
    auth,
    deps,
    masterSheetId,
    tabName,
    matchHeader,
    matchValue,
    updates = {},
    patchOptions = {},
  ) {
    const startedAt = Date.now();
    const fn = baseDeps.patchTabRowByHeader || workbookPatchTabRowByHeader;
    const result = await fn(auth, scopedDeps, masterSheetId, tabName, matchHeader, matchValue, updates, patchOptions);
    invalidateTabCache(masterSheetId, tabName);
    recordGoogleOp("sheets_batch_update", "patch_tab_row_by_header", startedAt, {
      spreadsheetId: masterSheetId,
      tabName,
      matchHeader,
    });
    return result;
  }

  async function wrappedResolveCompanyScheduleContext(auth, deps, resolveInput = {}) {
    if (cachedCompanyContext?.ok === true) {
      return cachedCompanyContext;
    }

    const mergedInput = {
      ...resolveInput,
      companyFolderId: trim(resolveInput.companyFolderId || resolveInput.companyId || requestCompanyFolderId),
      companyId: trim(resolveInput.companyId || resolveInput.companyFolderId || requestCompanyFolderId),
      masterSheetId: trim(resolveInput.masterSheetId || requestMasterSheetId),
      trustSessionContext: resolveInput.trustSessionContext === true || trustSessionContext,
    };

    const startedAt = Date.now();
    stats.companyResolutionCount += 1;
    const fn =
      typeof baseDeps.resolveCompanyScheduleContext === "function"
        ? baseDeps.resolveCompanyScheduleContext
        : resolveCompanyScheduleContext;
    const result = await fn(auth, scopedDeps, mergedInput);
    recordGoogleOp("company_resolve", "resolve_company_schedule_context", startedAt, {
      ok: result?.ok === true,
      contextSource: result?.contextSource,
      skippedFolderDiscovery: result?.skippedFolderDiscovery === true,
    });
    if (result?.ok === true) {
      cachedCompanyContext = result;
    }
    return result;
  }

  async function wrappedResolveCompanyFromFolder(auth, deps, companyFolderId, folderOpts = {}) {
    const masterSheetId = trim(requestMasterSheetId || cachedCompanyContext?.masterSheetId);
    if (trustSessionContext && masterSheetId) {
      const startedAt = Date.now();
      stats.driveStructureScansSkipped += 1;
      recordGoogleOp("drive_lookup", "resolve_company_from_folder_skipped", startedAt, {
        skipped: true,
        companyFolderId: trim(companyFolderId),
        masterSheetId,
      });
      return {
        ok: true,
        companyFolderId: trim(companyFolderId),
        companyId: trim(companyFolderId),
        masterSheetId,
        skippedFolderDiscovery: true,
      };
    }
    const startedAt = Date.now();
    const fn = baseDeps.resolveCompanyFromFolder;
    if (typeof fn !== "function") {
      recordGoogleOp("drive_lookup", "resolve_company_from_folder_unavailable", startedAt, {
        skipped: true,
      });
      return { ok: false, code: "FOLDER_RESOLVE_UNAVAILABLE" };
    }
    const result = await fn(auth, deps, companyFolderId, folderOpts);
    recordGoogleOp("drive_lookup", "resolve_company_from_folder", startedAt, {
      ok: result?.ok === true,
      companyFolderId: trim(companyFolderId),
    });
    return result;
  }

  async function wrappedGetConfig(auth, spreadsheetId) {
    const sheetId = trim(spreadsheetId);
    if (!sheetId || typeof baseDeps.getConfig !== "function") {
      return {};
    }
    if (configCache.has(sheetId)) {
      return configCache.get(sheetId);
    }
    const startedAt = Date.now();
    const config = await baseDeps.getConfig(auth, sheetId);
    configCache.set(sheetId, config);
    recordGoogleOp("sheets_read", "get_workbook_config", startedAt, { spreadsheetId: sheetId });
    return config;
  }

  async function wrappedEnsureCompanyFolderStructure(deps, auth, structureInput = {}) {
    const skipScan =
      trustSessionContext &&
      trim(structureInput.companyRootFolderId || structureInput.companyFolderId) &&
      trim(structureInput.masterSheetId || requestMasterSheetId);
    if (skipScan && trim(structureInput.evidencePhotosFolderId)) {
      const startedAt = Date.now();
      stats.driveStructureScansSkipped += 1;
      recordGoogleOp("drive_lookup", "ensure_company_folder_structure_skipped", startedAt, {
        skipped: true,
        evidencePhotosFolderId: trim(structureInput.evidencePhotosFolderId),
      });
      return {
        folderIds: { EVIDENCE_PHOTOS: trim(structureInput.evidencePhotosFolderId) },
        legacyRootIds: {},
      };
    }
    const startedAt = Date.now();
    stats.driveStructureScans += 1;
    const fn = baseDeps.ensureCompanyFolderStructure;
    if (typeof fn !== "function") {
      throw new Error("ensureCompanyFolderStructure is not available.");
    }
    const result = await fn(deps, auth, structureInput);
    recordGoogleOp("drive_lookup", "ensure_company_folder_structure", startedAt, {
      companyRootFolderId: trim(structureInput.companyRootFolderId),
    });
    return result;
  }

  const scopedDeps = {
    ...baseDeps,
    getTabValues: cachedGetTabValues,
    getTabValuesSummary: cachedGetTabValuesSummary,
    readTabRecords: wrappedReadTabRecords,
    ensureTabColumns: wrappedEnsureTabColumns,
    appendTabRows: wrappedAppendTabRows,
    patchTabRowByHeader: wrappedPatchTabRowByHeader,
    resolveCompanyScheduleContext: wrappedResolveCompanyScheduleContext,
    resolveCompanyFromFolder: wrappedResolveCompanyFromFolder,
    getConfig: typeof baseDeps.getConfig === "function" ? wrappedGetConfig : baseDeps.getConfig,
    ensureCompanyFolderStructure:
      typeof baseDeps.ensureCompanyFolderStructure === "function"
        ? wrappedEnsureCompanyFolderStructure
        : baseDeps.ensureCompanyFolderStructure,
    completionRequestScope: {
      getStats: () => ({
        companyResolutionCount: stats.companyResolutionCount,
        tabReads: [...stats.tabReads],
        duplicateTabReads: countDuplicateTabReads(stats.tabReads),
        googleOps: [...stats.googleOps],
        googleOpCount: stats.googleOps.length,
        googleOpsByKind: summarizeOpsByKind(stats.googleOps),
        driveStructureScans: stats.driveStructureScans,
        driveStructureScansSkipped: stats.driveStructureScansSkipped,
      }),
      getResolvedContext: () => (cachedCompanyContext?.ok === true ? { ...cachedCompanyContext } : null),
    },
  };

  function getSummary() {
    const resolved = scopedDeps.completionRequestScope.getStats();
    return {
      ...resolved,
      hasResolvedCompanyContext: cachedCompanyContext?.ok === true,
      masterSheetId: cachedCompanyContext?.masterSheetId || requestMasterSheetId || undefined,
    };
  }

  scopedDeps.completionRequestScope.recordGoogleOp = (kind, operation, startedAt, meta = {}) =>
    recordGoogleOp(kind, operation, startedAt, meta);

  let skippedOpsLogged = false;

  function logSkippedOps(traceMeta = {}) {
    if (skippedOpsLogged) {
      return;
    }
    skippedOpsLogged = true;
    const skippedAt = Date.now();
    recordGoogleOp("schedule_update", "update_schedule_status", skippedAt, {
      ...traceMeta,
      skipped: true,
      reason: "completion_derived_from_audit_results",
    });
    recordGoogleOp("notification", "completion_notification", skippedAt, {
      ...traceMeta,
      skipped: true,
      reason: "not_used_by_complete_check_path",
    });
  }

  return {
    deps: scopedDeps,
    getSummary,
    logSkippedOps,
  };
}

export { countDuplicateTabReads, summarizeOpsByKind };
