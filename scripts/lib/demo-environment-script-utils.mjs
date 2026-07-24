/**
 * Shared helpers for Midlands demo environment scripts.
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import {
  ensureRequiredTabs,
  ensureTabColumns,
  getTabValues,
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
