/**
 * Shared helpers for Midlands demo environment scripts.
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import {
  appendTabRows,
  ensureRequiredTabs,
  ensureTabColumns,
  ensureTabExists,
  getTabValues,
  readTabRecords,
  rowsToRecords,
  writeTabRecords,
} from "../../server/workbook-service.mjs";

export function upsertByKey(existingRows = [], nextRows = [], keyFields = []) {
  const map = new Map();
  for (const row of existingRows) {
    const key = keyFields.map((field) => String(row[field] || "").trim().toLowerCase()).join("|");
    if (key) map.set(key, row);
  }
  for (const row of nextRows) {
    const key = keyFields.map((field) => String(row[field] || "").trim().toLowerCase()).join("|");
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }
  return [...map.values()];
}

export function buildLocalWorkbook(seedPayload, extraTabs = {}) {
  return {
    companyName: seedPayload.companyName,
    companyFolderId: seedPayload.companyFolderId,
    masterSheetId: seedPayload.masterSheetId,
    tabs: {
      Config: [{ Key: "CompanyName", Value: seedPayload.companyName }],
      Sites: seedPayload.sites,
      Departments: seedPayload.departments,
      Areas: seedPayload.areas,
      Users: seedPayload.users,
      AuditTemplates: seedPayload.audits,
      Schedules: seedPayload.schedules,
      ...extraTabs,
    },
    requiredTabs: seedPayload.requiredTabs,
    updatedAt: seedPayload.generatedAt,
  };
}

export function loadGoogleAuth(sessionsRoot) {
  const sessionCandidates = [
    path.join(sessionsRoot, "google-oauth-token.json"),
    path.join(sessionsRoot, "google-session.json"),
    path.join(sessionsRoot, "..", ".sessions", "google-session.json"),
  ];
  const sessionPath = sessionCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sessionPath) {
    throw new Error("Missing Google OAuth token — connect Google first (npm run google:connect).");
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(session.tokens || session);
  return auth;
}

export function buildWorkbookDeps() {
  const deps = {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    rowsToRecords,
  };

  deps.ensureColumns = (auth, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, deps, spreadsheetId, tab, columns);

  deps.getTabValues = (auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab) => {
    if (maybeDepsOrSheetId && typeof maybeDepsOrSheetId === "object" && maybeDepsOrSheetId.google) {
      return getTabValues(auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab);
    }
    return getTabValues(auth, deps, maybeDepsOrSheetId, maybeSheetIdOrTab);
  };

  return deps;
}

const CONFIG_TAB_COLUMNS = ["Key", "Value"];

/**
 * Workbook + company-user deps for provisionCompanyWorkspace from CLI scripts.
 * Mirrors the server installCompanyProvisioningRoutes dependency contract.
 */
export function buildCompanyProvisionScriptDeps(options = {}) {
  const sessionsRoot = String(options.sessionDir || "").trim();
  const sharedDriveId = String(options.sharedDriveId || process.env.GOOGLE_SHARED_DRIVE_ID || "").trim();
  const platformRegistrySheetId = String(
    options.platformRegistrySheetId || process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
  ).trim();

  const deps = {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    rowsToRecords,
    sessionDir: sessionsRoot,
    sharedDriveId,
    platformRegistrySheetId,
    currentSchemaVersion: String(options.currentSchemaVersion || "3.0.0"),
    authIndex: options.authIndex ?? null,
  };

  deps.getWorkbook = async (auth, spreadsheetId) => {
    const sheets = google.sheets({ version: "v4", auth });
    return deps.withSheetsQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "properties(title),sheets(properties(sheetId,title))",
      }),
    );
  };

  deps.ensureTabExists = (auth, spreadsheetId, tab, existingWorkbook = null) =>
    ensureTabExists(auth, deps, spreadsheetId, tab, existingWorkbook);

  deps.ensureColumns = (auth, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, deps, spreadsheetId, tab, columns);

  deps.ensureTabColumns = (auth, workbookDeps, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, workbookDeps?.google ? workbookDeps : deps, spreadsheetId, tab, columns);

  deps.getTabValues = (auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab) => {
    if (maybeDepsOrSheetId && typeof maybeDepsOrSheetId === "object" && maybeDepsOrSheetId.google) {
      return getTabValues(auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab);
    }
    return getTabValues(auth, deps, maybeDepsOrSheetId, maybeSheetIdOrTab);
  };

  deps.readTabRecords = (auth, maybeDeps, spreadsheetId, tabName, readOptions = {}) =>
    readTabRecords(auth, maybeDeps?.google ? maybeDeps : deps, spreadsheetId, tabName, readOptions);

  deps.appendTabRows = (auth, maybeDeps, spreadsheetId, tabName, expectedHeaders, rowObjects = []) =>
    appendTabRows(auth, maybeDeps?.google ? maybeDeps : deps, spreadsheetId, tabName, expectedHeaders, rowObjects);

  deps.writeTabRecords = (auth, maybeDeps, spreadsheetId, tabName, columns, dataRows) =>
    writeTabRecords(auth, maybeDeps?.google ? maybeDeps : deps, spreadsheetId, tabName, columns, dataRows);

  deps.getConfig = async (auth, spreadsheetId) => {
    const rows = rowsToRecords(await deps.getTabValues(auth, spreadsheetId, "Config"));
    return rows.reduce((accumulator, row) => {
      const key = String(row.Key || row.key || "").trim();
      if (key) {
        accumulator[key] = String(row.Value || row.value || "").trim();
      }
      return accumulator;
    }, {});
  };

  deps.updateConfig = async (auth, spreadsheetId, patch) => {
    await ensureTabColumns(auth, deps, spreadsheetId, "Config", CONFIG_TAB_COLUMNS);
    const existing = rowsToRecords(await deps.getTabValues(auth, spreadsheetId, "Config"));
    const merged = existing.reduce((accumulator, row) => {
      const key = String(row.Key || row.key || "").trim();
      if (key) {
        accumulator[key] = String(row.Value || row.value || "").trim();
      }
      return accumulator;
    }, {});
    Object.assign(merged, patch);
    await writeTabRecords(
      auth,
      deps,
      spreadsheetId,
      "Config",
      CONFIG_TAB_COLUMNS,
      Object.entries(merged).map(([Key, Value]) => ({ Key, Value: String(Value ?? "") })),
    );
    return merged;
  };

  deps.getCompanyUsersDeps = () => ({
    google: deps.google,
    withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    safeLower: deps.safeLower,
    ensureColumns: deps.ensureColumns,
    getTabValues: deps.getTabValues,
    getConfig: deps.getConfig,
    updateConfig: deps.updateConfig,
    getWorkbook: deps.getWorkbook,
    readTabRecords: deps.readTabRecords,
    rowsToRecords: deps.rowsToRecords,
  });

  deps.getCompanyWorkspaceRegistryDeps = () => ({
    sharedDriveId,
    platformRegistrySheetId,
    sessionDir: sessionsRoot,
    google: deps.google,
    withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    safeLower: deps.safeLower,
    ensureColumns: deps.ensureColumns,
    getTabValues: deps.getTabValues,
    getWorkbook: deps.getWorkbook,
    ensureTabExists: deps.ensureTabExists,
  });

  deps.ensureTabsAndColumns = async () => ({});

  if (typeof options.resolveLiveCompaniesFolder === "function") {
    deps.resolveLiveCompaniesFolder = options.resolveLiveCompaniesFolder;
  }

  return deps;
}

export async function readExistingRows(auth, deps, sheetId, tab) {
  const values = await getTabValues(auth, deps, sheetId, tab);
  return rowsToRecords(values);
}

export async function writeMergedTab(auth, deps, sheetId, tab, columns, nextRows, keyFields) {
  await ensureTabColumns(auth, deps, sheetId, tab, columns);
  const existing = await readExistingRows(auth, deps, sheetId, tab);
  const merged = upsertByKey(existing, nextRows, keyFields);
  await writeTabRecords(auth, deps, sheetId, tab, columns, merged);
  return merged.length;
}

export async function ensureWorkbookTabs(auth, deps, masterSheetId) {
  await ensureRequiredTabs(auth, deps, masterSheetId);
}

export function retargetCompanyRows(rows = [], { companyFolderId, companyName }) {
  return rows.map((row) => ({
    ...row,
    "Company ID": companyFolderId,
    CompanyId: companyFolderId,
    CompanyFolderId: companyFolderId,
    Company: companyName,
    "Company Folder ID": companyFolderId,
    "Source Company ID": companyFolderId,
    "Source Company Name": companyName,
  }));
}

export function mergeSnapshotWorkbook(previous = {}, workbook = {}) {
  const tabs = workbook.tabs || {};
  const prevTabs = previous.tabs || {};
  const merged = { ...workbook, tabs: { ...tabs } };
  const mergeTab = (tab, keys) => {
    merged.tabs[tab] = upsertByKey(prevTabs[tab] || [], tabs[tab] || [], keys);
  };
  mergeTab("Users", ["Email"]);
  mergeTab("Sites", ["SiteId"]);
  mergeTab("Departments", ["DepartmentId"]);
  mergeTab("Areas", ["AreaId"]);
  mergeTab("AuditTemplates", ["Audit ID"]);
  mergeTab("Schedules", ["Schedule ID"]);
  return merged;
}
