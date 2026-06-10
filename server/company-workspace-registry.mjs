import {
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import {
  resolveCompanySetupPhase,
  shouldAutoQueueHealthCheck,
} from "../shared/company-setup-state.mjs";
import { filterCustomerFacingCompanies, isSystemTemplateCompany } from "../shared/system-template-company.mjs";
import {
  getFallbackRegistryRecord,
  readFallbackRegistryMap,
} from "./company-registry-fallback.mjs";
import { findSpreadsheetInWorkspaceRoot } from "./google-workspace-root.mjs";

/**
 * Platform Companies tab — durable company workspace setup links (Drive folder + master sheet).
 * Never overwrite non-empty registry cells with empty values unless explicitly disconnected.
 */
export const REGISTRY_SPREADSHEET_NAME = "BERT Platform Registry";
export const REGISTRY_TAB_COMPANIES = "Companies";

/** Companies tab columns — superset of onboarding CRM fields + workspace link fields. */
export const COMPANIES_WORKSPACE_COLUMNS = [
  "Company ID",
  "Company Name",
  "Status",
  "Root Folder ID",
  "Master Sheet ID",
  "Workbook Folder ID",
  "CompanyFolders Mapping Status",
  "First Admin Status",
  "Last Setup At",
  "Last Health Check At",
  "Setup Completed At",
  "Live At",
  "Unlink Reason",
  "Website",
  "Phone",
  "Address",
  "Industry",
  "Sites Count",
  "Users Count",
  "Main Needs",
  "Onboarding Invite ID",
  /** @deprecated Legacy alias — kept for reads; writes mirror Company ID */
  "Company Folder ID",
  "Health Status",
  "Needs Attention",
  "Setup Blockers",
  "Created At",
  "Updated At",
];

const COMPANY_ID_HEADERS = ["company id", "companyid", "company folder id", "companyfolderid"];
const ROOT_FOLDER_HEADERS = ["root folder id", "rootfolderid", "company folder id", "companyfolderid"];
const MASTER_SHEET_HEADERS = ["master sheet id", "mastersheetid"];
const COMPANY_NAME_HEADERS = ["company name", "companyname"];
const WORKBOOK_FOLDER_HEADERS = ["workbook folder id", "workbookfolderid"];
const STATUS_HEADERS = ["status"];
const UNLINK_REASON_HEADERS = ["unlink reason", "unlinkreason"];
const LIVE_AT_HEADERS = ["live at", "liveat"];
const HEALTH_STATUS_HEADERS = ["health status", "healthstatus"];
const NEEDS_ATTENTION_HEADERS = ["needs attention", "needsattention"];
const SETUP_BLOCKERS_HEADERS = ["setup blockers", "setupblockers"];
const CREATED_AT_HEADERS = ["created at", "createdat"];
const UPDATED_AT_HEADERS = ["updated at", "updatedat", "last setup at", "lastsetupat"];

function safeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function headerIndex(headers, candidates) {
  const normalized = headers.map((header) => safeLower(header));
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function cellValue(row, index) {
  if (index < 0 || !row) {
    return "";
  }
  return String(row[index] ?? "").trim();
}

function isBlank(value) {
  return !String(value ?? "").trim();
}

/** Merge incoming column values onto an existing row without erasing non-empty cells. */
export function mergeRegistryRowCells(
  existingRow,
  headerRow,
  incomingByHeader,
  { allowClear = false, forceClearHeaders = [] } = {},
) {
  const width = Math.max(headerRow.length, existingRow?.length || 0, COMPANIES_WORKSPACE_COLUMNS.length);
  const next = Array.from({ length: width }, (_, index) => String(existingRow?.[index] ?? "").trim());
  const forceClear = new Set(forceClearHeaders.map((header) => safeLower(header)));
  for (const header of headerRow) {
    if (!(header in incomingByHeader)) {
      continue;
    }
    const incoming = String(incomingByHeader[header] ?? "").trim();
    const index = headerRow.findIndex((entry) => entry === header);
    if (index < 0) {
      continue;
    }
    const current = String(next[index] ?? "").trim();
    if (forceClear.has(safeLower(header))) {
      next[index] = incoming;
      continue;
    }
    if (!allowClear && isBlank(incoming) && !isBlank(current)) {
      continue;
    }
    if (!isBlank(incoming) || allowClear) {
      next[index] = incoming;
    }
  }
  return next;
}

/** Find a Companies registry row by Company ID or Root Folder ID. */
export function findCompanyWorkspaceRegistryRecord(map, lookupId) {
  const id = String(lookupId || "").trim();
  if (!id || !map) {
    return null;
  }
  if (map.has(id)) {
    return map.get(id) || null;
  }
  for (const record of map.values()) {
    if (record.rootFolderId === id || record.companyId === id) {
      return record;
    }
  }
  return null;
}

/** Normalize company name for fuzzy registry matching. */
export function normalizeCompanyRegistryNameKey(name = "") {
  return safeLower(name).replace(/[^a-z0-9]+/g, " ").trim();
}

function workspaceLookupIds(workspace = {}) {
  const companyId = String(
    workspace.companyId || workspace.companyFolderId || workspace.id || "",
  ).trim();
  const rootFolderId = String(
    workspace.companyFolderId || workspace.rootFolderId || companyId || "",
  ).trim();
  const masterSheetId = String(
    workspace.masterSheetId || workspace.responseSheetId || "",
  ).trim();
  const companyName = String(workspace.companyName || workspace.name || "").trim();
  return { companyId, rootFolderId, masterSheetId, companyName };
}

/**
 * Multi-key registry lookup: companyId → masterSheetId → folderId → normalized name.
 * @returns {{ record: object, matchedBy: string } | null}
 */
export function findCompanyWorkspaceRegistryRecordInMap(map, workspace = {}) {
  if (!map || map.size === 0) {
    return null;
  }
  const { companyId, rootFolderId, masterSheetId, companyName } = workspaceLookupIds(workspace);
  const nameKey = normalizeCompanyRegistryNameKey(companyName);

  if (companyId) {
    const byCompanyId = findCompanyWorkspaceRegistryRecord(map, companyId);
    if (byCompanyId) {
      return { record: byCompanyId, matchedBy: "companyId" };
    }
  }
  if (masterSheetId) {
    for (const record of map.values()) {
      if (String(record.masterSheetId || "").trim() === masterSheetId) {
        return { record, matchedBy: "masterSheetId" };
      }
    }
  }
  if (rootFolderId && rootFolderId !== companyId) {
    const byFolder = findCompanyWorkspaceRegistryRecord(map, rootFolderId);
    if (byFolder) {
      return { record: byFolder, matchedBy: "companyFolderId" };
    }
  }
  if (nameKey && !isSystemTemplateCompany({ companyName, name: companyName })) {
    for (const record of map.values()) {
      if (normalizeCompanyRegistryNameKey(record.companyName) === nameKey) {
        return { record, matchedBy: "companyName" };
      }
    }
  }
  return null;
}

/**
 * Ensure a Companies registry row exists for a Godmode workspace selection.
 * Matches before create to avoid duplicate rows; preserves existing folder/sheet IDs.
 */
export async function ensureCompanyRegistryRecordForWorkspace(auth, deps, selectedWorkspace = {}) {
  const { companyId, rootFolderId, masterSheetId, companyName } = workspaceLookupIds(selectedWorkspace);
  if (!companyId && !rootFolderId) {
    return { record: null, created: false, matchedBy: "", reason: "missing_workspace_id" };
  }
  if (isSystemTemplateCompany({ companyName, name: companyName, companyId })) {
    return { record: null, created: false, matchedBy: "", reason: "system_template" };
  }

  const { map } = await readCompanyWorkspaceRegistryMap(auth, deps);
  const match = findCompanyWorkspaceRegistryRecordInMap(map, selectedWorkspace);
  if (match?.record) {
    return { record: match.record, created: false, matchedBy: match.matchedBy, reason: "found" };
  }

  const canonicalCompanyId = companyId || rootFolderId;
  if (!canonicalCompanyId) {
    return { record: null, created: false, matchedBy: "", reason: "missing_company_id" };
  }

  const resolvedRootFolderId = rootFolderId || canonicalCompanyId;
  const status = deriveCompanyWorkspaceStatus({
    rootFolderId: resolvedRootFolderId,
    masterSheetId,
    companyId: canonicalCompanyId,
  });
  const result = await persistCompanyWorkspaceSetup(auth, deps, {
    companyId: canonicalCompanyId,
    companyName,
    rootFolderId: resolvedRootFolderId,
    masterSheetId,
    status: status === "Live" ? "Setup in progress" : status,
    markLive: false,
    markSetupComplete: false,
    touchSetup: true,
  });
  const fresh =
    (await getCompanyWorkspaceRegistryRecord(auth, deps, canonicalCompanyId)) ||
    result.record ||
    null;
  return {
    record: fresh,
    created: Boolean(result.synced),
    matchedBy: result.synced ? "created" : "",
    reason: result.synced ? "created" : result.reason || "create_failed",
  };
}

/** Find a Companies tab row by companyId, folderId, masterSheetId, or normalized name. */
export function findRegistryRowIndex(headerRow, rows, lookup = {}) {
  const companyId = String(lookup.companyId || lookup.lookupId || "").trim();
  const rootFolderId = String(lookup.rootFolderId || lookup.companyFolderId || "").trim();
  const masterSheetId = String(lookup.masterSheetId || "").trim();
  const companyName = String(lookup.companyName || "").trim();
  const nameKey = normalizeCompanyRegistryNameKey(companyName);

  if (!companyId && !rootFolderId && !masterSheetId && !nameKey) {
    return -1;
  }

  const idIndex = headerIndex(headerRow, COMPANY_ID_HEADERS);
  const rootFolderIndex = headerIndex(headerRow, ROOT_FOLDER_HEADERS);
  const masterSheetIndex = headerIndex(headerRow, MASTER_SHEET_HEADERS);
  const nameIndex = headerIndex(headerRow, COMPANY_NAME_HEADERS);

  return rows.findIndex((row) => {
    if (companyId && idIndex >= 0 && cellValue(row, idIndex) === companyId) {
      return true;
    }
    if (rootFolderId && rootFolderIndex >= 0 && cellValue(row, rootFolderIndex) === rootFolderId) {
      return true;
    }
    if (companyId && rootFolderIndex >= 0 && cellValue(row, rootFolderIndex) === companyId) {
      return true;
    }
    if (masterSheetId && masterSheetIndex >= 0 && cellValue(row, masterSheetIndex) === masterSheetId) {
      return true;
    }
    if (
      nameKey &&
      nameIndex >= 0 &&
      !isSystemTemplateCompany({ companyName, name: companyName }) &&
      normalizeCompanyRegistryNameKey(cellValue(row, nameIndex)) === nameKey
    ) {
      return true;
    }
    return false;
  });
}

export function findMissingRegistryColumns(headerRow = []) {
  const normalized = headerRow.map((header) => safeLower(header));
  return COMPANIES_WORKSPACE_COLUMNS.filter(
    (expected) => !normalized.includes(safeLower(expected)),
  );
}

function buildRegistryLocation(spreadsheetId, tabName = REGISTRY_TAB_COMPANIES) {
  const id = String(spreadsheetId || "").trim();
  if (!id) {
    return "";
  }
  return `${id}/${tabName}`;
}

function buildLookupKeys(workspace = {}) {
  const { companyId, rootFolderId, masterSheetId, companyName } = workspaceLookupIds(workspace);
  return {
    companyId,
    companyFolderId: rootFolderId,
    masterSheetId,
    companyName,
  };
}

export function normalizeCompanyWorkspaceRecord(rowObject = {}, headerRow = COMPANIES_WORKSPACE_COLUMNS) {
  const byHeader = {};
  for (const header of headerRow) {
    byHeader[header] = String(rowObject[header] ?? "").trim();
  }
  const companyId =
    String(rowObject["Company ID"] || rowObject["Company Folder ID"] || rowObject.companyId || "").trim();
  const rootFolderId = String(rowObject["Root Folder ID"] || companyId || "").trim();
  const masterSheetId = String(rowObject["Master Sheet ID"] || rowObject.masterSheetId || "").trim();
  const workbookFolderId = String(rowObject["Workbook Folder ID"] || rowObject.workbookFolderId || "").trim();
  const companyName = String(rowObject["Company Name"] || rowObject.companyName || "").trim();
  const status = String(rowObject.Status || rowObject.status || "").trim();
  const explicitType = String(rowObject.Type || rowObject.type || rowObject.workspaceType || "").trim();
  const explicitIsTemplate =
    rowObject.isTemplate === true ||
    rowObject.isSystem === true ||
    safeLower(rowObject["Is Template"]) === "true" ||
    safeLower(rowObject["Is System"]) === "true";
  const templateRecord = {
    companyName,
    status,
    type: explicitType,
    isTemplate: explicitIsTemplate,
    isSystem: rowObject.isSystem === true || safeLower(rowObject["Is System"]) === "true",
  };
  const isTemplate = isSystemTemplateCompany(templateRecord);
  return {
    companyId,
    companyName,
    status: isTemplate && !status ? "TEMPLATE" : status,
    isTemplate,
    isSystem: templateRecord.isSystem || isTemplate,
    type: isTemplate ? "TEMPLATE" : explicitType,
    workspaceType: isTemplate ? "TEMPLATE" : explicitType,
    rootFolderId,
    masterSheetId,
    workbookFolderId,
    companyFoldersMappingStatus: String(
      rowObject["CompanyFolders Mapping Status"] || rowObject.companyFoldersMappingStatus || "",
    ).trim(),
    firstAdminStatus: String(rowObject["First Admin Status"] || rowObject.firstAdminStatus || "").trim(),
    lastSetupAt: String(rowObject["Last Setup At"] || rowObject.lastSetupAt || "").trim(),
    lastHealthCheckAt: String(rowObject["Last Health Check At"] || rowObject.lastHealthCheckAt || "").trim(),
    setupCompletedAt: String(rowObject["Setup Completed At"] || rowObject.setupCompletedAt || "").trim(),
    liveAt: String(rowObject["Live At"] || rowObject.liveAt || "").trim(),
    unlinkReason: String(rowObject["Unlink Reason"] || rowObject.unlinkReason || "").trim(),
    healthStatus: String(rowObject["Health Status"] || rowObject.healthStatus || "").trim(),
    needsAttention: String(rowObject["Needs Attention"] || rowObject.needsAttention || "").trim(),
    setupBlockers: String(rowObject["Setup Blockers"] || rowObject.setupBlockers || "").trim(),
    createdAt: String(rowObject["Created At"] || rowObject.createdAt || "").trim(),
    updatedAt: String(
      rowObject["Updated At"] || rowObject.updatedAt || rowObject["Last Setup At"] || rowObject.lastSetupAt || "",
    ).trim(),
    byHeader,
  };
}

export function rowObjectFromCompanyWorkspaceRecord(record, headerRow = COMPANIES_WORKSPACE_COLUMNS) {
  const companyId = String(record.companyId || record.rootFolderId || "").trim();
  const rootFolderId = String(record.rootFolderId || companyId || "").trim();
  const masterSheetId = String(record.masterSheetId || "").trim();
  const workbookFolderId = String(record.workbookFolderId || "").trim();
  const status = String(record.status || deriveCompanyWorkspaceStatus(record)).trim();
  const row = {
    "Company ID": companyId,
    "Company Name": String(record.companyName || "").trim(),
    Status: status,
    "Root Folder ID": rootFolderId,
    "Master Sheet ID": masterSheetId,
    "Workbook Folder ID": workbookFolderId,
    "CompanyFolders Mapping Status": String(record.companyFoldersMappingStatus || "").trim(),
    "First Admin Status": String(record.firstAdminStatus || "").trim(),
    "Last Setup At": String(record.lastSetupAt || "").trim(),
    "Last Health Check At": String(record.lastHealthCheckAt || "").trim(),
    "Setup Completed At": String(record.setupCompletedAt || "").trim(),
    "Live At": String(record.liveAt || "").trim(),
    "Unlink Reason": String(record.unlinkReason || "").trim(),
    "Company Folder ID": companyId,
    "Health Status": String(record.healthStatus || "").trim(),
    "Needs Attention": String(record.needsAttention || "").trim(),
    "Setup Blockers": String(record.setupBlockers || "").trim(),
    "Created At": String(record.createdAt || "").trim(),
    "Updated At": String(record.updatedAt || record.lastSetupAt || "").trim(),
    ...(record.byHeader || {}),
    ...(record.extraHeaders || {}),
  };
  const mapped = {};
  for (const header of headerRow) {
    mapped[header] = String(row[header] ?? "").trim();
  }
  return mapped;
}

export function deriveCompanyWorkspaceStatus(record = {}) {
  const rootFolderId = String(record.rootFolderId || record.companyId || "").trim();
  const masterSheetId = String(record.masterSheetId || "").trim();
  const explicit = String(record.status || "").trim();
  if (explicit === "Archived" || explicit === "Disconnected") {
    return explicit;
  }
  if (rootFolderId && masterSheetId) {
    if (explicit === "Needs attention") {
      return "Needs attention";
    }
    if (record.setupCompletedAt || record.liveAt || explicit === "Live") {
      return "Live";
    }
    return "Live";
  }
  if (rootFolderId || masterSheetId) {
    return "Setup in progress";
  }
  return explicit || "Not started";
}

export function diagnoseCompanyWorkspaceUnlink(record = {}, context = {}) {
  const rootFolderId = String(record.rootFolderId || record.companyId || context.companyFolderId || "").trim();
  const masterSheetId = String(record.masterSheetId || context.masterSheetId || "").trim();
  if (!rootFolderId) {
    return "missing_root_folder_id";
  }
  if (!masterSheetId) {
    return "missing_master_sheet_id";
  }
  if (context.googleAccessDenied) {
    return "google_access_denied";
  }
  if (context.masterSheetInaccessible) {
    return "master_sheet_inaccessible";
  }
  if (context.workbookFolderMissing) {
    return "workbook_folder_missing";
  }
  if (context.companyFoldersMappingMissing) {
    return "companyfolders_mapping_missing";
  }
  if (record.unlinkReason) {
    return record.unlinkReason;
  }
  return "";
}

async function resolvePlatformRegistrySpreadsheetId(auth, drive, deps) {
  const configured = String(deps.platformRegistrySheetId || "").trim();
  if (configured) {
    return configured;
  }
  const sharedDriveId = String(deps.sharedDriveId || "").trim();
  if (!sharedDriveId) {
    return "";
  }
  return findSpreadsheetInWorkspaceRoot(auth, deps.google, sharedDriveId, REGISTRY_SPREADSHEET_NAME);
}

async function ensureRegistryTab(auth, sheetsApi, spreadsheetId, tabName, headers, deps) {
  const { getWorkbook, ensureTabExists, ensureColumns } = deps;
  let workbook = await getWorkbook(auth, spreadsheetId);
  const { workbook: workbookAfter } = await ensureTabExists(auth, spreadsheetId, tabName, workbook);
  workbook = workbookAfter;
  const columnResult = await ensureColumns(auth, spreadsheetId, tabName, headers);
  const addedColumns = columnResult?.addedColumns || [];
  const headerRow = columnResult?.headers?.length ? columnResult.headers : headers;
  return { workbook, headerRow, missingColumns: findMissingRegistryColumns(headerRow), addedColumns };
}

function recordsFromSheetValues(values, headerRow) {
  const headers = values[0] || headerRow;
  const idIndex = headerIndex(headers, COMPANY_ID_HEADERS);
  const rootFolderIndex = headerIndex(headers, ROOT_FOLDER_HEADERS);
  const map = new Map();
  for (const row of values.slice(1)) {
    const companyId = cellValue(row, idIndex) || cellValue(row, rootFolderIndex);
    if (!companyId) {
      continue;
    }
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = cellValue(row, index);
    });
    map.set(companyId, normalizeCompanyWorkspaceRecord(rowObject, headers));
  }
  return { headers, map };
}

export async function readCompanyWorkspaceRegistryMap(auth, deps) {
  const drive = deps.google.drive({ version: "v3", auth });
  const spreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  if (!spreadsheetId) {
    return { spreadsheetId: "", headers: COMPANIES_WORKSPACE_COLUMNS, map: new Map() };
  }
  const rows = await deps.getTabValues(auth, spreadsheetId, REGISTRY_TAB_COMPANIES);
  if (!rows.length) {
    return { spreadsheetId, headers: COMPANIES_WORKSPACE_COLUMNS, map: new Map() };
  }
  const { headers, map } = recordsFromSheetValues(rows, rows[0]);
  return { spreadsheetId, headers, map };
}

export async function getCompanyWorkspaceRegistryRecord(auth, deps, companyId) {
  const id = String(companyId || "").trim();
  if (!id) {
    return null;
  }
  const { map } = await readCompanyWorkspaceRegistryMap(auth, deps);
  return findCompanyWorkspaceRegistryRecord(map, id);
}

function resolveSessionDirFromDeps(deps = {}) {
  return String(deps.sessionDir || "").trim();
}

/** Merge fallback LIVE records into a sheet registry map (fallback fills gaps only). */
export function mergeFallbackRegistryIntoMap(registryMap, sessionDir) {
  const merged = new Map(registryMap || []);
  const fallbackMap = readFallbackRegistryMap(sessionDir);
  for (const [companyId, fallbackRecord] of fallbackMap.entries()) {
    const existing = findCompanyWorkspaceRegistryRecord(merged, companyId);
    if (!existing || !isCompanyRegistryLive(existing)) {
      merged.set(companyId, { ...fallbackRecord, registrySource: "fallback", fallbackRegistry: true });
    } else {
      merged.set(String(existing.companyId || companyId).trim(), {
        ...existing,
        registrySource: "main",
      });
    }
  }
  for (const [companyId, record] of merged.entries()) {
    if (!record.registrySource) {
      merged.set(companyId, { ...record, registrySource: isCompanyRegistryLive(record) ? "main" : "" });
    }
  }
  return merged;
}

/**
 * Canonical company registry lookup: main Companies sheet first, then fallback JSON.
 * LIVE from either source is accepted for invites and make-usable.
 */
export async function getCanonicalCompanyRegistryRecord(auth, deps, companyId) {
  const id = String(companyId || "").trim();
  if (!id) {
    return null;
  }
  const sessionDir = resolveSessionDirFromDeps(deps);
  const mainRecord = auth
    ? await getCompanyWorkspaceRegistryRecord(auth, deps, id).catch(() => null)
    : null;
  if (mainRecord && isCompanyRegistryLive(mainRecord)) {
    return { ...mainRecord, registrySource: "main", fallbackRegistry: false };
  }
  const fallbackRecord = sessionDir ? getFallbackRegistryRecord(sessionDir, id) : null;
  if (fallbackRecord && isCompanyRegistryLive(fallbackRecord)) {
    return { ...fallbackRecord, registrySource: "fallback", fallbackRegistry: true };
  }
  if (mainRecord) {
    return { ...mainRecord, registrySource: "main", fallbackRegistry: false };
  }
  if (fallbackRecord) {
    return { ...fallbackRecord, registrySource: "fallback", fallbackRegistry: true };
  }
  return null;
}

export async function readCanonicalCompanyWorkspaceRegistryMap(auth, deps) {
  const sheetResult = await readCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
    spreadsheetId: "",
    headers: COMPANIES_WORKSPACE_COLUMNS,
    map: new Map(),
  }));
  const sessionDir = resolveSessionDirFromDeps(deps);
  const map = sessionDir ? mergeFallbackRegistryIntoMap(sheetResult.map, sessionDir) : sheetResult.map;
  return { ...sheetResult, map };
}

export async function upsertCompanyWorkspaceRegistryRecords(
  auth,
  deps,
  records,
  { allowClear = false, mergeBlanksOnly = true, forceClearHeaders = [] } = {},
) {
  const sanitized = Array.isArray(records) ? records : [records];
  if (!sanitized.length) {
    return { synced: false, reason: "no_records" };
  }
  const drive = deps.google.drive({ version: "v3", auth });
  const sheetsApi = deps.google.sheets({ version: "v4", auth });
  const spreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  const registryLocation = buildRegistryLocation(spreadsheetId);
  if (!spreadsheetId) {
    const configured = String(deps.platformRegistrySheetId || "").trim();
    const sharedDriveId = String(deps.sharedDriveId || "").trim();
    return {
      synced: false,
      reason: "registry_missing",
      technicalError: configured
        ? `Configured registry spreadsheet not found: ${configured}`
        : sharedDriveId
          ? `"${REGISTRY_SPREADSHEET_NAME}" not found in workspace root ${sharedDriveId}`
          : "BERT_PLATFORM_REGISTRY_SHEET_ID and GOOGLE_SHARED_DRIVE_ID are not configured",
      registrySpreadsheetId: configured || "",
      registryTab: REGISTRY_TAB_COMPANIES,
      registryLocation: configured
        ? buildRegistryLocation(configured)
        : sharedDriveId
          ? `${sharedDriveId}/${REGISTRY_SPREADSHEET_NAME}/${REGISTRY_TAB_COMPANIES}`
          : "",
      missingColumns: [...COMPANIES_WORKSPACE_COLUMNS],
      lookupKeys: buildLookupKeys(sanitized[0] || {}),
    };
  }

  let tabEnsure;
  try {
    tabEnsure = await ensureRegistryTab(
      auth,
      sheetsApi,
      spreadsheetId,
      REGISTRY_TAB_COMPANIES,
      COMPANIES_WORKSPACE_COLUMNS,
      deps,
    );
  } catch (error) {
    const technicalError = String(error?.message || error?.response?.data?.error?.message || error || "").trim();
    return {
      synced: false,
      reason: "registry_tab_failed",
      technicalError,
      registrySpreadsheetId: spreadsheetId,
      registryTab: REGISTRY_TAB_COMPANIES,
      registryLocation,
      missingColumns: [],
      lookupKeys: buildLookupKeys(sanitized[0] || {}),
    };
  }

  const existingValues = await deps.getTabValues(auth, spreadsheetId, REGISTRY_TAB_COMPANIES);
  const headerRow = tabEnsure.headerRow?.length
    ? tabEnsure.headerRow
    : existingValues[0]?.length
      ? existingValues[0]
      : [...COMPANIES_WORKSPACE_COLUMNS];
  const missingColumns = findMissingRegistryColumns(headerRow);
  const idIndex = headerIndex(headerRow, COMPANY_ID_HEADERS);
  const rootFolderIndex = headerIndex(headerRow, ROOT_FOLDER_HEADERS);
  const dataRows = existingValues.length > 1 ? existingValues.slice(1) : [];
  const nextRows = dataRows.map((row) => {
    const padded = [...row];
    while (padded.length < headerRow.length) {
      padded.push("");
    }
    return padded;
  });

  for (const rawRecord of sanitized) {
    const normalized = normalizeCompanyWorkspaceRecord(rawRecord, headerRow);
    const companyId = normalized.companyId || normalized.rootFolderId;
    if (!companyId) {
      continue;
    }
    const now = nowIso();
    const incoming = rowObjectFromCompanyWorkspaceRecord(
      {
        ...normalized,
        companyId,
        rootFolderId: normalized.rootFolderId || companyId,
        status: normalized.status || deriveCompanyWorkspaceStatus(normalized),
        createdAt: normalized.createdAt || now,
        updatedAt: normalized.updatedAt || normalized.lastSetupAt || now,
      },
      headerRow,
    );
    const rowIndex = findRegistryRowIndex(headerRow, nextRows, {
      companyId,
      rootFolderId: normalized.rootFolderId || companyId,
      masterSheetId: normalized.masterSheetId,
      companyName: normalized.companyName,
    });
    if (rowIndex === -1) {
      const mapped = headerRow.map((header) => String(incoming[header] ?? "").trim());
      if (idIndex >= 0) {
        mapped[idIndex] = companyId;
      }
      const legacyFolderIndex = headerIndex(headerRow, ["company folder id", "companyfolderid"]);
      if (legacyFolderIndex >= 0 && legacyFolderIndex !== idIndex) {
        mapped[legacyFolderIndex] = normalized.rootFolderId || companyId;
      }
      if (rootFolderIndex >= 0 && rootFolderIndex !== idIndex && rootFolderIndex !== legacyFolderIndex) {
        mapped[rootFolderIndex] = normalized.rootFolderId || companyId;
      }
      nextRows.push(mapped);
      continue;
    }
    const existingRowObject = {};
    headerRow.forEach((header, index) => {
      existingRowObject[header] = cellValue(nextRows[rowIndex], index);
    });
    const existingNormalized = normalizeCompanyWorkspaceRecord(existingRowObject, headerRow);
    const canonicalCompanyId = existingNormalized.companyId || companyId;
    const mergedRecord = mergeBlanksOnly
      ? {
          ...existingNormalized,
          ...Object.fromEntries(
            Object.entries(incoming).filter(([, value]) => !isBlank(value)),
          ),
          companyId: canonicalCompanyId,
          rootFolderId:
            incoming["Root Folder ID"] ||
            existingRowObject["Root Folder ID"] ||
            normalized.rootFolderId ||
            companyId,
          masterSheetId:
            incoming["Master Sheet ID"] || existingRowObject["Master Sheet ID"] || existingNormalized.masterSheetId || "",
          workbookFolderId:
            incoming["Workbook Folder ID"] ||
            existingRowObject["Workbook Folder ID"] ||
            existingNormalized.workbookFolderId ||
            "",
          createdAt: existingNormalized.createdAt || incoming["Created At"] || now,
          updatedAt: incoming["Updated At"] || now,
        }
      : normalizeCompanyWorkspaceRecord({ ...existingRowObject, ...incoming }, headerRow);
    const mergedRow = mergeRegistryRowCells(
      nextRows[rowIndex],
      headerRow,
      rowObjectFromCompanyWorkspaceRecord(mergedRecord, headerRow),
      { allowClear, forceClearHeaders },
    );
    nextRows[rowIndex] = mergedRow;
  }

  try {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${REGISTRY_TAB_COMPANIES}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headerRow, ...nextRows] },
    });
  } catch (error) {
    const technicalError = String(error?.message || error?.response?.data?.error?.message || error || "").trim();
    return {
      synced: false,
      reason: "sheets_write_failed",
      technicalError,
      registrySpreadsheetId: spreadsheetId,
      registryTab: REGISTRY_TAB_COMPANIES,
      registryLocation,
      missingColumns,
      lookupKeys: buildLookupKeys(sanitized[0] || {}),
    };
  }

  return {
    synced: true,
    registrySpreadsheetId: spreadsheetId,
    registryTab: REGISTRY_TAB_COMPANIES,
    registryLocation,
    missingColumns,
  };
}

export const REGISTRY_WRITE_FAILED = "REGISTRY_WRITE_FAILED";
export const REGISTRY_VERIFY_FAILED = "REGISTRY_VERIFY_FAILED";
export const REGISTRY_PERSIST_FAILED_STEP = "Persist company Live in registry";

export const REGISTRY_PERSIST_ERROR_MESSAGES = {
  [REGISTRY_WRITE_FAILED]: "BERT could not save this company as Live in the company registry.",
  [REGISTRY_VERIFY_FAILED]:
    "BERT saved setup data but could not verify the company is Live in the registry.",
};

export function createRegistryPersistError(code, technicalError = "", diagnostics = {}) {
  const normalizedCode = String(code || REGISTRY_WRITE_FAILED).trim();
  const error = new Error(
    REGISTRY_PERSIST_ERROR_MESSAGES[normalizedCode] || String(technicalError || "Registry persist failed."),
  );
  error.code = normalizedCode;
  error.reasonCode = normalizedCode;
  error.technicalError = String(technicalError || "").trim();
  error.failedStep = REGISTRY_PERSIST_FAILED_STEP;
  error.registrySpreadsheetId = String(diagnostics.registrySpreadsheetId || "").trim();
  error.registryTab = String(diagnostics.registryTab || REGISTRY_TAB_COMPANIES).trim();
  error.registryLocation =
    String(diagnostics.registryLocation || "").trim() ||
    buildRegistryLocation(error.registrySpreadsheetId, error.registryTab);
  error.missingColumns = Array.isArray(diagnostics.missingColumns) ? diagnostics.missingColumns : [];
  error.lookupKeys =
    diagnostics.lookupKeys && typeof diagnostics.lookupKeys === "object" ? diagnostics.lookupKeys : {};
  error.verifyReadback = diagnostics.verifyReadback || null;
  return error;
}

function registryDiagnosticsFromWriteResult(writeResult = {}, lookupWorkspace = {}) {
  return {
    registrySpreadsheetId: String(writeResult.registrySpreadsheetId || "").trim(),
    registryTab: String(writeResult.registryTab || REGISTRY_TAB_COMPANIES).trim(),
    registryLocation: String(writeResult.registryLocation || "").trim(),
    missingColumns: writeResult.missingColumns || [],
    lookupKeys: buildLookupKeys(lookupWorkspace),
  };
}

function resolveMappingStatusFromChecks(checks = {}, existingStatus = "") {
  if (checks.companyFoldersMappingOk === true) {
    return "mapped";
  }
  if (checks.companyFoldersMappingOk === false) {
    return existingStatus;
  }
  return existingStatus;
}

function resolveFirstAdminStatusFromChecks(checks = {}, existingStatus = "") {
  if (checks.firstAdminReady === true) {
    return "ready";
  }
  if (checks.firstAdminReady === false) {
    return "pending";
  }
  return existingStatus;
}

async function reloadRegistryRecord(auth, deps, registryCompanyId, lookupId) {
  return (
    (await getCompanyWorkspaceRegistryRecord(auth, deps, registryCompanyId)) ||
    (await getCompanyWorkspaceRegistryRecord(auth, deps, lookupId)) ||
    null
  );
}

/**
 * Canonical LIVE persist: ensure registry row, write Status=Live, re-read and verify.
 * Throws REGISTRY_WRITE_FAILED or REGISTRY_VERIFY_FAILED — never infers Live without re-read.
 */
export async function persistAndVerifyCompanyLive(auth, deps, canonicalCompany = {}) {
  const companyId = String(
    canonicalCompany.companyId || canonicalCompany.companyFolderId || canonicalCompany.rootFolderId || "",
  ).trim();
  const companyFolderId = String(
    canonicalCompany.companyFolderId || canonicalCompany.rootFolderId || companyId,
  ).trim();
  const masterSheetId = String(canonicalCompany.masterSheetId || "").trim();
  const companyName = String(canonicalCompany.companyName || "").trim();
  const checks = canonicalCompany.checks && typeof canonicalCompany.checks === "object" ? canonicalCompany.checks : {};
  const lookupWorkspace = { companyId, companyFolderId, rootFolderId: companyFolderId, masterSheetId, companyName };

  if (!companyId || !auth) {
    throw createRegistryPersistError(REGISTRY_WRITE_FAILED, "missing_company_id", {
      lookupKeys: buildLookupKeys(lookupWorkspace),
    });
  }

  const ensured = await ensureCompanyRegistryRecordForWorkspace(auth, deps, lookupWorkspace);
  const registryRecord = ensured?.record || null;
  if (!registryRecord) {
    const { spreadsheetId } = await readCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
      spreadsheetId: "",
    }));
    throw createRegistryPersistError(REGISTRY_WRITE_FAILED, String(ensured?.reason || "ensure_failed"), {
      registrySpreadsheetId: spreadsheetId,
      registryTab: REGISTRY_TAB_COMPANIES,
      registryLocation: buildRegistryLocation(spreadsheetId),
      lookupKeys: buildLookupKeys(lookupWorkspace),
      missingColumns: spreadsheetId ? findMissingRegistryColumns(COMPANIES_WORKSPACE_COLUMNS) : [],
    });
  }

  const registryCompanyId = String(registryRecord.companyId || companyId).trim();
  const resolvedRootFolderId = String(
    companyFolderId || registryRecord.rootFolderId || companyId,
  ).trim();
  const resolvedMasterSheetId = String(masterSheetId || registryRecord.masterSheetId || "").trim();
  const now = nowIso();

  if (isCompanyRegistryLive(registryRecord)) {
    const verified = await reloadRegistryRecord(auth, deps, registryCompanyId, companyId);
    const registryStatus = getCanonicalCompanyStatus(verified || {});
    if (!verified || !isCompanyRegistryLive(verified)) {
      const { spreadsheetId, headers } = await readCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
        spreadsheetId: "",
        headers: COMPANIES_WORKSPACE_COLUMNS,
      }));
      throw createRegistryPersistError(
        REGISTRY_VERIFY_FAILED,
        `registry_status=${registryStatus || "unknown"} after reload`,
        {
          registrySpreadsheetId: spreadsheetId,
          registryTab: REGISTRY_TAB_COMPANIES,
          registryLocation: buildRegistryLocation(spreadsheetId),
          missingColumns: findMissingRegistryColumns(headers),
          lookupKeys: buildLookupKeys({ ...lookupWorkspace, companyId: registryCompanyId }),
          verifyReadback: verified || null,
        },
      );
    }
    return {
      synced: true,
      promoted: false,
      alreadyLive: true,
      registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
      companyId: registryCompanyId,
      companyFolderId: resolvedRootFolderId,
      masterSheetId: resolvedMasterSheetId,
      updatedAt: String(verified.lastSetupAt || now).trim() || now,
      record: verified,
      matchedBy: ensured.matchedBy || "",
    };
  }

  const writeResult = await persistCompanyWorkspaceSetup(auth, deps, {
    companyId: registryCompanyId,
    companyName: companyName || registryRecord.companyName || "",
    rootFolderId: resolvedRootFolderId,
    masterSheetId: resolvedMasterSheetId,
    workbookFolderId: registryRecord.workbookFolderId,
    companyFoldersMappingStatus:
      String(canonicalCompany.companyFoldersMappingStatus || "").trim() ||
      resolveMappingStatusFromChecks(checks, registryRecord.companyFoldersMappingStatus),
    firstAdminStatus:
      String(canonicalCompany.firstAdminStatus || "").trim() ||
      resolveFirstAdminStatusFromChecks(checks, registryRecord.firstAdminStatus),
    status: COMPANY_REGISTRY_STATUS_LIVE,
    setupCompletedAt: registryRecord.setupCompletedAt || now,
    liveAt: now,
    lastSetupAt: now,
    lastHealthCheckAt: String(canonicalCompany.lastHealthCheckAt || registryRecord.lastHealthCheckAt || "").trim(),
    healthStatus: String(canonicalCompany.healthStatus || "HEALTHY").trim(),
    needsAttention: "false",
    setupBlockers: "",
    unlinkReason: "",
    clearUnlinkReason: true,
    markSetupComplete: true,
    markLive: true,
    touchSetup: true,
  });

  const writeDiag = registryDiagnosticsFromWriteResult(writeResult, {
    ...lookupWorkspace,
    companyId: registryCompanyId,
  });

  if (!writeResult.synced) {
    throw createRegistryPersistError(
      REGISTRY_WRITE_FAILED,
      String(writeResult.technicalError || writeResult.reason || "registry_write_failed"),
      writeDiag,
    );
  }

  const fresh = await reloadRegistryRecord(auth, deps, registryCompanyId, companyId);
  const registryStatus = getCanonicalCompanyStatus(fresh || {});
  if (!fresh || !isCompanyRegistryLive(fresh)) {
    throw createRegistryPersistError(
      REGISTRY_VERIFY_FAILED,
      `registry_status=${registryStatus || "unknown"} after write`,
      {
        ...writeDiag,
        verifyReadback: fresh || null,
      },
    );
  }

  return {
    synced: true,
    promoted: true,
    alreadyLive: false,
    registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
    companyId: registryCompanyId,
    companyFolderId: resolvedRootFolderId,
    masterSheetId: String(fresh.masterSheetId || resolvedMasterSheetId).trim(),
    updatedAt: now,
    record: fresh,
    matchedBy: ensured.matchedBy || "",
    persistReason: String(canonicalCompany.reason || "").trim(),
  };
}

/**
 * Persist status=Live on the canonical Companies registry row.
 * Delegates to persistAndVerifyCompanyLive; returns a result object instead of throwing.
 */
export async function persistCompanyLive(auth, deps, input = {}) {
  try {
    const result = await persistAndVerifyCompanyLive(auth, deps, input);
    return {
      synced: true,
      promoted: Boolean(result.promoted),
      alreadyLive: Boolean(result.alreadyLive),
      reason: "",
      registryStatus: result.registryStatus,
      needsAttention: false,
      setupBlockers: [],
      healthStatus: input.healthStatus || "HEALTHY",
      healthIssues: input.healthIssues || [],
      updatedAt: result.updatedAt,
      record: result.record,
      matchedBy: result.matchedBy || "",
      persistReason: result.persistReason || String(input.reason || "").trim(),
    };
  } catch (error) {
    const code = String(error?.code || REGISTRY_WRITE_FAILED).trim();
    const technicalError = String(error?.technicalError || error?.message || "").trim();
    return {
      synced: false,
      promoted: false,
      alreadyLive: false,
      reason: code === REGISTRY_VERIFY_FAILED ? "verify_failed" : String(error?.technicalError || code).trim(),
      registryStatus: getCanonicalCompanyStatus(error?.record || error?.verifyReadback || {}) || "",
      needsAttention: true,
      setupBlockers: [code],
      healthStatus: "",
      updatedAt: "",
      record: error?.record || error?.verifyReadback || null,
      matchedBy: "",
      persistReason: String(input.reason || "").trim(),
      errorCode: code,
      reasonCode: code,
      technicalError,
      userMessage: REGISTRY_PERSIST_ERROR_MESSAGES[code] || technicalError,
      failedStep: error?.failedStep || REGISTRY_PERSIST_FAILED_STEP,
      registrySpreadsheetId: error?.registrySpreadsheetId || "",
      registryTab: error?.registryTab || REGISTRY_TAB_COMPANIES,
      registryLocation: error?.registryLocation || "",
      missingColumns: error?.missingColumns || [],
      lookupKeys: error?.lookupKeys || {},
      verifyReadback: error?.verifyReadback || null,
    };
  }
}

export async function persistCompanyWorkspaceSetup(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.rootFolderId || input.companyFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const rootFolderId = String(input.rootFolderId || companyId || "").trim();
  if (!companyId) {
    return { synced: false, reason: "missing_company_id" };
  }
  const now = nowIso();
  const status =
    input.status ||
    (rootFolderId && masterSheetId ? "Live" : deriveCompanyWorkspaceStatus({ rootFolderId, masterSheetId }));
  const record = {
    companyId,
    companyName: String(input.companyName || "").trim(),
    status,
    rootFolderId,
    masterSheetId,
    workbookFolderId: String(input.workbookFolderId || "").trim(),
    companyFoldersMappingStatus: String(input.companyFoldersMappingStatus || "").trim(),
    firstAdminStatus: String(input.firstAdminStatus || "").trim(),
    lastSetupAt: input.touchSetup === false ? String(input.lastSetupAt || "").trim() : now,
    lastHealthCheckAt: String(input.lastHealthCheckAt || "").trim(),
    setupCompletedAt:
      input.markSetupComplete === false
        ? String(input.setupCompletedAt || "").trim()
        : input.setupCompletedAt || (status === "Live" ? now : ""),
    liveAt: input.markLive === false ? String(input.liveAt || "").trim() : input.liveAt || (status === "Live" ? now : ""),
    unlinkReason: status === "Needs attention" ? String(input.unlinkReason || "").trim() : "",
    healthStatus: String(input.healthStatus || "").trim(),
    needsAttention: String(input.needsAttention ?? "").trim(),
    setupBlockers: String(input.setupBlockers || "").trim(),
    createdAt: String(input.createdAt || "").trim(),
    updatedAt: input.touchSetup === false ? String(input.updatedAt || "").trim() : now,
  };
  const markingLive =
    getCanonicalCompanyStatus({ status }) === COMPANY_REGISTRY_STATUS_LIVE || input.markLive === true;
  const forceClearHeaders = [
    ...(Array.isArray(input.forceClearHeaders) ? input.forceClearHeaders : []),
    ...(markingLive || input.clearUnlinkReason ? ["Unlink Reason"] : []),
  ];
  const result = await upsertCompanyWorkspaceRegistryRecords(auth, deps, [record], {
    forceClearHeaders,
  });
  return {
    ...result,
    technicalError: String(result.technicalError || result.reason || "").trim(),
    record: normalizeCompanyWorkspaceRecord(rowObjectFromCompanyWorkspaceRecord(record)),
  };
}

export async function recordCompanyWorkspaceHealthCheck(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  if (!companyId) {
    return { synced: false, reason: "missing_company_id" };
  }
  const { map } = await readCompanyWorkspaceRegistryMap(auth, deps);
  const match = findCompanyWorkspaceRegistryRecordInMap(map, {
    companyId,
    companyFolderId: companyId,
    rootFolderId: String(input.rootFolderId || companyId).trim(),
    masterSheetId: String(input.masterSheetId || "").trim(),
    companyName: String(input.companyName || "").trim(),
  });
  const existing = match?.record || map.get(companyId) || null;
  const registryCompanyId = String(existing?.companyId || companyId).trim();
  const healthOk = input.healthOk !== false;
  const wasLive = isCompanyRegistryLive(existing);
  const now = nowIso();
  const healthIssues = String(
    input.unlinkReason ||
      input.healthSummary ||
      (healthOk ? "" : "health_check_failed"),
  ).trim();
  // Failed health checks must never erase persisted workspace links.
  const masterSheetId = String(
    healthOk
      ? input.masterSheetId || existing?.masterSheetId || ""
      : existing?.masterSheetId || input.masterSheetId || "",
  ).trim();
  const rootFolderId = String(
    healthOk
      ? input.rootFolderId || existing?.rootFolderId || companyId
      : existing?.rootFolderId || input.rootFolderId || companyId,
  ).trim();

  if (wasLive) {
    return persistCompanyWorkspaceSetup(auth, deps, {
      companyId: registryCompanyId,
      companyName: input.companyName || existing?.companyName || "",
      rootFolderId,
      masterSheetId,
      workbookFolderId: input.workbookFolderId || existing?.workbookFolderId || "",
      companyFoldersMappingStatus: input.companyFoldersMappingStatus || existing?.companyFoldersMappingStatus || "",
      firstAdminStatus: input.firstAdminStatus || existing?.firstAdminStatus || "",
      status: COMPANY_REGISTRY_STATUS_LIVE,
      lastHealthCheckAt: now,
      unlinkReason: healthOk ? "" : healthIssues,
      forceClearHeaders: healthOk ? ["Unlink Reason"] : [],
      touchSetup: false,
      markSetupComplete: false,
      markLive: false,
      setupCompletedAt: existing?.setupCompletedAt || "",
      liveAt: existing?.liveAt || "",
    });
  }

  if (healthOk && rootFolderId && masterSheetId) {
    const readiness = evaluateCompanyWorkspaceReadiness(
      { ...existing, rootFolderId, masterSheetId },
      {
        rootFolderId,
        masterSheetId,
        folderStructureOk: input.folderStructureOk,
        requiredTabsOk: input.requiredTabsOk,
        companyFoldersMappingOk:
          input.companyFoldersMappingOk ??
          (String(input.companyFoldersMappingStatus || existing?.companyFoldersMappingStatus || "")
            .trim()
            .toLowerCase() === "mapped"),
        firstAdminReady:
          input.firstAdminReady ??
          String(input.firstAdminStatus || existing?.firstAdminStatus || "")
            .trim()
            .toLowerCase() !== "pending",
        workspaceHealthOk: true,
        healthCheckRun: true,
        skipHealthCheck: true,
      },
    );
    if (readiness.ready) {
      return persistCompanyLive(auth, deps, {
        companyId: registryCompanyId,
        companyFolderId: companyId,
        rootFolderId,
        masterSheetId,
        companyName: input.companyName || existing?.companyName || "",
        lastHealthCheckAt: now,
        reason: "health_check_ready",
        healthStatus: "HEALTHY",
      });
    }
  }

  const status = healthOk ? existing?.status || "Setup in progress" : "Needs attention";
  return persistCompanyWorkspaceSetup(auth, deps, {
    companyId: registryCompanyId,
    companyName: input.companyName || existing?.companyName || "",
    rootFolderId,
    masterSheetId,
    workbookFolderId: input.workbookFolderId || existing?.workbookFolderId || "",
    companyFoldersMappingStatus: input.companyFoldersMappingStatus || existing?.companyFoldersMappingStatus || "",
    firstAdminStatus: input.firstAdminStatus || existing?.firstAdminStatus || "",
    status,
    lastHealthCheckAt: now,
    unlinkReason: healthOk ? "" : healthIssues,
    touchSetup: false,
    markSetupComplete: false,
    markLive: false,
    setupCompletedAt: existing?.setupCompletedAt || "",
    liveAt: existing?.liveAt || "",
  });
}

export async function repairCompanyWorkspaceRegistry(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  if (!companyId) {
    return { ok: false, code: "missing_company_id", message: "Company ID is required." };
  }
  const existing = (await readCompanyWorkspaceRegistryMap(auth, deps)).map.get(companyId);
  const resolved = {
    companyId,
    companyName: String(input.companyName || existing?.companyName || "").trim(),
    rootFolderId: String(input.rootFolderId || existing?.rootFolderId || companyId).trim(),
    masterSheetId: String(input.masterSheetId || existing?.masterSheetId || "").trim(),
    workbookFolderId: String(input.workbookFolderId || existing?.workbookFolderId || "").trim(),
  };
  if (!resolved.masterSheetId && input.findMasterSheetId) {
    resolved.masterSheetId = String(input.findMasterSheetId || "").trim();
  }
  const diagnostics = [];
  if (!resolved.rootFolderId) {
    diagnostics.push("missing_root_folder_id");
  }
  if (!resolved.masterSheetId) {
    diagnostics.push("missing_master_sheet_id");
  }
  const status = resolved.rootFolderId && resolved.masterSheetId ? "Live" : existing?.status || "Setup in progress";
  await persistCompanyWorkspaceSetup(auth, deps, {
    ...resolved,
    status,
    companyFoldersMappingStatus: input.companyFoldersMappingStatus || existing?.companyFoldersMappingStatus || "",
    firstAdminStatus: input.firstAdminStatus || existing?.firstAdminStatus || "",
    touchSetup: false,
    markSetupComplete: Boolean(existing?.setupCompletedAt || (resolved.masterSheetId && resolved.rootFolderId)),
    markLive: Boolean(existing?.liveAt || status === "Live"),
    setupCompletedAt: existing?.setupCompletedAt || "",
    liveAt: existing?.liveAt || "",
  });
  return {
    ok: diagnostics.length === 0,
    code: diagnostics[0] || "repaired",
    message:
      diagnostics.length > 0
        ? `Workspace link incomplete: ${diagnostics.join(", ")}`
        : "Workspace registry link repaired.",
    diagnostics,
    resolved,
  };
}

const MAPPED_FOLDER_STATUSES = new Set(["mapped", "linked", "repaired"]);

function humanizeBlocker(blocker = "") {
  const normalized = String(blocker || "").trim();
  if (normalized === "not_in_registry") {
    return "Registry link missing — run Repair / complete setup to relink";
  }
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Evaluate whether a company workspace is ready to be marked Live in the registry. */
export function evaluateCompanyWorkspaceReadiness(record = {}, checks = {}) {
  const blockers = [];
  const rootFolderId = String(record.rootFolderId || record.companyId || checks.rootFolderId || "").trim();
  const masterSheetId = String(record.masterSheetId || checks.masterSheetId || "").trim();

  if (!rootFolderId) {
    blockers.push("company_folder_not_linked");
  }
  if (!masterSheetId) {
    blockers.push("master_sheet_not_linked");
  }

  if (checks.folderStructureOk === false) {
    blockers.push("folder_structure_incomplete");
  }
  if (checks.requiredTabsOk === false) {
    blockers.push("required_tabs_missing");
  }
  if (checks.companyFoldersMappingOk === false) {
    blockers.push("companyfolders_mapping_missing");
  } else if (checks.companyFoldersMappingOk === undefined) {
    const mapping = String(record.companyFoldersMappingStatus || "")
      .trim()
      .toLowerCase();
    if (mapping && !MAPPED_FOLDER_STATUSES.has(mapping)) {
      blockers.push("companyfolders_mapping_incomplete");
    }
  }

  if (checks.firstAdminReady === false) {
    blockers.push("first_admin_missing");
  } else if (checks.firstAdminReady === undefined) {
    const firstAdmin = String(record.firstAdminStatus || "")
      .trim()
      .toLowerCase();
    if (firstAdmin === "pending") {
      blockers.push("first_admin_missing");
    }
  }

  if (checks.workspaceHealthOk === false) {
    blockers.push("workspace_health_failed");
  } else if (!checks.skipHealthCheck) {
    if (checks.healthCheckRun === false) {
      blockers.push("health_check_not_run");
    } else if (checks.healthCheckRun === undefined && !record.lastHealthCheckAt) {
      blockers.push("health_check_not_run");
    }
  }

  const explicitChecksPass =
    checks.folderStructureOk === true &&
    checks.requiredTabsOk === true &&
    checks.companyFoldersMappingOk !== false &&
    checks.firstAdminReady === true &&
    checks.workspaceHealthOk === true &&
    (checks.healthCheckRun === true || checks.skipHealthCheck === true);

  const canonicalStatus = getCanonicalCompanyStatus(record) || deriveCompanyWorkspaceStatus(record);
  if (canonicalStatus === "Archived" || canonicalStatus === "Disconnected") {
    blockers.push(`company_${safeLower(canonicalStatus).replace(/\s+/g, "_")}`);
  } else if (explicitChecksPass && rootFolderId && masterSheetId) {
    return {
      ready: true,
      blockers: [],
      setupBlockers: [],
      needsAttention: false,
      canonicalStatus: COMPANY_REGISTRY_STATUS_LIVE,
      registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
    };
  } else if (canonicalStatus === "Needs attention") {
    blockers.push(String(record.unlinkReason || "needs_attention").trim() || "needs_attention");
  }

  const ready = blockers.length === 0 && Boolean(rootFolderId && masterSheetId);
  return {
    ready,
    blockers,
    setupBlockers: blockers,
    needsAttention: blockers.length > 0,
    canonicalStatus,
    registryStatus: canonicalStatus,
  };
}

/** Persist Companies registry status Live when all readiness checks pass. */
export async function ensureCompanyLiveIfReady(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || input.rootFolderId || "").trim();
  if (!companyId || !auth) {
    return { promoted: false, reason: "missing_company_id", blockers: ["missing_company_id"] };
  }
  const checks = input.checks || {};
  const ensured = await ensureCompanyRegistryRecordForWorkspace(auth, deps, {
    companyId,
    companyFolderId: companyId,
    rootFolderId: String(checks.rootFolderId || companyId).trim(),
    masterSheetId: String(checks.masterSheetId || input.masterSheetId || "").trim(),
    companyName: String(input.companyName || "").trim(),
  }).catch(() => ({ record: null, created: false, reason: "ensure_failed" }));
  let existing = ensured.record || (await getCompanyWorkspaceRegistryRecord(auth, deps, companyId));
  if (!existing) {
    return { promoted: false, reason: "not_in_registry", blockers: ["not_in_registry"] };
  }
  const readiness = evaluateCompanyWorkspaceReadiness(existing, input.checks || {});
  if (isCompanyRegistryLive(existing)) {
    return {
      promoted: false,
      alreadyLive: true,
      status: COMPANY_REGISTRY_STATUS_LIVE,
      blockers: [],
      setupBlockers: [],
      needsAttention: false,
      registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
      record: existing,
    };
  }
  if (!readiness.ready) {
    return {
      promoted: false,
      reason: "not_ready",
      blockers: readiness.blockers,
      setupBlockers: readiness.setupBlockers,
      needsAttention: true,
      registryStatus: readiness.canonicalStatus,
      record: existing,
    };
  }
  const resolvedMasterSheetId = String(checks.masterSheetId || existing.masterSheetId || "").trim();
  const resolvedRootFolderId = String(checks.rootFolderId || existing.rootFolderId || companyId).trim();
  try {
    const result = await persistAndVerifyCompanyLive(auth, deps, {
      companyId: String(existing.companyId || companyId).trim(),
      companyFolderId: companyId,
      companyName: String(input.companyName || existing.companyName || "").trim(),
      rootFolderId: resolvedRootFolderId,
      masterSheetId: resolvedMasterSheetId,
      lastHealthCheckAt: existing.lastHealthCheckAt || (checks.healthCheckRun ? nowIso() : ""),
      reason: "ensure_ready",
      checks,
    });
    return {
      promoted: Boolean(result.promoted),
      alreadyLive: Boolean(result.alreadyLive),
      status: COMPANY_REGISTRY_STATUS_LIVE,
      blockers: [],
      setupBlockers: [],
      needsAttention: false,
      registryStatus: result.registryStatus,
      record: result.record,
    };
  } catch (error) {
    const code = String(error?.code || REGISTRY_WRITE_FAILED).trim();
    return {
      promoted: false,
      reason: code,
      blockers: [code],
      setupBlockers: [code],
      needsAttention: true,
      registryStatus: getCanonicalCompanyStatus(existing) || "",
      record: existing,
      technicalError: String(error?.technicalError || error?.message || "").trim(),
      userMessage: REGISTRY_PERSIST_ERROR_MESSAGES[code] || "",
    };
  }
}

export function mergeDriveCompanyWithRegistry(driveCompany, registryRecord) {
  if (!registryRecord) {
    return driveCompany;
  }
  const masterSheetId =
    String(registryRecord.masterSheetId || "").trim() ||
    String(driveCompany.masterSheetId || driveCompany.responseSheetId || "").trim();
  const canonicalStatus = getCanonicalCompanyStatus(registryRecord);
  const derivedStatus = deriveCompanyWorkspaceStatus(registryRecord);
  const setupStatusLabel =
    canonicalStatus === COMPANY_REGISTRY_STATUS_LIVE
      ? "Ready"
      : canonicalStatus === "Needs attention"
        ? "Needs attention"
        : canonicalStatus ||
          (derivedStatus === "Live" ? "Setup in progress" : derivedStatus) ||
          driveCompany.setupStatusLabel;
  return {
    ...driveCompany,
    masterSheetId,
    responseSheetId: masterSheetId || driveCompany.responseSheetId,
    responseSheetVerified: Boolean(masterSheetId) || driveCompany.responseSheetVerified,
    setupStatus: masterSheetId ? "ready" : driveCompany.setupStatus || "incomplete",
    setupStatusLabel,
    registryStatus: canonicalStatus,
    registryUnlinkReason: registryRecord.unlinkReason,
    firstAdminStatus: registryRecord.firstAdminStatus || driveCompany.firstAdminStatus,
    workbookFolderId: registryRecord.workbookFolderId || driveCompany.workbookFolderId,
    setupCompletedAt: registryRecord.setupCompletedAt,
    liveAt: registryRecord.liveAt,
  };
}

export function installCompanyWorkspaceRegistryRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  function maybeQueueBackgroundHealthCheck(record, requestedBy = "system") {
    if (typeof deps.queueCompanyHealthCheckIfReady !== "function" || !record) {
      return null;
    }
    const companyId = String(record.companyId || record.rootFolderId || "").trim();
    const masterSheetId = String(record.masterSheetId || "").trim();
    const hasFolder = Boolean(String(record.rootFolderId || record.companyId || "").trim());
    const healthCheckRun = Boolean(String(record.lastHealthCheckAt || "").trim());
    const unlinkReason = String(record.unlinkReason || "").trim().toLowerCase();
    const phase = resolveCompanySetupPhase({
      companyLive: isCompanyRegistryLive(record),
      hasCompanyFolder: hasFolder,
      masterSheetId,
      syncState: hasFolder && masterSheetId ? "Synced" : "",
      healthCheckRun,
      workspaceHealthOk: !unlinkReason.includes("health_check_failed"),
    });
    if (!shouldAutoQueueHealthCheck(phase)) {
      return null;
    }
    return deps.queueCompanyHealthCheckIfReady({
      autoQueue: true,
      companyId,
      requestedBy,
      payload: {
        masterSheetId,
        companyFolderId: companyId,
        companyName: String(record.companyName || "").trim(),
      },
    });
  }

  app.get("/api/godmode/company-workspace", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (_req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({ ok: false, error: "Connect Google Workspace before loading company registry." });
    }
    try {
      const { spreadsheetId, map } = await readCompanyWorkspaceRegistryMap(authed, deps);
      return res.json({
        ok: true,
        registrySpreadsheetId: spreadsheetId || undefined,
        companies: filterCustomerFacingCompanies(Array.from(map.values())),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load company workspace registry.",
      });
    }
  });

  app.get(
    "/api/godmode/company-workspace/:companyId",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before loading company registry." });
      }
      try {
        const companyId = String(req.params.companyId || "").trim();
        const record = await getCompanyWorkspaceRegistryRecord(authed, deps, companyId);
        if (!record) {
          return res.status(404).json({ ok: false, error: "Company workspace record not found in registry." });
        }
        const actor =
          typeof deps.parseBertActorFromRequest === "function" ? deps.parseBertActorFromRequest(req) : null;
        maybeQueueBackgroundHealthCheck(record, String(actor?.email || actor?.name || "godmode").trim());
        return res.json({
          ok: true,
          company: record,
          unlinkReason: diagnoseCompanyWorkspaceUnlink(record),
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to load company workspace record.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/companies/:companyId/ensure-background-health",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before queueing background health." });
      }
      try {
        const companyId = String(req.params.companyId || "").trim();
        const record = await getCompanyWorkspaceRegistryRecord(authed, deps, companyId);
        if (!record) {
          return res.status(404).json({ ok: false, error: "Company workspace record not found in registry." });
        }
        const actor =
          typeof deps.parseBertActorFromRequest === "function" ? deps.parseBertActorFromRequest(req) : null;
        const job = maybeQueueBackgroundHealthCheck(
          record,
          String(actor?.email || actor?.name || "godmode").trim(),
        );
        return res.json({ ok: true, queued: Boolean(job), jobId: job?.jobId || "" });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to queue background health check.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/company-workspace/persist",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before saving company workspace links." });
      }
      try {
        const result = await persistCompanyWorkspaceSetup(authed, deps, req.body || {});
        if (!result.synced) {
          return res.status(400).json({ ok: false, error: result.reason || "Unable to persist company workspace." });
        }
        return res.json({ ok: true, company: result.record, registrySpreadsheetId: result.registrySpreadsheetId });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to persist company workspace.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/company-workspace/repair",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before repairing company workspace links." });
      }
      try {
        const result = await repairCompanyWorkspaceRegistry(authed, deps, req.body || {});
        return res.json({ ok: result.ok, ...result });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to repair company workspace registry link.",
        });
      }
    },
  );

  app.post(
    "/api/godmode/company-workspace/mark-live-if-ready",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before updating company registry status." });
      }
      try {
        const companyId = String(req.body?.companyId || req.body?.companyFolderId || "").trim();
        if (!companyId) {
          return res.status(400).json({ ok: false, error: "Company ID is required." });
        }
        const result = await ensureCompanyLiveIfReady(authed, deps, {
          companyId,
          companyName: String(req.body?.companyName || "").trim(),
          checks: req.body?.checks || {},
        });
        if (!result.promoted && !result.alreadyLive) {
          return res.status(409).json({
            ok: false,
            code: "COMPANY_NOT_READY",
            error:
              result.blockers?.length > 0
                ? `Company is not ready to go live: ${result.blockers.map(humanizeBlocker).join("; ")}`
                : "Company is not ready to go live.",
            blockers: result.blockers || [],
            setupBlockers: result.setupBlockers || [],
            registryStatus: result.registryStatus || "",
          });
        }
        return res.json({
          ok: true,
          promoted: Boolean(result.promoted),
          alreadyLive: Boolean(result.alreadyLive),
          registryStatus: result.registryStatus || COMPANY_REGISTRY_STATUS_LIVE,
          company: result.record,
          blockers: [],
          setupBlockers: [],
          needsAttention: false,
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to mark company live.",
        });
      }
    },
  );
}
