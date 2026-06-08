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
  { key: "workspace_health_check", label: "Run workspace health check" },
  { key: "mark_live", label: "Mark company LIVE if ready" },
];

const SETUP_STATUS_LIVE = "LIVE";
const SETUP_STATUS_NEEDS_ATTENTION = "NEEDS_ATTENTION";

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

function buildFailureResponse(state, error, failedStep) {
  const errorCode = resolveErrorCode(error);
  const technicalMessage = error instanceof Error ? error.message : String(error || "Setup step failed.");
  console.error("[company-setup]", {
    companyId: state.companyId,
    step: failedStep,
    errorCode,
    message: technicalMessage,
  });
  return {
    ok: false,
    status: SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: failedStep,
    completedSteps: state.completedSteps,
    failedStep,
    blockers: state.blockers,
    errorCode,
    message: technicalMessage,
    masterSheetId: state.masterSheetId || "",
    legacyFolderConfig: state.legacyFolderConfig || {},
    folderIds: state.folderIds || {},
  };
}

function buildSuccessResponse(state) {
  const live = state.status === SETUP_STATUS_LIVE;
  return {
    ok: live && state.blockers.length === 0,
    status: live ? SETUP_STATUS_LIVE : SETUP_STATUS_NEEDS_ATTENTION,
    currentStep: "",
    completedSteps: state.completedSteps,
    failedStep: "",
    blockers: state.blockers,
    errorCode: state.blockers.length > 0 ? "COMPANY_NOT_READY" : "",
    message:
      state.blockers.length > 0
        ? "Setup finished with blockers. Check the setup details below and try again."
        : "Company workspace setup completed.",
    masterSheetId: state.masterSheetId || "",
    legacyFolderConfig: state.legacyFolderConfig || {},
    folderIds: state.folderIds || {},
    registryStatus: state.registryStatus || "",
    validation: state.validation || null,
  };
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
    return {
      ok: false,
      status: SETUP_STATUS_NEEDS_ATTENTION,
      currentStep: COMPANY_SETUP_STEPS[0].key,
      completedSteps: [],
      failedStep: COMPANY_SETUP_STEPS[0].key,
      blockers: ["company_folder_not_linked"],
      errorCode: "MISSING_COMPANY_ID",
      message: "Company folder ID is required.",
      masterSheetId: "",
      legacyFolderConfig: {},
      folderIds: {},
    };
  }

  const registryDeps = deps.registryDeps || deps;
  const {
    getDriveFile,
    google,
    ensureTabsAndColumns,
    ensureCompanyMappingTabs,
    ensureAreasTab,
    updateConfig,
    getConfig,
    getTabValues,
    validateWorkspace,
  } = deps;

  const runStep = async (stepKey, fn) => {
    console.log("[company-setup] step start", { companyId, step: stepKey });
    try {
      await fn();
      state.completedSteps.push(stepKey);
      console.log("[company-setup] step done", { companyId, step: stepKey });
    } catch (error) {
      return buildFailureResponse(state, error, stepKey);
    }
    return null;
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
    state.legacyFolderConfig = buildLegacyFolderConfigFromStructure(state.folderIds, state.legacyRootIds);
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
    state.legacyFolderConfig = buildLegacyFolderConfigFromStructure(state.folderIds, result.legacyRootIds || state.legacyRootIds);
    const mappingOk = Boolean(state.masterSheetId);
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
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 7. Ensure first admin
  stepFailure = await runStep("ensure_first_admin", async () => {
    const userCount = await withGoogleTimeout(
      countCompanyUsersOnSheet(auth, getTabValues, state.masterSheetId),
      "ensure_first_admin",
    );
    const firstAdminReady = userCount > 0;
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
    if (!firstAdminReady) {
      state.blockers.push("first_admin_missing");
    }
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 8. Run workspace health check
  stepFailure = await runStep("workspace_health_check", async () => {
    const validation = await withGoogleTimeout(
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
      "workspace_health_check",
    );
    state.validation = validation;
    const companyFoldersOk = Boolean(validation.folders?.companyFolder ?? validation.ok);
    await withGoogleTimeout(
      recordCompanyWorkspaceHealthCheck(auth, registryDeps, {
        companyId,
        companyFolderId: companyId,
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        companyName: resolvedCompanyName,
        workbookFolderId: state.folderIds.BERT_COMPANY_WORKBOOK || "",
        companyFoldersMappingStatus: companyFoldersOk ? "mapped" : "incomplete",
        firstAdminStatus: state.blockers.includes("first_admin_missing") ? "pending" : "ready",
        healthOk: Boolean(validation.ok),
        healthSummary: validation.ok ? "healthy" : "health_check_failed",
        unlinkReason: validation.ok
          ? ""
          : [
              ...(validation.missingTabs?.length ? [`missing_tabs:${validation.missingTabs.join(",")}`] : []),
              ...(validation.repairableIssues?.length ? validation.repairableIssues : []),
            ].join("; "),
      }),
      "workspace_health_check_record",
    ).catch(() => {});

    if (!validation.folders?.setupFolder || !validation.folders?.auditFormsFolder || !validation.folders?.recordsFolder) {
      state.blockers.push("folder_structure_incomplete");
    }
    if (!validation.ok || (validation.missingTabs?.length ?? 0) > 0) {
      state.blockers.push("required_tabs_missing");
    }
    if (!companyFoldersOk) {
      state.blockers.push("companyfolders_mapping_missing");
    }
    if (!validation.ok) {
      state.blockers.push("workspace_health_failed");
    }
  });
  if (stepFailure) {
    return stepFailure;
  }

  // 9. Mark company LIVE if ready
  stepFailure = await runStep("mark_live", async () => {
    const folderStructureOk =
      Boolean(state.validation?.folders?.setupFolder) &&
      Boolean(state.validation?.folders?.auditFormsFolder) &&
      Boolean(state.validation?.folders?.recordsFolder);
    const requiredTabsOk = Boolean(state.validation?.ok) && (state.validation?.missingTabs?.length ?? 0) === 0;
    const companyFoldersMappingOk = Boolean(state.validation?.folders?.companyFolder ?? state.validation?.ok);
    const firstAdminReady = !state.blockers.includes("first_admin_missing");
    const workspaceHealthOk = Boolean(state.validation?.ok);

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
    } else {
      const readiness = evaluateCompanyWorkspaceReadiness(liveResult.record || state.registryRecord || {}, {
        rootFolderId: companyId,
        masterSheetId: state.masterSheetId,
        folderStructureOk,
        requiredTabsOk,
        companyFoldersMappingOk,
        firstAdminReady,
        healthCheckRun: true,
        workspaceHealthOk,
      });
      for (const blocker of readiness.blockers || []) {
        if (!state.blockers.includes(blocker)) {
          state.blockers.push(blocker);
        }
      }
      if (registryStatus !== COMPANY_REGISTRY_STATUS_LIVE) {
        state.blockers.push("registry_not_live");
      }
    }
  });
  if (stepFailure) {
    return stepFailure;
  }

  return buildSuccessResponse(state);
}

export function installCompanySetupProgressRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  app.post(
    "/api/godmode/company-workspace/run-setup",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({
          ok: false,
          status: "NEEDS_ATTENTION",
          currentStep: COMPANY_SETUP_STEPS[0].key,
          completedSteps: [],
          failedStep: "",
          blockers: ["google_not_connected"],
          errorCode: "GOOGLE_NOT_CONNECTED",
          message: "Connect Google Workspace before running company setup.",
        });
      }

      const companyId = String(req.body?.companyId || req.body?.companyFolderId || "").trim();
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
        console.error("[company-setup] unhandled", { companyId, error });
        return res.status(500).json({
          ok: false,
          status: "NEEDS_ATTENTION",
          currentStep: "",
          completedSteps: [],
          failedStep: "unknown",
          blockers: [],
          errorCode: resolveErrorCode(error),
          message: error instanceof Error ? error.message : "Company setup failed.",
        });
      }
    },
  );
}
