import {
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import { filterCustomerFacingCompanies, isSystemTemplateCompany } from "../shared/system-template-company.mjs";

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
];

const COMPANY_ID_HEADERS = ["company id", "company folder id"];
const ROOT_FOLDER_HEADERS = ["root folder id", "company folder id", "company id"];
const MASTER_SHEET_HEADERS = ["master sheet id"];
const WORKBOOK_FOLDER_HEADERS = ["workbook folder id"];
const STATUS_HEADERS = ["status"];
const UNLINK_REASON_HEADERS = ["unlink reason"];

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
export function mergeRegistryRowCells(existingRow, headerRow, incomingByHeader, { allowClear = false } = {}) {
  const width = Math.max(headerRow.length, existingRow?.length || 0, COMPANIES_WORKSPACE_COLUMNS.length);
  const next = Array.from({ length: width }, (_, index) => String(existingRow?.[index] ?? "").trim());
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
    if (!allowClear && isBlank(incoming) && !isBlank(current)) {
      continue;
    }
    if (!isBlank(incoming) || allowClear) {
      next[index] = incoming;
    }
  }
  return next;
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
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "drive",
    driveId: sharedDriveId,
    q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${REGISTRY_SPREADSHEET_NAME.replace(/'/g, "\\'")}'`,
    fields: "files(id,name)",
    pageSize: 5,
  });
  return response.data.files?.[0]?.id || "";
}

async function ensureRegistryTab(auth, sheetsApi, spreadsheetId, tabName, headers, deps) {
  const { getWorkbook, ensureTabExists, ensureColumns } = deps;
  let workbook = await getWorkbook(auth, spreadsheetId);
  const { workbook: workbookAfter } = await ensureTabExists(auth, spreadsheetId, tabName, workbook);
  workbook = workbookAfter;
  await ensureColumns(auth, spreadsheetId, tabName, headers);
  return workbook;
}

function recordsFromSheetValues(values, headerRow) {
  const headers = values[0] || headerRow;
  const idIndex = headerIndex(headers, COMPANY_ID_HEADERS);
  const map = new Map();
  for (const row of values.slice(1)) {
    const companyId = cellValue(row, idIndex);
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
  return map.get(id) || null;
}

export async function upsertCompanyWorkspaceRegistryRecords(
  auth,
  deps,
  records,
  { allowClear = false, mergeBlanksOnly = true } = {},
) {
  const sanitized = Array.isArray(records) ? records : [records];
  if (!sanitized.length) {
    return { synced: false, reason: "no_records" };
  }
  const drive = deps.google.drive({ version: "v3", auth });
  const sheetsApi = deps.google.sheets({ version: "v4", auth });
  const spreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  if (!spreadsheetId) {
    return { synced: false, reason: "registry_missing" };
  }

  await ensureRegistryTab(auth, sheetsApi, spreadsheetId, REGISTRY_TAB_COMPANIES, COMPANIES_WORKSPACE_COLUMNS, deps);
  const existingValues = await deps.getTabValues(auth, spreadsheetId, REGISTRY_TAB_COMPANIES);
  const headerRow = existingValues[0]?.length ? existingValues[0] : [...COMPANIES_WORKSPACE_COLUMNS];
  const idIndex = headerIndex(headerRow, COMPANY_ID_HEADERS);
  const dataRows = existingValues.length > 1 ? existingValues.slice(1) : [];
  const nextRows = dataRows.map((row) => [...row]);

  for (const rawRecord of sanitized) {
    const normalized = normalizeCompanyWorkspaceRecord(rawRecord, headerRow);
    const companyId = normalized.companyId || normalized.rootFolderId;
    if (!companyId) {
      continue;
    }
    const incoming = rowObjectFromCompanyWorkspaceRecord(
      {
        ...normalized,
        companyId,
        rootFolderId: normalized.rootFolderId || companyId,
        status: normalized.status || deriveCompanyWorkspaceStatus(normalized),
      },
      headerRow,
    );
    const rowIndex = nextRows.findIndex((row) => cellValue(row, idIndex) === companyId);
    if (rowIndex === -1) {
      const mapped = headerRow.map((header) => String(incoming[header] ?? "").trim());
      if (idIndex >= 0) {
        mapped[idIndex] = companyId;
      }
      const legacyFolderIndex = headerIndex(headerRow, ["company folder id"]);
      if (legacyFolderIndex >= 0 && legacyFolderIndex !== idIndex) {
        mapped[legacyFolderIndex] = companyId;
      }
      nextRows.push(mapped);
      continue;
    }
    const existingRowObject = {};
    headerRow.forEach((header, index) => {
      existingRowObject[header] = cellValue(nextRows[rowIndex], index);
    });
    const mergedRecord = mergeBlanksOnly
      ? {
          ...normalizeCompanyWorkspaceRecord(existingRowObject, headerRow),
          ...Object.fromEntries(
            Object.entries(incoming).filter(([, value]) => !isBlank(value)),
          ),
          companyId,
          rootFolderId: incoming["Root Folder ID"] || existingRowObject["Root Folder ID"] || companyId,
          masterSheetId: incoming["Master Sheet ID"] || existingRowObject["Master Sheet ID"] || "",
          workbookFolderId: incoming["Workbook Folder ID"] || existingRowObject["Workbook Folder ID"] || "",
        }
      : normalizeCompanyWorkspaceRecord({ ...existingRowObject, ...incoming }, headerRow);
    const mergedRow = mergeRegistryRowCells(
      nextRows[rowIndex],
      headerRow,
      rowObjectFromCompanyWorkspaceRecord(mergedRecord, headerRow),
      { allowClear },
    );
    nextRows[rowIndex] = mergedRow;
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${REGISTRY_TAB_COMPANIES}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headerRow, ...nextRows] },
  });

  return { synced: true, registrySpreadsheetId: spreadsheetId };
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
  };
  const result = await upsertCompanyWorkspaceRegistryRecords(auth, deps, [record]);
  return { ...result, record: normalizeCompanyWorkspaceRecord(rowObjectFromCompanyWorkspaceRecord(record)) };
}

export async function recordCompanyWorkspaceHealthCheck(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  if (!companyId) {
    return { synced: false, reason: "missing_company_id" };
  }
  const existing = (await readCompanyWorkspaceRegistryMap(auth, deps)).map.get(companyId);
  const healthOk = input.healthOk !== false;
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
  const status = healthOk
    ? masterSheetId && rootFolderId
      ? "Live"
      : existing?.status || "Setup in progress"
    : "Needs attention";
  return persistCompanyWorkspaceSetup(auth, deps, {
    companyId,
    companyName: input.companyName || existing?.companyName || "",
    rootFolderId,
    masterSheetId,
    workbookFolderId: input.workbookFolderId || existing?.workbookFolderId || "",
    companyFoldersMappingStatus: input.companyFoldersMappingStatus || existing?.companyFoldersMappingStatus || "",
    firstAdminStatus: input.firstAdminStatus || existing?.firstAdminStatus || "",
    status,
    lastHealthCheckAt: nowIso(),
    unlinkReason: healthOk ? "" : String(input.unlinkReason || input.healthSummary || "health_check_failed").trim(),
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
  return String(blocker || "")
    .trim()
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

  const canonicalStatus = getCanonicalCompanyStatus(record) || deriveCompanyWorkspaceStatus(record);
  if (canonicalStatus === "Archived" || canonicalStatus === "Disconnected") {
    blockers.push(`company_${safeLower(canonicalStatus).replace(/\s+/g, "_")}`);
  }
  if (canonicalStatus === "Needs attention") {
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
  const existing = await getCompanyWorkspaceRegistryRecord(auth, deps, companyId);
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
  const now = nowIso();
  const result = await persistCompanyWorkspaceSetup(auth, deps, {
    companyId,
    companyName: String(input.companyName || existing.companyName || "").trim(),
    rootFolderId: existing.rootFolderId || companyId,
    masterSheetId: existing.masterSheetId,
    workbookFolderId: existing.workbookFolderId,
    companyFoldersMappingStatus: existing.companyFoldersMappingStatus,
    firstAdminStatus: existing.firstAdminStatus,
    status: COMPANY_REGISTRY_STATUS_LIVE,
    setupCompletedAt: existing.setupCompletedAt || now,
    liveAt: now,
    unlinkReason: "",
    markSetupComplete: true,
    markLive: true,
    touchSetup: false,
  });
  return {
    promoted: Boolean(result.synced),
    status: COMPANY_REGISTRY_STATUS_LIVE,
    blockers: [],
    setupBlockers: [],
    needsAttention: false,
    registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
    record: result.record || existing,
  };
}

export function mergeDriveCompanyWithRegistry(driveCompany, registryRecord) {
  if (!registryRecord) {
    return driveCompany;
  }
  const masterSheetId =
    String(registryRecord.masterSheetId || "").trim() ||
    String(driveCompany.masterSheetId || driveCompany.responseSheetId || "").trim();
  const canonicalStatus = getCanonicalCompanyStatus(registryRecord) || deriveCompanyWorkspaceStatus(registryRecord);
  const setupStatusLabel =
    canonicalStatus === COMPANY_REGISTRY_STATUS_LIVE
      ? "Ready"
      : canonicalStatus === "Needs attention"
        ? "Needs attention"
        : canonicalStatus || driveCompany.setupStatusLabel;
  return {
    ...driveCompany,
    masterSheetId,
    responseSheetId: masterSheetId || driveCompany.responseSheetId,
    responseSheetVerified: Boolean(masterSheetId) || driveCompany.responseSheetVerified,
    setupStatus: masterSheetId ? "ready" : driveCompany.setupStatus || "incomplete",
    setupStatusLabel,
    registryStatus: canonicalStatus,
    registryUnlinkReason: registryRecord.unlinkReason,
    workbookFolderId: registryRecord.workbookFolderId || driveCompany.workbookFolderId,
    setupCompletedAt: registryRecord.setupCompletedAt,
    liveAt: registryRecord.liveAt,
  };
}

export function installCompanyWorkspaceRegistryRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

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
