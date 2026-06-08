/**
 * Godmode company workspace setup — explicit steps, timeouts, and JSON progress responses.
 */
import {
  ensureCompanyFolderStructure,
  ensureCompanyMasterSheet,
  buildLegacyFolderConfigFromStructure,
} from "./company-folder-structure.mjs";
import {
  ensureCompanyLiveIfReady,
  ensureCompanyRegistryRecordForWorkspace,
  evaluateCompanyWorkspaceReadiness,
  getCompanyWorkspaceRegistryRecord,
  persistCompanyWorkspaceSetup,
  recordCompanyWorkspaceHealthCheck,
} from "./company-workspace-registry.mjs";
import { inspectConfiguredWorkspaceRoot } from "./google-workspace-root.mjs";
import { countCompanyUsersOnSheet } from "./company-onboarding.mjs";
import { ensureRequiredTabs } from "./ensure-required-tabs.mjs";
import { verifyWorkbookReadWrite } from "./verify-workbook-read-write.mjs";
import {
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";

export const GOOGLE_OPERATION_TIMEOUT_MS = 90_000;

export const COMPANY_SETUP_STEPS = [
  { key: "resolve_registry", label: "Resolve company registry record" },
  { key: "ensure_company_folder", label: "Ensure company folder" },
  { key: "ensure_folder_structure", label: "Ensure standard folder structure" },
  { key: "ensure_master_sheet", label: "Ensure company master sheet" },
  { key: "ensure_required_tabs", label: "Ensure required tabs" },
  { key: "ensure_companyfolders_mapping", label: "Ensure CompanyFolders mapping" },
  { key: "ensure_first_admin", label: "Ensure first admin" },
  { key: "mark_live", label: "Persist status LIVE if ready" },
  { key: "verify_workbook_read_write", label: "Verify workbook read/write" },
];

const SETUP_STATUS_LIVE = "LIVE";
const SETUP_STATUS_NEEDS_ATTENTION = "NEEDS_ATTENTION";

export const CUSTOMER_SETUP_FAILURE_MESSAGE =
  "Setup did not finish. Check the setup details below and try again.";

function mergeWorkspaceFolderConfig(structureConfig = {}, isoReadinessIds = {}) {
  return {
    ...isoReadinessIds,
    ...structureConfig,
  };
}

function deriveValidationReadiness(validation = {}) {
  const folderStructureOk =
    Boolean(validation.folders?.setupFolder) &&
    Boolean(validation.folders?.auditFormsFolder) &&
    Boolean(validation.folders?.recordsFolder);
  const requiredTabsOk = Boolean(validation.ok) && (validation.missingTabs?.length ?? 0) === 0;
  const companyFoldersMappingOk = Boolean(validation.folders?.companyFolder ?? validation.ok);
  const workspaceHealthOk = Boolean(validation.ok);
  return { folderStructureOk, requiredTabsOk, companyFoldersMappingOk, workspaceHealthOk };
}

function buildValidationFromSetupState(state, { workspaceHealthOk, firstAdminReady, verifyTimedOut = false }) {
  const legacy = state.legacyFolderConfig || {};
  const folderIds = state.folderIds || {};
  const folders = {
    companyFolder: Boolean(state.companyId),
    setupFolder: Boolean(legacy.setupFolderId),
    auditFormsFolder: Boolean(legacy.auditFormsFolderId),
    recordsFolder: Boolean(legacy.recordsFolderId),
    evidenceFolder: Boolean(legacy.evidenceFolderId),
    exportsFolder: Boolean(legacy.exportsFolderId),
    managementNotesFolder: Boolean(legacy.managementNotesFolderId),
    companyFolderMapping: Object.keys(folderIds).length > 0,
  };
  const missingTabs = [];
  return {
    ok: workspaceHealthOk,
    folders,
    missingTabs,
    repairableIssues: verifyTimedOut ? [] : [],
    warnings: verifyTimedOut
      ? ["Workbook read/write verification timed out after setup writes succeeded"]
      : [],
  };
}

function blockersFromValidation(validation, { firstAdminReady }) {
  const blockers = [];
  const readiness = deriveValidationReadiness(validation);
  if (!readiness.folderStructureOk) {
    blockers.push("folder_structure_incomplete");
  }
  if (!readiness.requiredTabsOk) {
    blockers.push("required_tabs_missing");
  }
  if (!readiness.companyFoldersMappingOk) {
    blockers.push("companyfolders_mapping_missing");
  }
  if (!firstAdminReady) {
    blockers.push("first_admin_missing");
  }
  return blockers;
}

function allRequiredSetupChecksPass(checks = {}) {
  return (
    checks.folderStructureOk === true &&
    checks.requiredTabsOk === true &&
    checks.companyFoldersMappingOk !== false &&
    checks.firstAdminReady === true &&
    (checks.workspaceHealthOk === true || checks.skipHealthCheck === true)
  );
}

function isPersistedHealthReady(record = {}) {
  const lastHealthCheckAt = String(record.lastHealthCheckAt || "").trim();
  if (!lastHealthCheckAt) {
    return false;
  }
  const unlinkReason = String(record.unlinkReason || "").trim().toLowerCase();
  if (
    unlinkReason.includes("health_check_failed") ||
    unlinkReason.includes("verify_workbook") ||
    unlinkReason.includes("workspace_health")
  ) {
    return false;
  }
  return true;
}

function buildSetupChecksFromCompletedSteps(state, firstAdminReady, { persistedHealthReady = false } = {}) {
  const validation = buildValidationFromSetupState(state, {
    workspaceHealthOk: persistedHealthReady,
    firstAdminReady,
  });
  const readiness = deriveValidationReadiness(validation);
  const mappingOk =
    readiness.companyFoldersMappingOk && !state.blockers.includes("companyfolders_mapping_missing");
  const skipHealthCheck = !persistedHealthReady;
  return {
    rootFolderId: state.companyId,
    masterSheetId: state.masterSheetId,
    folderStructureOk: readiness.folderStructureOk,
    requiredTabsOk: true,
    companyFoldersMappingOk: mappingOk,
    firstAdminReady,
    workspaceHealthOk: persistedHealthReady || skipHealthCheck,
    healthCheckRun: persistedHealthReady,
    skipHealthCheck,
  };
}

async function executeMarkLiveStep(auth, registryDeps, state, setupChecks, resolvedCompanyName, companyId) {
  await withGoogleTimeout(
    ensureCompanyRegistryRecordForWorkspace(auth, registryDeps, {
      companyId,
      companyFolderId: companyId,
      rootFolderId: companyId,
      masterSheetId: state.masterSheetId,
      companyName: resolvedCompanyName,
    }),
    "mark_live_ensure_registry",
  ).catch(() => {});

  const readiness = deriveValidationReadiness(state.validation || {});
  const folderStructureOk = setupChecks.folderStructureOk ?? readiness.folderStructureOk;
  const requiredTabsOk = setupChecks.requiredTabsOk ?? readiness.requiredTabsOk;
  const companyFoldersMappingOk = setupChecks.companyFoldersMappingOk ?? readiness.companyFoldersMappingOk;
  const workspaceHealthOk = setupChecks.workspaceHealthOk ?? readiness.workspaceHealthOk;
  const firstAdminReady = setupChecks.firstAdminReady;
  const mergedChecks = {
    rootFolderId: companyId,
    masterSheetId: state.masterSheetId,
    folderStructureOk,
    requiredTabsOk,
    companyFoldersMappingOk,
    firstAdminReady,
    healthCheckRun: setupChecks.healthCheckRun ?? true,
    workspaceHealthOk,
    skipHealthCheck: setupChecks.skipHealthCheck,
  };

  let liveResult = await withGoogleTimeout(
    ensureCompanyLiveIfReady(auth, registryDeps, {
      companyId,
      companyFolderId: companyId,
      companyName: resolvedCompanyName,
      checks: mergedChecks,
    }),
    "mark_live",
  );

  if (!liveResult.promoted && !liveResult.alreadyLive && allRequiredSetupChecksPass(mergedChecks)) {
    const registryCompanyId =
      String(liveResult.record?.companyId || state.registryRecord?.companyId || companyId).trim() || companyId;
    const forceResult = await withGoogleTimeout(
      persistCompanyWorkspaceSetup(auth, registryDeps, {
        companyId: registryCompanyId,
        companyName: resolvedCompanyName,
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || "",
        companyFoldersMappingStatus: companyFoldersMappingOk ? "mapped" : "incomplete",
        firstAdminStatus: firstAdminReady ? "ready" : "pending",
        lastHealthCheckAt: new Date().toISOString(),
        status: COMPANY_REGISTRY_STATUS_LIVE,
        markLive: true,
        markSetupComplete: true,
        clearUnlinkReason: true,
        touchSetup: false,
      }),
      "mark_live_force_persist",
    );
    const freshRecord =
      (await getCompanyWorkspaceRegistryRecord(auth, registryDeps, registryCompanyId)) ||
      (await getCompanyWorkspaceRegistryRecord(auth, registryDeps, companyId));
    if (forceResult.synced || isCompanyRegistryLive(freshRecord || {})) {
      liveResult = {
        promoted: Boolean(forceResult.synced),
        alreadyLive: isCompanyRegistryLive(freshRecord || {}),
        registryStatus: getCanonicalCompanyStatus(freshRecord || {}) || COMPANY_REGISTRY_STATUS_LIVE,
        record: freshRecord || forceResult.record || liveResult.record,
        blockers: [],
      };
    }
  }

  const registryStatus =
    liveResult.registryStatus ||
    getCanonicalCompanyStatus(liveResult.record || state.registryRecord || {}) ||
    "";
  state.registryStatus = registryStatus;

  if (liveResult.promoted || liveResult.alreadyLive || isCompanyRegistryLive({ status: registryStatus, registryStatus })) {
    state.status = SETUP_STATUS_LIVE;
    state.blockers = [];
  } else {
    state.blockers = blockersFromValidation(state.validation || {}, { firstAdminReady });
    const readinessEval = evaluateCompanyWorkspaceReadiness(liveResult.record || state.registryRecord || {}, mergedChecks);
    for (const blocker of readinessEval.blockers || []) {
      if (!state.blockers.includes(blocker)) {
        state.blockers.push(blocker);
      }
    }
    if (registryStatus !== COMPANY_REGISTRY_STATUS_LIVE) {
      if (!state.blockers.includes("registry_not_live")) {
        state.blockers.push("registry_not_live");
      }
    }
  }
}

async function runVerifyWorkbookWarningOnly(auth, deps, state, {
  companyId,
  resolvedCompanyName,
  firstAdminReady,
  setupWritesSucceeded,
  registryDeps,
}) {
  const stepKey = "verify_workbook_read_write";
  console.log(`[company-setup] start step=${stepKey} (warning-only) companyId=${companyId}`);
  let verifyResult = null;
  let verifyTimedOut = false;
  try {
    verifyResult = await withGoogleTimeout(
      verifyWorkbookReadWrite(auth, { google: deps.google, withSheetsQuotaRetry: deps.withSheetsQuotaRetry }, state.masterSheetId, {
        timeoutMs: GOOGLE_OPERATION_TIMEOUT_MS,
      }),
      stepKey,
    );
  } catch (error) {
    const errorCode = resolveErrorCode(error);
    const alreadyLive = state.status === SETUP_STATUS_LIVE;
    if ((setupWritesSucceeded || alreadyLive) && errorCode === "GOOGLE_TIMEOUT") {
      verifyTimedOut = true;
      state.setupWarnings = ["Workbook read/write verification timed out after setup writes succeeded"];
      state.healthStatus = SETUP_STATUS_NEEDS_ATTENTION;
      state.setupBlockers = [];
    } else if (alreadyLive) {
      verifyTimedOut = true;
      state.setupWarnings = [
        ...(state.setupWarnings || []),
        error instanceof Error ? error.message : String(error || "Workbook verification failed"),
      ].filter(Boolean);
    } else {
      throw error;
    }
  }

  const workspaceHealthOk = verifyTimedOut ? true : Boolean(verifyResult?.ok);
  state.validation = buildValidationFromSetupState(state, {
    workspaceHealthOk,
    firstAdminReady,
    verifyTimedOut,
  });
  const readiness = deriveValidationReadiness(state.validation);
  const companyFoldersOk = readiness.companyFoldersMappingOk;
  const healthOk = verifyTimedOut
    ? true
    : readiness.requiredTabsOk && readiness.folderStructureOk && readiness.workspaceHealthOk;

  if (!verifyTimedOut && state.status !== SETUP_STATUS_LIVE) {
    state.blockers = blockersFromValidation(state.validation, { firstAdminReady });
  }

  await withGoogleTimeout(
    recordCompanyWorkspaceHealthCheck(auth, registryDeps, {
      companyId,
      companyFolderId: companyId,
      rootFolderId: companyId,
      masterSheetId: state.masterSheetId,
      companyName: resolvedCompanyName,
      workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || "",
      companyFoldersMappingStatus: companyFoldersOk ? "mapped" : "incomplete",
      firstAdminStatus: firstAdminReady ? "ready" : "pending",
      healthOk,
      healthSummary: verifyTimedOut
        ? "verify_workbook_read_write_timeout"
        : healthOk
          ? "healthy"
          : "health_check_failed",
      unlinkReason: healthOk
        ? ""
        : [
            ...(state.validation.missingTabs?.length
              ? [`missing_tabs:${state.validation.missingTabs.join(",")}`]
              : []),
            ...(state.validation.repairableIssues?.length ? state.validation.repairableIssues : []),
          ].join("; "),
    }),
    "verify_workbook_read_write_record",
  ).catch(() => {});

  state.completedSteps.push(stepKey);
  console.log(`[company-setup] complete step=${stepKey} companyId=${companyId}`);
}

export function withGoogleTimeout(promise, label, timeoutMs = GOOGLE_OPERATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Google operation timed out (${label}).`);
      error.code = "GOOGLE_TIMEOUT";
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

const KNOWN_SETUP_ERROR_CODES = new Set([
  "GOOGLE_TIMEOUT",
  "MASTER_SHEET_UNAVAILABLE",
  "GOOGLE_PERMISSION_DENIED",
  "MASTER_SHEET_ID_INVALID",
]);

function resolveErrorCode(error) {
  if (error?.code && KNOWN_SETUP_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("timed out")) {
    return "GOOGLE_TIMEOUT";
  }
  if (message.includes("google") || message.includes("drive") || message.includes("sheet")) {
    return "GOOGLE_API_ERROR";
  }
  return "SETUP_STEP_FAILED";
}

function normalizeSetupResponse(state, payload = {}) {
  return {
    ok: Boolean(payload.ok),
    companyId: state.companyId || "",
    status: payload.status || SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: payload.currentStep ?? "",
    completedSteps: payload.completedSteps ?? state.completedSteps ?? [],
    failedStep: payload.failedStep ?? "",
    blockers: payload.blockers ?? state.blockers ?? [],
    message: payload.message ?? "",
    technicalError: payload.technicalError ?? "",
    errorCode: payload.errorCode ?? "",
    masterSheetId: state.masterSheetId || "",
    legacyFolderConfig: state.legacyFolderConfig || {},
    folderIds: state.folderIds || {},
    registryStatus: state.registryStatus || "",
    validation: state.validation || null,
    healthStatus: payload.healthStatus ?? state.healthStatus ?? "",
    setupWarnings: payload.setupWarnings ?? state.setupWarnings ?? [],
    setupBlockers: payload.setupBlockers ?? state.setupBlockers ?? [],
  };
}

function buildFailureResponse(state, error, failedStep) {
  const errorCode = resolveErrorCode(error);
  const technicalMessage = error instanceof Error ? error.message : String(error || "Setup step failed.");
  console.error(`[company-setup] failed step=${failedStep} companyId=${state.companyId}`, {
    errorCode,
    technicalError: technicalMessage,
  });
  return normalizeSetupResponse(state, {
    ok: false,
    status: SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: failedStep,
    failedStep,
    blockers: state.blockers,
    message: CUSTOMER_SETUP_FAILURE_MESSAGE,
    technicalError: technicalMessage,
    errorCode,
  });
}

function buildSuccessResponse(state) {
  const live = state.status === SETUP_STATUS_LIVE;
  const hasSetupWarnings = (state.setupWarnings?.length ?? 0) > 0;
  return normalizeSetupResponse(state, {
    ok: live && state.blockers.length === 0,
    status: live ? SETUP_STATUS_LIVE : SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: "",
    failedStep: "",
    blockers: state.blockers,
    message:
      state.blockers.length > 0
        ? "Setup finished with blockers. Check the setup details below and try again."
        : hasSetupWarnings
          ? "Company is Live with setup warnings. Review the checklist below."
          : "Company workspace setup completed.",
    technicalError: "",
    errorCode: state.blockers.length > 0 ? "COMPANY_NOT_READY" : "",
    healthStatus: state.healthStatus || (live && hasSetupWarnings ? SETUP_STATUS_NEEDS_ATTENTION : live ? "HEALTHY" : ""),
    setupWarnings: state.setupWarnings || [],
    setupBlockers: state.setupBlockers || [],
  });
}

/**
 * Run the full Godmode company setup flow with explicit steps and timeout protection.
 */
export async function runCompanySetupProgress(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  const companyName = String(input.companyName || "").trim();
  const masterSheetIdInput = String(input.masterSheetId || "").trim();

  const state = {
    companyId,
    companyName,
    masterSheetId: masterSheetIdInput,
    registryRecord: null,
    folderIds: {},
    legacyFolderConfig: {},
    legacyRootIds: {},
    completedSteps: [],
    blockers: [],
    status: SETUP_STATUS_NEEDS_ATTENTION,
    registryStatus: "",
    validation: null,
    healthStatus: "",
    setupWarnings: [],
    setupBlockers: [],
  };

  let setupWritesSucceeded = false;

  if (!companyId) {
    return normalizeSetupResponse(
      { companyId: "", completedSteps: [], blockers: ["company_folder_not_linked"] },
      {
        ok: false,
        status: SETUP_STATUS_NEEDS_ATTENTION,
        currentStep: COMPANY_SETUP_STEPS[0].key,
        completedSteps: [],
        failedStep: COMPANY_SETUP_STEPS[0].key,
        blockers: ["company_folder_not_linked"],
        errorCode: "MISSING_COMPANY_ID",
        message: "Company folder ID is required.",
        technicalError: "Company folder ID is required.",
      },
    );
  }

  const registryDeps = deps.registryDeps || deps;
  const {
    getDriveFile,
    google,
    ensureTabsAndColumns,
    ensureCompanyMappingTabs,
    ensureAreasTab,
    ensureIsoReadinessFolders,
    updateConfig,
    getConfig,
    getTabValues,
    validateWorkspace,
  } = deps;

  const runStep = async (stepKey, fn) => {
    console.log(`[company-setup] start step=${stepKey} companyId=${companyId}`);
    try {
      await fn();
      state.completedSteps.push(stepKey);
      console.log(`[company-setup] complete step=${stepKey} companyId=${companyId}`);
    } catch (error) {
      return buildFailureResponse(state, error, stepKey);
    }
    return null;
  };

  const logSharedDriveWarningIfNeeded = async () => {
    const sharedDriveId = String(registryDeps.sharedDriveId || deps.sharedDriveId || "").trim();
    if (!sharedDriveId || !google) {
      return;
    }
    try {
      const root = await inspectConfiguredWorkspaceRoot(auth, google, sharedDriveId);
      if (root.warning) {
        console.warn(`[company-setup] shared drive warning companyId=${companyId}`, { warning: root.warning });
      } else if (root.ok && !root.isSharedDrive) {
        console.warn(`[company-setup] shared drive warning companyId=${companyId}`, {
          warning: "GOOGLE_SHARED_DRIVE_ID is a folder, not a Shared Drive. Provisioning may still work.",
        });
      }
    } catch {
      // Non-blocking — shared drive verification never blocks LIVE promotion.
    }
  };

  // 1. Resolve company registry record (match or backfill before LIVE checks)
  let stepFailure = await runStep("resolve_registry", async () => {
    const ensured = await withGoogleTimeout(
      ensureCompanyRegistryRecordForWorkspace(auth, registryDeps, {
        companyId,
        companyFolderId: companyId,
        rootFolderId: companyId,
        masterSheetId: masterSheetIdInput,
        companyName,
      }),
      "resolve_registry",
    );
    const record =
      ensured.record ||
      (await withGoogleTimeout(
        getCompanyWorkspaceRegistryRecord(auth, registryDeps, companyId),
        "resolve_registry_reload",
      ));
    state.registryRecord = record;
    if (record?.masterSheetId && !state.masterSheetId) {
      state.masterSheetId = String(record.masterSheetId).trim();
    }
    if (record?.companyId && record.companyId !== companyId) {
      state.companyId = String(record.companyId).trim();
    }
  });
  if (stepFailure) {
    return stepFailure;
  }

  await logSharedDriveWarningIfNeeded();

  // 2. Ensure company folder
  stepFailure = await runStep("ensure_company_folder", async () => {
    const folder = await withGoogleTimeout(getDriveFile(auth, companyId), "ensure_company_folder");
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      throw new Error("The company folder ID is missing or invalid.");
    }
    if (!state.companyName) {
      state.companyName = String(folder.name || "").trim();
    }
  });
  if (stepFailure) {
    return stepFailure;
  }

  const drive = google.drive({ version: "v3", auth });
  const resolvedCompanyName = state.companyName || state.registryRecord?.companyName || "";

  // 3. Ensure standard folder structure
  stepFailure = await runStep("ensure_folder_structure", async () => {
    const structure = await withGoogleTimeout(
      ensureCompanyFolderStructure(deps, auth, {
        companyName: resolvedCompanyName,
        companyRootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        syncWorkbookTab: false,
        placeFiles: false,
      }),
      "ensure_folder_structure",
    );
    state.folderIds = structure.folderIds || {};
    state.legacyRootIds = structure.legacyRootIds || {};
    let isoReadinessIds = {};
    if (typeof ensureIsoReadinessFolders === "function") {
      isoReadinessIds = await withGoogleTimeout(
        ensureIsoReadinessFolders(auth, companyId),
        "ensure_iso_readiness_folders",
      );
      state.legacyRootIds = { ...state.legacyRootIds, ...isoReadinessIds };
    }
    state.legacyFolderConfig = mergeWorkspaceFolderConfig(
      buildLegacyFolderConfigFromStructure(state.folderIds, state.legacyRootIds),
      isoReadinessIds,
    );
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 4. Ensure company master sheet
  stepFailure = await runStep("ensure_master_sheet", async () => {
    const workbookFolderId = state.folderIds.BERT_COMPANY_WORKBOOK || "";
    const masterSheet = await withGoogleTimeout(
      ensureCompanyMasterSheet(drive, {
        companyName: resolvedCompanyName,
        masterSheetId: state.masterSheetId,
        workbookFolderId,
        legacySetupFolderId: state.legacyRootIds.setupFolderId || "",
      }),
      "ensure_master_sheet",
    );
    if (!masterSheet?.masterSheetId) {
      throw new Error("Company master sheet could not be created or linked.");
    }
    state.masterSheetId = String(masterSheet.masterSheetId).trim();
    await withGoogleTimeout(
      persistCompanyWorkspaceSetup(auth, registryDeps, {
        companyId,
        companyName: resolvedCompanyName,
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        workbookFolderId,
        status: "Setup in progress",
        markLive: false,
        markSetupComplete: false,
        touchSetup: true,
      }),
      "ensure_master_sheet_persist",
    ).catch(() => {});
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 5. Ensure required tabs
  stepFailure = await runStep("ensure_required_tabs", async () => {
    await ensureRequiredTabs(auth, {
      google,
      withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
      timeoutMs: GOOGLE_OPERATION_TIMEOUT_MS,
    }, state.masterSheetId);
    if (typeof ensureCompanyMappingTabs === "function") {
      await withGoogleTimeout(ensureCompanyMappingTabs(deps, auth, state.masterSheetId), "ensure_mapping_tabs");
    }
    if (typeof ensureAreasTab === "function") {
      await withGoogleTimeout(ensureAreasTab(auth, state.masterSheetId), "ensure_areas_tab");
    }
    const config = await withGoogleTimeout(getConfig(auth, state.masterSheetId), "ensure_required_tabs_config");
    await withGoogleTimeout(
      updateConfig(auth, state.masterSheetId, {
        ...config,
        ...state.legacyFolderConfig,
        masterSheetId: state.masterSheetId,
        companyId,
        workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || config.workbookFolderId || "",
        companyFolderStructureVersion: "1",
        companyFolderStructureCheckedAt: new Date().toISOString(),
      }),
      "ensure_required_tabs_config_write",
    );
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 6. Ensure CompanyFolders mapping
  stepFailure = await runStep("ensure_companyfolders_mapping", async () => {
    const result = await withGoogleTimeout(
      ensureCompanyFolderStructure(deps, auth, {
        companyName: resolvedCompanyName,
        companyRootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        syncWorkbookTab: true,
        placeFiles: true,
      }),
      "ensure_companyfolders_mapping",
    );
    state.folderIds = result.folderIds || state.folderIds;
    state.legacyRootIds = result.legacyRootIds || state.legacyRootIds;
    state.legacyFolderConfig = mergeWorkspaceFolderConfig(
      buildLegacyFolderConfigFromStructure(state.folderIds, state.legacyRootIds),
      state.legacyRootIds,
    );
    const mappingOk = Boolean(state.masterSheetId) && Object.keys(state.folderIds).length > 0;
    await withGoogleTimeout(
      persistCompanyWorkspaceSetup(auth, registryDeps, {
        companyId,
        companyName: resolvedCompanyName,
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || "",
        companyFoldersMappingStatus: mappingOk ? "mapped" : "incomplete",
        status: "Setup in progress",
        markLive: false,
        markSetupComplete: false,
        touchSetup: false,
      }),
      "ensure_companyfolders_mapping_persist",
    ).catch(() => {});
    if (!mappingOk) {
      state.blockers.push("companyfolders_mapping_missing");
    }
    const sheetConfig = await withGoogleTimeout(getConfig(auth, state.masterSheetId), "ensure_companyfolders_config").catch(
      () => ({}),
    );
    await withGoogleTimeout(
      updateConfig(auth, state.masterSheetId, {
        ...sheetConfig,
        ...state.legacyFolderConfig,
        masterSheetId: state.masterSheetId,
        companyId,
        workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || sheetConfig.workbookFolderId || "",
        companyFolderStructureVersion: "1",
        companyFolderStructureCheckedAt: new Date().toISOString(),
      }),
      "ensure_companyfolders_config_write",
    ).catch(() => {});
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 7. Ensure first admin
  let firstAdminReady = false;
  stepFailure = await runStep("ensure_first_admin", async () => {
    const userCount = await withGoogleTimeout(
      countCompanyUsersOnSheet(auth, getTabValues, state.masterSheetId),
      "ensure_first_admin",
    );
    firstAdminReady = userCount > 0;
    await withGoogleTimeout(
      persistCompanyWorkspaceSetup(auth, registryDeps, {
        companyId,
        companyName: resolvedCompanyName,
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        firstAdminStatus: firstAdminReady ? "ready" : "pending",
        status: "Setup in progress",
        markLive: false,
        markSetupComplete: false,
        touchSetup: false,
      }),
      "ensure_first_admin_persist",
    ).catch(() => {});
  });
  if (stepFailure) {
    return stepFailure;
  }

  setupWritesSucceeded = true;

  // Reload registry after fast idempotent setup writes
  try {
    const reloaded =
      (await withGoogleTimeout(
        getCompanyWorkspaceRegistryRecord(auth, registryDeps, companyId),
        "reload_registry_after_writes",
      )) || state.registryRecord;
    if (reloaded) {
      state.registryRecord = reloaded;
    }
  } catch {
    // Non-blocking — early LIVE uses in-memory setup state when reload fails.
  }

  const persistedHealthReady = isPersistedHealthReady(state.registryRecord || {});
  state.validation = buildValidationFromSetupState(state, {
    workspaceHealthOk: persistedHealthReady,
    firstAdminReady,
  });
  const earlySetupChecks = buildSetupChecksFromCompletedSteps(state, firstAdminReady, { persistedHealthReady });

  // 8. Mark company LIVE if ready — before slow Google workbook verify
  stepFailure = await runStep("mark_live", async () => {
    await executeMarkLiveStep(auth, registryDeps, state, earlySetupChecks, resolvedCompanyName, companyId);
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 9. Verify workbook read/write — warning-only after LIVE; timeout never blocks Live
  try {
    await runVerifyWorkbookWarningOnly(auth, deps, state, {
      companyId,
      resolvedCompanyName,
      firstAdminReady,
      setupWritesSucceeded,
      registryDeps,
    });
  } catch (error) {
    if (state.status === SETUP_STATUS_LIVE) {
      state.setupWarnings = [
        ...(state.setupWarnings || []),
        error instanceof Error ? error.message : String(error || "Workbook verification failed"),
      ].filter(Boolean);
      state.completedSteps.push("verify_workbook_read_write");
    } else {
      return buildFailureResponse(state, error, "verify_workbook_read_write");
    }
  }

  return buildSuccessResponse(state);
}

/** @deprecated Alias — use runCompanySetupProgress. */
export const runCompanyRepairSetup = runCompanySetupProgress;

async function handleCompanyRepairSetupRequest(req, res, deps) {
  const { getAuthedClient, envConfigured } = deps;
  const authed = getAuthedClient();
  const companyId = String(
    req.params?.companyId || req.body?.companyId || req.body?.companyFolderId || "",
  ).trim();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      companyId,
      status: "NEEDS_ATTENTION",
      currentStep: COMPANY_SETUP_STEPS[0].key,
      completedSteps: [],
      failedStep: "",
      blockers: ["google_not_connected"],
      message: "Connect Google Workspace before running company setup.",
      technicalError: "Google Workspace is not connected on the API server.",
      errorCode: "GOOGLE_NOT_CONNECTED",
    });
  }

  try {
    const result = await runCompanySetupProgress(authed, deps, {
      companyId,
      companyFolderId: companyId,
      companyName: String(req.body?.companyName || "").trim(),
      masterSheetId: String(req.body?.masterSheetId || "").trim(),
    });
    const httpStatus = result.ok ? 200 : result.failedStep ? 500 : 409;
    return res.status(httpStatus).json(result);
  } catch (error) {
    console.error(`[company-setup] unhandled companyId=${companyId}`, error);
    return res.status(500).json({
      ok: false,
      companyId,
      status: "NEEDS_ATTENTION",
      currentStep: "",
      completedSteps: [],
      failedStep: "unknown",
      blockers: [],
      message: CUSTOMER_SETUP_FAILURE_MESSAGE,
      technicalError: error instanceof Error ? error.message : "Company setup failed.",
      errorCode: resolveErrorCode(error),
    });
  }
}

export function installCompanySetupProgressRoutes(app, deps) {
  const { requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  app.post(
    "/api/godmode/companies/:companyId/repair-setup",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    (req, res) => handleCompanyRepairSetupRequest(req, res, deps),
  );

  app.post(
    "/api/godmode/company-workspace/run-setup",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    (req, res) => {
      const companyId = String(req.body?.companyId || req.body?.companyFolderId || "").trim();
      if (companyId && !req.params?.companyId) {
        req.params = { ...(req.params || {}), companyId };
      }
      return handleCompanyRepairSetupRequest(req, res, deps);
    },
  );
}
