/**
 * Controlled Documents — Google Drive folder provisioning and folder registry.
 */
import {
  buildFolderRecordId,
  buildIso9001FolderTemplate,
  CONTROLLED_DOCUMENTS_DRIVE_ROOT,
  DOCUMENT_FOLDERS_TAB,
  DOCUMENT_FOLDERS_TAB_COLUMNS,
  mapDocumentFolderRecord,
} from "../shared/document-schema.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
  writeTabRecords as workbookWriteTabRecords,
} from "./workbook-service.mjs";

const provisionInFlight = new Map();

function trim(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveWriteTabRecords(deps) {
  return typeof deps?.writeTabRecords === "function" ? deps.writeTabRecords : workbookWriteTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

async function ensureNamedFolder(drive, name, parentId) {
  const safeName = String(name || "").replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = response?.data?.files?.[0];
  if (existing?.id) {
    return { folderId: existing.id, created: false };
  }
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name",
  });
  return { folderId: created.data.id, created: true };
}

async function ensureDocumentFolderTab(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_FOLDERS_TAB, DOCUMENT_FOLDERS_TAB_COLUMNS);
}

async function readFolderRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, DOCUMENT_FOLDERS_TAB, {
    expectedHeaders: DOCUMENT_FOLDERS_TAB_COLUMNS,
  });
  return (result?.records || []).map(mapDocumentFolderRecord).filter(Boolean);
}

function indexFoldersByPath(folders = []) {
  const byPath = new Map();
  for (const folder of folders) {
    if (folder.folderPath) {
      byPath.set(folder.folderPath.toLowerCase(), folder);
    }
  }
  return byPath;
}

function walkTemplate(node, pathPrefix, sortBase, rows, existingByPath, summary) {
  const name = trim(node.name);
  if (!name) {
    return;
  }
  const folderPath = pathPrefix ? `${pathPrefix}/${name}` : name;
  const existing = existingByPath.get(folderPath.toLowerCase());
  const sortOrder = Number.isFinite(node.sortOrder) ? node.sortOrder : sortBase;
  rows.push({
    folderRecordId: existing?.folderRecordId || buildFolderRecordId(),
    parentFolderRecordId: "",
    folderName: name,
    folderPath,
    folderType: trim(node.folderType) || "folder",
    isoClause: trim(node.isoClause),
    sortOrder,
    googleFolderId: existing?.googleFolderId || "",
    active: existing?.active !== false,
    createdAt: existing?.createdAt || nowIso(),
  });
  summary.planned += 1;
  let childSort = 0;
  for (const child of node.children || []) {
    walkTemplate(child, folderPath, childSort++, rows, existingByPath, summary);
  }
}

function linkFolderParents(rows) {
  const byPath = new Map(rows.map((row) => [row.folderPath.toLowerCase(), row]));
  for (const row of rows) {
    const slash = row.folderPath.lastIndexOf("/");
    if (slash < 0) {
      row.parentFolderRecordId = "";
      continue;
    }
    const parentPath = row.folderPath.slice(0, slash).toLowerCase();
    const parent = byPath.get(parentPath);
    row.parentFolderRecordId = parent?.folderRecordId || "";
  }
}

async function provisionDriveTree(drive, companyRootFolderId, rows, summary) {
  const byPath = new Map(rows.map((row) => [row.folderPath.toLowerCase(), row]));
  const sorted = [...rows].sort((a, b) => a.folderPath.split("/").length - b.folderPath.split("/").length);
  for (const row of sorted) {
    if (row.googleFolderId) {
      summary.reused += 1;
      continue;
    }
    const slash = row.folderPath.lastIndexOf("/");
    const parentPath = slash >= 0 ? row.folderPath.slice(0, slash).toLowerCase() : "";
    const parent = parentPath ? byPath.get(parentPath) : null;
    const parentDriveId = parent?.googleFolderId || companyRootFolderId;
    const ensured = await ensureNamedFolder(drive, row.folderName, parentDriveId);
    row.googleFolderId = ensured.folderId;
    if (ensured.created) {
      summary.created += 1;
    } else {
      summary.reused += 1;
    }
  }
}

function folderRowsToSheet(rows) {
  return rows.map((row) => ({
    FolderRecordID: row.folderRecordId,
    ParentFolderRecordID: row.parentFolderRecordId || "",
    GoogleFolderID: row.googleFolderId || "",
    FolderName: row.folderName,
    FolderPath: row.folderPath,
    FolderType: row.folderType || "folder",
    ISOClause: row.isoClause || "",
    SortOrder: String(row.sortOrder ?? 0),
    Active: row.active === false ? "No" : "Yes",
    CreatedAt: row.createdAt || nowIso(),
  }));
}

export async function listDocumentFolders(auth, deps, context) {
  const masterSheetId = trim(context.masterSheetId);
  if (!masterSheetId) {
    return { ok: false, code: "DOCUMENT_FOLDERS_CONTEXT", error: "Company workbook is required.", httpStatus: 400 };
  }
  await ensureDocumentFolderTab(auth, deps, masterSheetId);
  const folders = await readFolderRecords(auth, deps, masterSheetId);
  folders.sort((a, b) => {
    const order = a.sortOrder - b.sortOrder;
    if (order !== 0) {
      return order;
    }
    return a.folderName.localeCompare(b.folderName);
  });
  return { ok: true, folders };
}

export async function provisionDocumentFolders(auth, deps, context, drive) {
  const startedAt = Date.now();
  const companyFolderId = trim(context.companyFolderId || context.companyId);
  const masterSheetId = trim(context.masterSheetId);
  const companyRootFolderId = trim(context.companyFolderId || context.companyId);
  if (!masterSheetId || !companyRootFolderId) {
    return {
      ok: false,
      code: "DOCUMENT_PROVISION_CONTEXT",
      error: "Company workbook and folder are required.",
      httpStatus: 400,
    };
  }

  const dedupeKey = `${companyFolderId}:${masterSheetId}`;
  if (provisionInFlight.has(dedupeKey)) {
    return provisionInFlight.get(dedupeKey);
  }

  const promise = (async () => {
    const timings = { startedAt };
    await ensureDocumentFolderTab(auth, deps, masterSheetId);
    timings.ensureTabMs = Date.now() - startedAt;

    const readStart = Date.now();
    const existing = await readFolderRecords(auth, deps, masterSheetId);
    const existingByPath = indexFoldersByPath(existing);
    timings.readRegistryMs = Date.now() - readStart;

    const summary = { planned: 0, created: 0, reused: 0, registryRows: 0, registryReused: existing.length };
    const template = buildIso9001FolderTemplate();
    const rows = [];
    walkTemplate(template, "", 0, rows, existingByPath, summary);
    linkFolderParents(rows);

    const driveStart = Date.now();
    await provisionDriveTree(drive, companyRootFolderId, rows, summary);
    timings.provisionDriveMs = Date.now() - driveStart;

    const writeStart = Date.now();
    const writeTabRecords = resolveWriteTabRecords(deps);
    await writeTabRecords(auth, deps, masterSheetId, DOCUMENT_FOLDERS_TAB, DOCUMENT_FOLDERS_TAB_COLUMNS, folderRowsToSheet(rows));
    timings.writeRegistryMs = Date.now() - writeStart;
    summary.registryRows = rows.length;

    timings.totalMs = Date.now() - startedAt;
    console.info("document_folder_provision_timings", {
      companyFolderId,
      masterSheetId,
      ...timings,
      summary,
    });

    const folders = rows
      .map((row) => mapDocumentFolderRecord({
        FolderRecordID: row.folderRecordId,
        ParentFolderRecordID: row.parentFolderRecordId,
        GoogleFolderID: row.googleFolderId,
        FolderName: row.folderName,
        FolderPath: row.folderPath,
        FolderType: row.folderType,
        ISOClause: row.isoClause,
        SortOrder: String(row.sortOrder),
        Active: "Yes",
        CreatedAt: row.createdAt,
      }))
      .filter(Boolean);

    return { ok: true, summary, folders, timings };
  })();

  provisionInFlight.set(dedupeKey, promise);
  try {
    return await promise;
  } finally {
    provisionInFlight.delete(dedupeKey);
  }
}

export function resolveFolderByRecordId(folders, folderRecordId) {
  const target = trim(folderRecordId);
  return folders.find((entry) => entry.folderRecordId === target) || null;
}

export function resolveFolderGoogleId(folders, folderRecordId) {
  const folder = resolveFolderByRecordId(folders, folderRecordId);
  return folder?.googleFolderId || "";
}

export { CONTROLLED_DOCUMENTS_DRIVE_ROOT };
