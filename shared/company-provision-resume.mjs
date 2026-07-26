/**
 * Infer and merge company provisioning completedStages for CLI resume flows.
 */
import { COMPANY_PROVISION_STAGES } from "../server/company-provisioning-service.mjs";
import { CONTROLLED_DOCUMENTS_DRIVE_ROOT } from "./document-schema.mjs";

export const PROVISION_STAGE_ORDER = COMPANY_PROVISION_STAGES.map((stage) => stage.id);

const BERT_SYSTEM_FILES_FOLDER = "01 - BERT System Files";
const ADMIN_EMAIL_DEFAULT = "demo.midlands.admin@usebert.co.uk";

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value = "") {
  return trim(value).toLowerCase();
}

function normalizeFolderName(name = "") {
  return safeLower(name).replace(/^\d+\s*[-.]?\s*/g, "").replace(/\s+/g, " ").trim();
}

export function mergeCompletedProvisioningStages(manifestStages = [], inferredStages = []) {
  const merged = new Set(
    [...(Array.isArray(manifestStages) ? manifestStages : []), ...(Array.isArray(inferredStages) ? inferredStages : [])]
      .map((stage) => trim(stage))
      .filter(Boolean),
  );
  return PROVISION_STAGE_ORDER.filter((stageId) => merged.has(stageId));
}

function stageDiagnostics(stage, operation, details = {}) {
  return {
    stage,
    operation,
    ...details,
  };
}

async function driveFolderExists(drive, folderId) {
  const id = trim(folderId);
  if (!id) {
    return { ok: false, reason: "missing_folder_id" };
  }
  try {
    const response = await drive.files.get({
      fileId: id,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed",
    });
    const file = response.data || {};
    if (file.trashed) {
      return { ok: false, reason: "trashed", name: trim(file.name), folderId: id };
    }
    if (file.mimeType && file.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, reason: "not_a_folder", name: trim(file.name), folderId: id };
    }
    return { ok: true, name: trim(file.name), folderId: id };
  } catch (error) {
    const status = Number(error?.code || error?.response?.status || 0);
    const message = trim(error?.message || error?.response?.data?.error?.message);
    return {
      ok: false,
      reason: status === 404 ? "not_found" : "inaccessible",
      folderId: id,
      googleErrorCode: status || undefined,
      googleErrorReason: trim(error?.response?.data?.error?.errors?.[0]?.reason) || undefined,
      message,
    };
  }
}

async function listChildFolders(drive, parentId) {
  const response = await drive.files.list({
    q: `'${trim(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files || [];
}

function findChildFolderByName(children = [], targetName) {
  const normalizedTarget = normalizeFolderName(targetName);
  return (
    children.find((entry) => normalizeFolderName(entry.name) === normalizedTarget) ||
    children.find((entry) => safeLower(entry.name) === safeLower(targetName)) ||
    null
  );
}

async function readUsersTabEmails(auth, deps, masterSheetId) {
  if (!deps?.getTabValues || !masterSheetId) {
    return [];
  }
  const values = await deps.getTabValues(auth, masterSheetId, "Users").catch(() => []);
  if (!Array.isArray(values) || values.length < 2) {
    return [];
  }
  const headers = (values[0] || []).map((cell) => trim(cell));
  const emailIndex = headers.findIndex((header) => safeLower(header) === "email");
  if (emailIndex < 0) {
    return [];
  }
  return values
    .slice(1)
    .map((row) => safeLower(row[emailIndex]))
    .filter((email) => email.includes("@"));
}

/**
 * Inspect an existing workspace and infer which provisioning stages are already complete.
 */
export async function inferCompletedProvisioningStages(auth, deps, context = {}, options = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const companyName = trim(context.companyName);
  const adminEmail = safeLower(options.adminEmail || ADMIN_EMAIL_DEFAULT);
  const google = deps?.google;
  const drive = google?.drive ? google.drive({ version: "v3", auth }) : null;
  const completedStages = [];
  const diagnostics = [];

  if (!companyFolderId || !masterSheetId || !drive) {
    return { completedStages, diagnostics };
  }

  const companyFolder = await driveFolderExists(drive, companyFolderId);
  diagnostics.push(
    stageDiagnostics("creating_company_folder", "verify_company_folder", {
      parentFolderId: companyFolderId,
      targetFolderName: companyName,
      ...companyFolder,
    }),
  );
  if (companyFolder.ok && (!companyName || safeLower(companyFolder.name) === safeLower(companyName))) {
    completedStages.push("creating_company_folder");
  }

  const workbook = await driveFolderExists(drive, masterSheetId);
  diagnostics.push(
    stageDiagnostics("creating_workbook", "verify_workbook", {
      parentFolderId: companyFolderId,
      targetFolderName: companyName ? `${companyName} - BERT Workbook` : "",
      spreadsheetId: masterSheetId,
      ...workbook,
    }),
  );
  if (workbook.ok) {
    completedStages.push("creating_workbook");
  }

  const usersEmails = await readUsersTabEmails(auth, deps, masterSheetId);
  const tabsReady = usersEmails.length > 0 || (await deps.getTabValues?.(auth, masterSheetId, "Config").catch(() => []))?.length > 0;
  if (tabsReady) {
    completedStages.push("preparing_workbook_tabs");
  }
  diagnostics.push(
    stageDiagnostics("preparing_workbook_tabs", "inspect_workbook_tabs", {
      spreadsheetId: masterSheetId,
      usersRowCount: usersEmails.length,
      tabsReady,
    }),
  );

  if (adminEmail && usersEmails.includes(adminEmail)) {
    completedStages.push("creating_first_administrator");
  }
  diagnostics.push(
    stageDiagnostics("creating_first_administrator", "inspect_users_tab", {
      spreadsheetId: masterSheetId,
      adminEmail,
      adminPresent: adminEmail ? usersEmails.includes(adminEmail) : false,
    }),
  );

  let childFolders = [];
  if (companyFolder.ok) {
    childFolders = await listChildFolders(drive, companyFolderId);
  }
  const bertSystemFiles = findChildFolderByName(childFolders, BERT_SYSTEM_FILES_FOLDER);
  if (bertSystemFiles?.id) {
    completedStages.push("creating_bert_folders");
  }
  diagnostics.push(
    stageDiagnostics("creating_bert_folders", "inspect_company_children", {
      parentFolderId: companyFolderId,
      targetFolderName: BERT_SYSTEM_FILES_FOLDER,
      bertSystemFilesFolderId: bertSystemFiles?.id || "",
      childFolderNames: childFolders.map((entry) => entry.name),
    }),
  );

  const controlledDocuments = findChildFolderByName(childFolders, CONTROLLED_DOCUMENTS_DRIVE_ROOT);
  let documentFolderRows = 0;
  if (deps?.readTabRecords) {
    const registry = await deps
      .readTabRecords(auth, deps, masterSheetId, "DocumentFolders", { expectedHeaders: [] })
      .catch(() => ({ records: [] }));
    documentFolderRows = (registry.records || []).filter((row) => trim(row.GoogleFolderID || row.googleFolderId)).length;
  }
  if (controlledDocuments?.id && documentFolderRows > 0) {
    completedStages.push("creating_iso_document_structure");
  }
  diagnostics.push(
    stageDiagnostics("creating_iso_document_structure", "inspect_document_folders", {
      parentFolderId: companyFolderId,
      targetFolderName: CONTROLLED_DOCUMENTS_DRIVE_ROOT,
      controlledDocumentsFolderId: controlledDocuments?.id || "",
      documentFolderRegistryRows: documentFolderRows,
    }),
  );

  return {
    completedStages: mergeCompletedProvisioningStages([], completedStages),
    diagnostics,
  };
}
