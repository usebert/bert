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
  evaluateCompanyWorkspaceReadiness,
  getCompanyWorkspaceRegistryRecord,
  persistCompanyWorkspaceSetup,
  recordCompanyWorkspaceHealthCheck,
} from "./company-workspace-registry.mjs";
import { inspectConfiguredWorkspaceRoot } from "./google-workspace-root.mjs";
import { countCompanyUsersOnSheet } from "./company-onboarding.mjs";
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
  { key: "verify_workbook_read_write", label: "Verify workbook read/write" },
  { key: "mark_live", label: "Persist status LIVE if ready" },
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
  if (!readiness.workspaceHealthOk) {
    blockers.push("workspace_health_failed");
  }
  return blockers;
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

function resolveErrorCode(error) {
  if (error?.code === "GOOGLE_TIMEOUT") {
    return "GOOGLE_TIMEOUT";
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
  return normalizeSetupResponse(state, {
    ok: live && state.blockers.length === 0,
    status: live ? SETUP_STATUS_LIVE : SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: "",
    failedStep: "",
    blockers: state.blockers,
    message:
      state.blockers.length > 0
        ? "Setup finished with blockers. Check the setup details below and try again."
        : "Company workspace setup completed.",
    technicalError: "",
    errorCode: state.blockers.length > 0 ? "COMPANY_NOT_READY" : "",
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
  };

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

  // 1. Resolve company registry record
  let stepFailure = await runStep("resolve_registry", async () => {
    let record = await withGoogleTimeout(
      getCompanyWorkspaceRegistryRecord(auth, registryDeps, companyId),
      "resolve_registry",
    );
    if (!record && companyId) {
      await withGoogleTimeout(
        persistCompanyWorkspaceSetup(auth, registryDeps, {
          companyId,
          companyFolderId: companyId,
          rootFolderId: companyId,
          masterSheetId: masterSheetIdInput,
          companyName,
          status: "Setup in progress",
          markLive: false,
          markSetupComplete: false,
          touchSetup: true,
        }),
        "resolve_registry_persist",
      ).catch(() => {});
      record = await withGoogleTimeout(
        getCompanyWorkspaceRegistryRecord(auth, registryDeps, companyId),
        "resolve_registry_reload",
      );
    }
    state.registryRecord = record;
    if (record?.masterSheetId && !state.masterSheetId) {
      state.masterSheetId = String(record.masterSheetId).trim();
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
    await withGoogleTimeout(
      ensureTabsAndColumns(auth, state.masterSheetId, {
        companyId,
        companyName: resolvedCompanyName,
        createBackup: true,
      }),
      "ensure_required_tabs",
    );
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

  // 8. Verify workbook read/write
  stepFailure = await runStep("verify_workbook_read_write", async () => {
    const runValidation = async () =>
      withGoogleTimeout(
        validateWorkspace(auth, {
          companyFolderId: companyId,
          sheetId: state.masterSheetId,
          setupFolderId: state.legacyFolderConfig.setupFolderId || "",
          auditFormsFolderId: state.legacyFolderConfig.auditFormsFolderId || "",
          recordsFolderId: state.legacyFolderConfig.recordsFolderId || "",
          evidenceFolderId: state.legacyFolderConfig.evidenceFolderId || "",
          exportsFolderId: state.legacyFolderConfig.exportsFolderId || "",
          managementNotesFolderId: state.legacyFolderConfig.managementNotesFolderId || "",
        }),
        "verify_workbook_read_write",
      );

    let validation = await runValidation();
    if ((validation.missingTabs?.length ?? 0) > 0 || (validation.repairableIssues?.length ?? 0) > 0) {
      await withGoogleTimeout(
        ensureTabsAndColumns(auth, state.masterSheetId, {
          companyId,
          companyName: resolvedCompanyName,
          createBackup: true,
        }),
        "verify_workbook_read_write_repair_tabs",
      );
      validation = await runValidation();
    }
    state.validation = validation;
    const readiness = deriveValidationReadiness(validation);
    const companyFoldersOk = readiness.companyFoldersMappingOk;
    const healthOk = readiness.requiredTabsOk && readiness.folderStructureOk && readiness.workspaceHealthOk;
    state.blockers = blockersFromValidation(validation, { firstAdminReady });
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
        healthSummary: healthOk ? "healthy" : "health_check_failed",
        unlinkReason: healthOk
          ? ""
          : [
              ...(validation.missingTabs?.length ? [`missing_tabs:${validation.missingTabs.join(",")}`] : []),
              ...(validation.repairableIssues?.length ? validation.repairableIssues : []),
            ].join("; "),
      }),
      "verify_workbook_read_write_record",
    ).catch(() => {});
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 9. Mark company LIVE if ready
  stepFailure = await runStep("mark_live", async () => {
    const readiness = deriveValidationReadiness(state.validation || {});
    const folderStructureOk = readiness.folderStructureOk;
    const requiredTabsOk = readiness.requiredTabsOk;
    const companyFoldersMappingOk = readiness.companyFoldersMappingOk;
    const workspaceHealthOk = readiness.workspaceHealthOk;

    const liveResult = await withGoogleTimeout(
      ensureCompanyLiveIfReady(auth, registryDeps, {
        companyId,
        companyFolderId: companyId,
        companyName: resolvedCompanyName,
        checks: {
          rootFolderId: companyId,
          masterSheetId: state.masterSheetId,
          folderStructureOk,
          requiredTabsOk,
          companyFoldersMappingOk,
          firstAdminReady,
          healthCheckRun: true,
          workspaceHealthOk,
        },
      }),
      "mark_live",
    );

    const registryStatus =
      liveResult.registryStatus ||
      getCanonicalCompanyStatus(liveResult.record || state.registryRecord || {}) ||
      "";
    state.registryStatus = registryStatus;

    if (liveResult.promoted || liveResult.alreadyLive || isCompanyRegistryLive({ status: registryStatus, registryStatus })) {
      state.status = SETUP_STATUS_LIVE;
      state.blockers = [];
    } else {
      const readinessEval = evaluateCompanyWorkspaceReadiness(liveResult.record || state.registryRecord || {}, {
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        folderStructureOk,
        requiredTabsOk,
        companyFoldersMappingOk,
        firstAdminReady,
        healthCheckRun: true,
        workspaceHealthOk,
      });
      state.blockers = blockersFromValidation(state.validation || {}, { firstAdminReady });
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
  });
  if (stepFailure) {
    return stepFailure;
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
