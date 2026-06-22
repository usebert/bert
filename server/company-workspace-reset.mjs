import {
  isArchiveOrNonLiveWorkspaceName,
  isGoogleNotFoundError,
  isReservedWorkspaceAreaName,
} from "./invite-target.mjs";
import { AREAS_TAB, AREAS_COLUMNS, CONFIG_KEY_AREA_RESTRICTIONS } from "./company-areas.mjs";
import {
  AUDIT_TEMPLATES_TAB,
  AUDIT_TEMPLATES_COLUMNS,
  AREA_AUDITS_TAB,
  AREA_AUDITS_COLUMNS,
  USER_AREA_ACCESS_TAB,
  USER_AREA_ACCESS_COLUMNS,
  USER_AUDIT_ACCESS_TAB,
  USER_AUDIT_ACCESS_COLUMNS,
} from "./company-audit-mapping.mjs";
import { SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { CONFIG_KEY_DEFAULT_FORM_LANGUAGE } from "./template-languages.mjs";

export const RESET_CONFIRM_PHRASE = "RESET COMPANY";

const RESET_MODES = new Set(["clean_onboarding", "keep_areas_templates", "full_operational"]);

const ISO_FOLDER_CONFIG_KEYS = [
  "setupFolderId",
  "auditFormsFolderId",
  "recordsFolderId",
  "evidenceFolderId",
  "exportsFolderId",
  "managementNotesFolderId",
];

const PRESERVED_CONFIG_KEYS = new Set([
  "schemaVersion",
  "companyId",
  "companyName",
  "masterSheetId",
  "createdAt",
  "lastValidatedAt",
  "lastRepairedAt",
  "appVersion",
  CONFIG_KEY_AREA_RESTRICTIONS,
  CONFIG_KEY_DEFAULT_FORM_LANGUAGE,
  ...ISO_FOLDER_CONFIG_KEYS,
]);

const OPTIONAL_EXTRA_TABS = [
  "QMSDocuments",
  "QMSTraining",
  "QMSRisks",
  "HSHazards",
  "HSRiskAssessments",
  "HSSafetyObservations",
  "HSObjectives",
];

function shouldKeepAreasAndTemplates(mode) {
  return mode === "clean_onboarding" || mode === "keep_areas_templates";
}

async function clearTabToHeaders(deps, auth, spreadsheetId, tabName, columns) {
  const { ensureColumns, withSheetsQuotaRetry, google } = deps;
  if (!columns?.length) {
    return { tab: tabName, cleared: false, reason: "no_columns" };
  }
  await ensureColumns(auth, spreadsheetId, tabName, columns);
  const sheets = google.sheets({ version: "v4", auth });
  const lastCol = String.fromCharCode(64 + Math.max(columns.length, 1));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabName}!A:${lastCol}`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [columns] },
    }),
  );
  return { tab: tabName, cleared: true };
}

async function clearTabIfPresent(deps, auth, spreadsheetId, tabName, columns, sheetTitles) {
  if (!sheetTitles.has(tabName)) {
    return { tab: tabName, cleared: false, skipped: true };
  }
  return clearTabToHeaders(deps, auth, spreadsheetId, tabName, columns);
}

function buildPreservedConfig(config, { companyFolderId, masterSheetId, companyName }) {
  const next = {};
  for (const key of PRESERVED_CONFIG_KEYS) {
    if (config[key] !== undefined && String(config[key]).trim() !== "") {
      next[key] = String(config[key]).trim();
    }
  }
  for (const key of ISO_FOLDER_CONFIG_KEYS) {
    const value = String(config[key] || "").trim();
    if (value) {
      next[key] = value;
    }
  }
  next.companyId = companyFolderId;
  next.companyName = companyName || config.companyName || "";
  next.masterSheetId = masterSheetId;
  return next;
}

function purgePendingInvitesForCompany({ readInviteStore, writeInviteStore }, { companyFolderId, masterSheetId }) {
  const store = readInviteStore();
  let removed = 0;
  for (const [id, record] of Object.entries(store)) {
    if (record.consumedAt) {
      continue;
    }
    const sheetId = String(record.masterSheetId || record.provisionMasterSheetId || "").trim();
    const folderId = String(record.companyFolderId || record.provisionDriveFolderId || "").trim();
    const matchesSheet = sheetId && sheetId === masterSheetId;
    const matchesFolder = folderId && folderId === companyFolderId;
    if (matchesSheet || matchesFolder) {
      delete store[id];
      removed += 1;
    }
  }
  writeInviteStore(store);
  return removed;
}

async function resolveResetTarget(auth, google, { companyFolderId, masterSheetIdHint }) {
  const drive = google.drive({ version: "v3", auth });
  let folderName = "";
  try {
    const folderResponse = await drive.files.get({
      fileId: companyFolderId,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed",
    });
    const folder = folderResponse.data;
    if (folder.trashed) {
      return { ok: false, httpStatus: 409, error: "This company workspace folder is in the Drive trash." };
    }
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, httpStatus: 400, error: "The company folder ID is not a valid Drive folder." };
    }
    folderName = String(folder.name || "").trim();
    if (isArchiveOrNonLiveWorkspaceName(folderName) || isReservedWorkspaceAreaName(folderName)) {
      return {
        ok: false,
        httpStatus: 403,
        blocker: "reserved_workspace",
        error:
          "This folder is a reserved platform container (Archive, Live Companies, or Master Control), not a company workspace.",
      };
    }
  } catch (err) {
    if (isGoogleNotFoundError(err)) {
      return { ok: false, httpStatus: 404, error: "Company workspace folder was not found in Google Drive." };
    }
    return {
      ok: false,
      httpStatus: 503,
      error: "Could not verify the company folder with Google Drive. Try again shortly.",
    };
  }

  const masterSheetId = String(masterSheetIdHint || "").trim();
  if (!masterSheetId) {
    return {
      ok: false,
      httpStatus: 400,
      blocker: "missing_master_sheet",
      error: "Company master spreadsheet ID is required to reset this workspace.",
    };
  }

  const sheets = google.sheets({ version: "v4", auth });
  try {
    await sheets.spreadsheets.get({
      spreadsheetId: masterSheetId,
      fields: "spreadsheetId",
    });
  } catch (err) {
    if (isGoogleNotFoundError(err)) {
      return {
        ok: false,
        httpStatus: 404,
        blocker: "missing_master_sheet",
        error: "Company master spreadsheet was not found. Link a live master sheet before resetting.",
      };
    }
    return {
      ok: false,
      httpStatus: 503,
      error: "Could not verify the company master spreadsheet with Google. Try again shortly.",
    };
  }

  return { ok: true, companyFolderId, masterSheetId, companyName: folderName };
}

export async function resetCompanyWorkspace(deps, auth, input) {
  const {
    companyFolderId,
    masterSheetId: masterSheetIdHint,
    mode,
    actorEmail,
    readInviteStore,
    writeInviteStore,
    getConfig,
    updateConfig,
    getWorkbook,
    TAB_COLUMNS,
  } = deps;

  const target = await resolveResetTarget(auth, deps.google, {
    companyFolderId,
    masterSheetIdHint,
  });
  if (!target.ok) {
    return target;
  }

  const { masterSheetId, companyName } = target;
  const config = await getConfig(auth, masterSheetId);
  const configCompanyId = String(config.companyId || "").trim();
  if (configCompanyId && configCompanyId !== companyFolderId) {
    return {
      ok: false,
      httpStatus: 409,
      blocker: "company_mismatch",
      error: "Master sheet Config companyId does not match this company folder.",
    };
  }

  const keepAreasTemplates = shouldKeepAreasAndTemplates(mode);
  console.log("[company-reset] started", {
    companyFolderId,
    masterSheetIdPrefix: masterSheetId.slice(0, 8),
    mode,
    actor: actorEmail || "master",
  });

  const workbook = await getWorkbook(auth, masterSheetId);
  const sheetTitles = new Set(
    (workbook.data.sheets || [])
      .map((sheet) => String(sheet.properties?.title || "").trim())
      .filter(Boolean),
  );

  const clearedTabs = [];
  const operationalTabs = [
    ["Users", TAB_COLUMNS.Users],
    ["Onboarding", TAB_COLUMNS.Onboarding],
    [SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS],
    ["Actions", TAB_COLUMNS.Actions],
    ["ActionComments", TAB_COLUMNS.ActionComments],
    ["AuditResults", TAB_COLUMNS.AuditResults],
    ["AuditFindings", TAB_COLUMNS.AuditFindings],
    ["Evidence", TAB_COLUMNS.Evidence],
    ["Reports", TAB_COLUMNS.Reports],
    ["SyncLog", TAB_COLUMNS.SyncLog],
    ["Incidents", TAB_COLUMNS.Incidents],
    ["IncidentActions", TAB_COLUMNS.IncidentActions],
    [AREA_AUDITS_TAB, AREA_AUDITS_COLUMNS],
    [USER_AREA_ACCESS_TAB, USER_AREA_ACCESS_COLUMNS],
    [USER_AUDIT_ACCESS_TAB, USER_AUDIT_ACCESS_COLUMNS],
  ];

  if (!keepAreasTemplates) {
    operationalTabs.push([AREAS_TAB, AREAS_COLUMNS], [AUDIT_TEMPLATES_TAB, AUDIT_TEMPLATES_COLUMNS]);
  }

  for (const [tab, columns] of operationalTabs) {
    const result = await clearTabIfPresent(deps, auth, masterSheetId, tab, columns, sheetTitles);
    if (result.cleared) {
      clearedTabs.push(tab);
    }
  }

  for (const tab of OPTIONAL_EXTRA_TABS) {
    if (!sheetTitles.has(tab)) {
      continue;
    }
    const columns = TAB_COLUMNS[tab] || ["ID"];
    const result = await clearTabToHeaders(deps, auth, masterSheetId, tab, columns);
    if (result.cleared) {
      clearedTabs.push(tab);
    }
  }

  const preservedConfig = buildPreservedConfig(config, { companyFolderId, masterSheetId, companyName });
  await updateConfig(auth, masterSheetId, preservedConfig);

  const invitesRemoved = purgePendingInvitesForCompany(
    { readInviteStore, writeInviteStore },
    { companyFolderId, masterSheetId },
  );

  console.log("[company-reset] cleared", {
    companyFolderId,
    masterSheetIdPrefix: masterSheetId.slice(0, 8),
    tabs: clearedTabs.length,
    invitesRemoved,
    keptAreasTemplates: keepAreasTemplates,
  });

  console.log("[company-reset] completed", {
    companyFolderId,
    masterSheetIdPrefix: masterSheetId.slice(0, 8),
    mode,
  });

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    companyName,
    mode,
    clearedTabs,
    invitesRemoved,
    keptAreasTemplates: keepAreasTemplates,
    evidenceDriveFilesPreserved: true,
    message: keepAreasTemplates
      ? "Company workspace reset to clean onboarding. Areas and audit templates were kept. Evidence files in Google Drive were not deleted — only Evidence tab rows were cleared."
      : "Company workspace fully reset. Areas, templates, and operational data were cleared. Evidence files in Google Drive were not deleted — only Evidence tab rows were cleared.",
  };
}

export function installCompanyWorkspaceResetRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    readInviteStore,
    writeInviteStore,
    getConfig,
    updateConfig,
    getWorkbook,
    TAB_COLUMNS,
  } = deps;

  app.post(
    "/api/companies/:companyFolderId/reset-workspace",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({
          ok: false,
          error: "Google connection required to reset a company workspace.",
        });
      }

      const companyFolderId = String(req.params.companyFolderId || "").trim();
      const mode = String(req.body?.mode || "clean_onboarding").trim();
      const confirmPhrase = String(req.body?.confirmPhrase || "").trim();
      const masterSheetId = String(req.body?.masterSheetId || "").trim();

      if (!companyFolderId) {
        return res.status(400).json({ ok: false, error: "Company folder ID is required." });
      }
      if (!RESET_MODES.has(mode)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid reset mode. Use clean_onboarding, keep_areas_templates, or full_operational.",
        });
      }
      if (confirmPhrase !== RESET_CONFIRM_PHRASE) {
        return res.status(400).json({
          ok: false,
          blocker: "confirm_required",
          error: `Type ${RESET_CONFIRM_PHRASE} to confirm this reset.`,
        });
      }

      try {
        const actor = req.bertActor;
        const result = await resetCompanyWorkspace(
          {
            ...deps,
            readInviteStore,
            writeInviteStore,
            getConfig,
            updateConfig,
            getWorkbook,
            TAB_COLUMNS,
          },
          authed,
          {
            companyFolderId,
            masterSheetId,
            mode,
            actorEmail: actor?.email || "",
          },
        );

        if (!result.ok) {
          return res.status(result.httpStatus || 500).json({
            ok: false,
            blocker: result.blocker,
            error: result.error,
          });
        }

        return res.json(result);
      } catch (error) {
        console.error("[company-reset] failed", {
          companyFolderId,
          message: error instanceof Error ? error.message : "reset failed",
        });
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to reset company workspace.",
        });
      }
    },
  );
}
