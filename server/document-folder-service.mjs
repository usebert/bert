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

function googleErrorDetails(error) {
  const status = Number(error?.code || error?.response?.status || 0);
  const apiError = error?.response?.data?.error || {};
  return {
    googleErrorCode: status || undefined,
    googleErrorReason: trim(apiError.errors?.[0]?.reason) || undefined,
    googleErrorMessage: trim(apiError.message || error?.message) || "Google API request failed.",
    googleErrorStatus: trim(apiError.status) || undefined,
  };
}

function buildDriveDiagnostic(stage, operation, details = {}) {
  return {
    stage,
    operation,
    ...details,
  };
}

function buildDriveStageError(stage, operation, details = {}, cause) {
  const diagnostic = buildDriveDiagnostic(stage, operation, details);
  const error = new Error(
    details.googleErrorMessage ||
      `Drive ${operation} failed for "${details.targetFolderName || "folder"}" under parent ${details.parentFolderId || "(unknown)"}.`,
  );
  error.stage = stage;
  error.operation = operation;
  error.diagnostics = diagnostic;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function verifyDriveFolder(drive, folderId, context = {}) {
  const id = trim(folderId);
  if (!id) {
    return {
      ok: false,
      ...buildDriveDiagnostic(context.stage || "creating_iso_document_structure", context.operation || "verify_parent_folder", {
        parentFolderId: "",
        targetFolderName: context.targetFolderName || "",
        googleErrorMessage: "Parent folder ID is missing.",
      }),
    };
  }
  try {
    const response = await drive.files.get({
      fileId: id,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed,parents",
    });
    const file = response.data || {};
    if (file.trashed) {
      return {
        ok: false,
        ...buildDriveDiagnostic(context.stage || "creating_iso_document_structure", context.operation || "verify_parent_folder", {
          parentFolderId: id,
          targetFolderName: context.targetFolderName || trim(file.name),
          googleErrorMessage: `Drive folder "${trim(file.name) || id}" is in trash.`,
        }),
      };
    }
    if (file.mimeType && file.mimeType !== "application/vnd.google-apps.folder") {
      return {
        ok: false,
        ...buildDriveDiagnostic(context.stage || "creating_iso_document_structure", context.operation || "verify_parent_folder", {
          parentFolderId: id,
          targetFolderName: context.targetFolderName || trim(file.name),
          googleErrorMessage: `Drive item ${id} is not a folder.`,
        }),
      };
    }
    return {
      ok: true,
      folderId: id,
      folderName: trim(file.name),
    };
  } catch (error) {
    const google = googleErrorDetails(error);
    return {
      ok: false,
      ...buildDriveDiagnostic(context.stage || "creating_iso_document_structure", context.operation || "verify_parent_folder", {
        parentFolderId: id,
        targetFolderName: context.targetFolderName || "",
        ...google,
      }),
    };
  }
}

async function ensureNamedFolder(drive, name, parentId, context = {}) {
  const stage = context.stage || "creating_iso_document_structure";
  const targetFolderName = trim(name);
  const parentFolderId = trim(parentId);
  const parentCheck = await verifyDriveFolder(drive, parentFolderId, {
    stage,
    operation: "verify_parent_folder",
    targetFolderName,
  });
  if (!parentCheck.ok) {
    throw buildDriveStageError(stage, "verify_parent_folder", parentCheck, null);
  }

  const safeName = targetFolderName.replace(/'/g, "\\'");
  let response;
  try {
    response = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  } catch (error) {
    const google = googleErrorDetails(error);
    throw buildDriveStageError(
      stage,
      "list_folder_by_name",
      buildDriveDiagnostic(stage, "list_folder_by_name", {
        parentFolderId,
        targetFolderName,
        sourceTemplateId: context.sourceTemplateId || undefined,
        ...google,
      }),
      error,
    );
  }

  const existing = response?.data?.files?.[0];
  if (existing?.id) {
    console.info("document_folder_provision_drive", {
      ...buildDriveDiagnostic(stage, "reuse_folder", {
        parentFolderId,
        targetFolderName,
        folderId: existing.id,
      }),
    });
    return { folderId: existing.id, created: false };
  }

  try {
    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: targetFolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id,name",
    });
    console.info("document_folder_provision_drive", {
      ...buildDriveDiagnostic(stage, "create_folder", {
        parentFolderId,
        targetFolderName,
        folderId: created.data.id,
      }),
    });
    return { folderId: created.data.id, created: true };
  } catch (error) {
    const google = googleErrorDetails(error);
    throw buildDriveStageError(
      stage,
      "create_folder",
      buildDriveDiagnostic(stage, "create_folder", {
        parentFolderId,
        targetFolderName,
        sourceTemplateId: context.sourceTemplateId || undefined,
        ...google,
      }),
      error,
    );
  }
}

async function ensureDocumentFolderTab(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  try {
    await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_FOLDERS_TAB, DOCUMENT_FOLDERS_TAB_COLUMNS);
  } catch (error) {
    const google = googleErrorDetails(error);
    throw buildDriveStageError(
      "creating_iso_document_structure",
      "ensure_document_folders_tab",
      buildDriveDiagnostic("creating_iso_document_structure", "ensure_document_folders_tab", {
        spreadsheetId: masterSheetId,
        targetFolderName: DOCUMENT_FOLDERS_TAB,
        ...google,
      }),
      error,
    );
  }
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

async function resolveStoredFolderId(drive, row, parentDriveId, companyRootFolderId, byPath, summary, stage) {
  const storedId = trim(row.googleFolderId);
  if (!storedId) {
    return "";
  }
  const verified = await verifyDriveFolder(drive, storedId, {
    stage,
    operation: "verify_registry_folder_id",
    targetFolderName: row.folderName,
    parentFolderId: parentDriveId,
  });
  if (verified.ok) {
    summary.reused += 1;
    return storedId;
  }
  summary.staleRecovered = (summary.staleRecovered || 0) + 1;
  console.warn("document_folder_provision_drive", {
    ...buildDriveDiagnostic(stage, "recover_stale_registry_folder_id", {
      parentFolderId: parentDriveId,
      targetFolderName: row.folderName,
      folderPath: row.folderPath,
      sourceTemplateId: storedId,
      ...verified,
    }),
  });
  row.googleFolderId = "";
  return "";
}

async function provisionDriveTree(drive, companyRootFolderId, rows, summary) {
  const stage = "creating_iso_document_structure";
  const companyRootCheck = await verifyDriveFolder(drive, companyRootFolderId, {
    stage,
    operation: "verify_company_root",
    targetFolderName: CONTROLLED_DOCUMENTS_DRIVE_ROOT,
  });
  if (!companyRootCheck.ok) {
    throw buildDriveStageError(stage, "verify_company_root", companyRootCheck, null);
  }

  const byPath = new Map(rows.map((row) => [row.folderPath.toLowerCase(), row]));
  const sorted = [...rows].sort((a, b) => a.folderPath.split("/").length - b.folderPath.split("/").length);
  for (const row of sorted) {
    const slash = row.folderPath.lastIndexOf("/");
    const parentPath = slash >= 0 ? row.folderPath.slice(0, slash).toLowerCase() : "";
    const parent = parentPath ? byPath.get(parentPath) : null;
    const parentDriveId = parent?.googleFolderId || companyRootFolderId;

    if (row.googleFolderId) {
      const resolved = await resolveStoredFolderId(drive, row, parentDriveId, companyRootFolderId, byPath, summary, stage);
      if (resolved) {
        row.googleFolderId = resolved;
        continue;
      }
    }

    const ensured = await ensureNamedFolder(drive, row.folderName, parentDriveId, {
      stage,
      sourceTemplateId: parent?.googleFolderId || companyRootFolderId,
    });
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

    const summary = {
      planned: 0,
      created: 0,
      reused: 0,
      staleRecovered: 0,
      registryRows: 0,
      registryReused: existing.length,
    };
    const template = buildIso9001FolderTemplate();
    const rows = [];
    walkTemplate(template, "", 0, rows, existingByPath, summary);
    linkFolderParents(rows);

    const driveStart = Date.now();
    await provisionDriveTree(drive, companyRootFolderId, rows, summary);
    timings.provisionDriveMs = Date.now() - driveStart;

    const writeStart = Date.now();
    const writeTabRecords = resolveWriteTabRecords(deps);
    try {
      await writeTabRecords(auth, deps, masterSheetId, DOCUMENT_FOLDERS_TAB, DOCUMENT_FOLDERS_TAB_COLUMNS, folderRowsToSheet(rows));
    } catch (error) {
      const google = googleErrorDetails(error);
      throw buildDriveStageError(
        "creating_iso_document_structure",
        "write_document_folders_tab",
        buildDriveDiagnostic("creating_iso_document_structure", "write_document_folders_tab", {
          spreadsheetId: masterSheetId,
          parentFolderId: companyRootFolderId,
          targetFolderName: DOCUMENT_FOLDERS_TAB,
          ...google,
        }),
        error,
      );
    }
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

export { CONTROLLED_DOCUMENTS_DRIVE_ROOT, buildDriveDiagnostic, verifyDriveFolder };
