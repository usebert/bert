/**
 * Controlled Documents service — Documents, DocumentRevisions, DocumentSettings tabs.
 */
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  actorCanViewDocument,
  buildDocumentId,
  buildRevisionId,
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_MODULE_REQUIRED_TABS,
  DOCUMENT_MODULE_REVISIONS_TAB,
  DOCUMENT_MODULE_REVISIONS_TAB_COLUMNS,
  DOCUMENT_REVIEWS_TAB,
  DOCUMENT_REVIEWS_TAB_COLUMNS,
  DOCUMENT_SETTINGS_TAB,
  DOCUMENT_SETTINGS_TAB_COLUMNS,
  DOCUMENTS_TAB,
  DOCUMENTS_TAB_COLUMNS,
  documentMatchesSearch,
  documentNumberAlreadyUsed,
  mapDocumentRecord,
  mapDocumentRevisionRecord,
  normalizeDocumentStatus,
  normalizeDocumentVisibility,
  pickRecordField,
} from "../shared/document-schema.mjs";
import { listCompanyProfiles } from "./company-users-foundation.mjs";
import { deleteDriveFileQuietly, uploadControlledDocumentFile } from "./document-upload.mjs";
import { listDocumentFolders, resolveFolderByRecordId } from "./document-folder-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const DOCUMENTS_ROUTE_TIMEOUT_MS = 90_000;
const LIST_CACHE_TTL_MS = 30_000;

const listCache = new Map();
const listInFlight = new Map();

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
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

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

export function canViewDocuments(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

export function canManageDocuments(actor) {
  if (!canViewDocuments(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canManageDocumentSettings(actor) {
  const role = trim(actor?.role);
  return role === "Master" || role === "Admin";
}

export function actorCanAccessCompanyDocuments(actor, companyFolderId, alternateIds = []) {
  if (!canViewDocuments(actor)) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role }) || actor.kind === "godmode") {
    return Boolean(trim(companyFolderId));
  }
  const sessionCompanyId = trim(actor?.companyId || actor?.companyFolderId);
  if (!sessionCompanyId) {
    return false;
  }
  const targets = new Set([companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean));
  return targets.has(sessionCompanyId);
}

export function documentsApiFailure(code, error, httpStatus = 400, details = "") {
  return {
    ok: false,
    code,
    error: trim(error) || "Request failed.",
    message: trim(error) || "Request failed.",
    details: trim(details) || undefined,
    httpStatus,
  };
}

async function ensureDocumentTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENTS_TAB, DOCUMENTS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_MODULE_REVISIONS_TAB, DOCUMENT_MODULE_REVISIONS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_REVIEWS_TAB, DOCUMENT_REVIEWS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_SETTINGS_TAB, DOCUMENT_SETTINGS_TAB_COLUMNS);
}

function cacheKey(context) {
  return `${trim(context.companyFolderId)}:${trim(context.masterSheetId)}`;
}

function invalidateListCache(context) {
  listCache.delete(cacheKey(context));
}

async function loadDocumentsBundle(auth, deps, context, options = {}) {
  const startedAt = Date.now();
  const key = cacheKey(context);
  const bypassCache = options.bypassCache === true;
  if (!bypassCache) {
    const cached = listCache.get(key);
    if (cached && Date.now() - cached.at < LIST_CACHE_TTL_MS) {
      return cached.data;
    }
    if (listInFlight.has(key)) {
      return listInFlight.get(key);
    }
  }

  const promise = (async () => {
    await ensureDocumentTabs(auth, deps, context.masterSheetId);
    const readTabRecords = resolveReadTabRecords(deps);
    const [documentsResult, revisionsResult, settingsResult, foldersResult, usersResult] = await Promise.all([
      readTabRecords(auth, deps, context.masterSheetId, DOCUMENTS_TAB, { expectedHeaders: DOCUMENTS_TAB_COLUMNS }),
      readTabRecords(auth, deps, context.masterSheetId, DOCUMENT_MODULE_REVISIONS_TAB, {
        expectedHeaders: DOCUMENT_MODULE_REVISIONS_TAB_COLUMNS,
      }),
      readTabRecords(auth, deps, context.masterSheetId, DOCUMENT_SETTINGS_TAB, {
        expectedHeaders: DOCUMENT_SETTINGS_TAB_COLUMNS,
      }),
      listDocumentFolders(auth, deps, context),
      listCompanyProfiles(auth, deps, {
        companyFolderId: context.companyFolderId,
        companyId: context.companyId,
        masterSheetId: context.masterSheetId,
        companyName: context.companyName,
        trustSessionContext: true,
        sessionActor: context.sessionActor,
      }),
    ]);

    const documents = (documentsResult?.records || []).map(mapDocumentRecord).filter(Boolean);
    const revisions = (revisionsResult?.records || []).map(mapDocumentRevisionRecord).filter(Boolean);
    const settings = parseSettingsRows(settingsResult?.records || []);
    const folders = foldersResult.ok ? foldersResult.folders || [] : [];
    const users = usersResult.ok ? (usersResult.users || []).filter((row) => trim(row.email) && trim(row.name)) : [];

    const bundle = { documents, revisions, settings, folders, users };
    listCache.set(key, { at: Date.now(), data: bundle });
    console.info("document_list_timings", {
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      totalMs: Date.now() - startedAt,
      documentCount: documents.length,
      folderCount: folders.length,
    });
    return bundle;
  })();

  if (!bypassCache) {
    listInFlight.set(key, promise);
  }
  try {
    return await promise;
  } finally {
    listInFlight.delete(key);
  }
}

function parseSettingsRows(records = []) {
  const settings = { ...DEFAULT_DOCUMENT_SETTINGS, allowAuditorDocumentRead: true };
  for (const record of records) {
    const key = pickRecordField(record, "SettingKey").toLowerCase();
    const value = pickRecordField(record, "SettingValue");
    if (key === "documentsenabled") {
      settings.documentsEnabled = value || settings.documentsEnabled;
    } else if (key === "defaultreviewfrequencymonths") {
      settings.defaultReviewFrequencyMonths = value || settings.defaultReviewFrequencyMonths;
    } else if (key === "defaultreminderdays") {
      settings.defaultReminderDays = value || settings.defaultReminderDays;
    } else if (key === "allowauditordocumentread") {
      settings.allowAuditorDocumentRead = value !== "false";
    }
  }
  return {
    documentsEnabled: settings.documentsEnabled !== "false",
    defaultReviewFrequencyMonths: Number(settings.defaultReviewFrequencyMonths || 12),
    defaultReminderDays: Number(settings.defaultReminderDays || 14),
    allowAuditorDocumentRead: settings.allowAuditorDocumentRead !== false,
  };
}

function settingsRowsFromMap(settings, actor) {
  const updatedAt = nowIso();
  const updatedBy = trim(actor?.email);
  return Object.entries({
    documentsEnabled: settings.documentsEnabled === false ? "false" : "true",
    defaultReviewFrequencyMonths: String(settings.defaultReviewFrequencyMonths ?? 12),
    defaultReminderDays: String(settings.defaultReminderDays ?? 14),
    allowAuditorDocumentRead: settings.allowAuditorDocumentRead === false ? "false" : "true",
  }).map(([SettingKey, SettingValue]) => ({
    SettingKey,
    SettingValue,
    UpdatedAt: updatedAt,
    UpdatedByUserID: updatedBy,
  }));
}

function sortDocuments(documents = []) {
  return [...documents].sort((a, b) => {
    const num = trim(a.documentNumber).localeCompare(trim(b.documentNumber), undefined, { numeric: true });
    if (num !== 0) {
      return num;
    }
    return trim(a.title).localeCompare(trim(b.title));
  });
}

function filterVisibleDocuments(documents, actor, settings, options = {}) {
  const includeArchived = options.includeArchived === true;
  return documents.filter((doc) => {
    if (!includeArchived && doc.archived) {
      return false;
    }
    return actorCanViewDocument(doc, actor, settings);
  });
}

function findCompanyUser(users, userId) {
  const target = normalizeEmail(userId);
  return users.find((row) => normalizeEmail(row.email) === target || trim(row.email) === trim(userId)) || null;
}

function buildMasterIndexRow(doc) {
  return {
    documentNumber: doc.documentNumber,
    title: doc.title,
    folder: doc.folderPath,
    revision: doc.currentRevision,
    status: doc.status,
    owner: doc.ownerName,
    approver: doc.approverName,
    isoClause: doc.isoClause,
    department: doc.department,
    issueDate: doc.issueDate,
    lastReview: doc.lastReviewDate,
    nextReview: doc.nextReviewDate,
    reminderDays: doc.reminderDays,
    documentId: doc.documentId,
  };
}

export async function listDocuments(auth, deps, context, actor, options = {}) {
  const bundle = await loadDocumentsBundle(auth, deps, { ...context, sessionActor: actor });
  const folderRecordId = trim(options.folderRecordId);
  let documents = filterVisibleDocuments(bundle.documents, actor, bundle.settings, options);
  if (folderRecordId) {
    const folder = resolveFolderByRecordId(bundle.folders, folderRecordId);
    const googleFolderId = folder?.googleFolderId || "";
    documents = documents.filter((doc) => doc.folderId === googleFolderId || doc.folderPath === folder?.folderPath);
  }
  documents = sortDocuments(documents);
  return {
    ok: true,
    documents,
    folders: bundle.folders,
    users: bundle.users.map((row) => ({
      userId: trim(row.email),
      name: trim(row.name),
      email: trim(row.email),
      role: trim(row.role || row.accessLevel),
    })),
    settings: bundle.settings,
    masterIndex: canManageDocuments(actor)
      ? sortDocuments(filterVisibleDocuments(bundle.documents, actor, bundle.settings, { includeArchived: options.includeArchived }))
          .map(buildMasterIndexRow)
      : [],
  };
}

export async function searchDocuments(auth, deps, context, actor, options = {}) {
  const startedAt = Date.now();
  const query = trim(options.query);
  const payload = await listDocuments(auth, deps, context, actor, options);
  if (!payload.ok) {
    return payload;
  }
  const documents = query
    ? payload.documents.filter((doc) => documentMatchesSearch(doc, query))
    : payload.documents;
  console.info("document_search_timings", {
    companyFolderId: context.companyFolderId,
    queryLength: query.length,
    resultCount: documents.length,
    totalMs: Date.now() - startedAt,
  });
  return { ...payload, documents, query };
}

export async function getDocument(auth, deps, context, actor, documentId) {
  const bundle = await loadDocumentsBundle(auth, deps, { ...context, sessionActor: actor });
  const doc = bundle.documents.find((entry) => entry.documentId === trim(documentId));
  if (!doc) {
    return documentsApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  if (!actorCanViewDocument(doc, actor, bundle.settings) && !canManageDocuments(actor)) {
    return documentsApiFailure("DOCUMENT_FORBIDDEN", "You do not have access to this document.", 403);
  }
  const revisions = bundle.revisions
    .filter((entry) => entry.documentId === doc.documentId)
    .sort((a, b) => trim(b.createdAt).localeCompare(trim(a.createdAt)));
  return { ok: true, document: doc, revisions, settings: bundle.settings };
}

export async function getDocumentFileLink(auth, deps, context, actor, documentId, drive) {
  const detail = await getDocument(auth, deps, context, actor, documentId);
  if (!detail.ok) {
    return detail;
  }
  const fileId = trim(detail.document.googleFileId);
  if (!fileId) {
    return documentsApiFailure("DOCUMENT_FILE_MISSING", "Document file is not available.", 404);
  }
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,webViewLink,webContentLink",
      supportsAllDrives: true,
    });
    const file = response.data || {};
    return {
      ok: true,
      fileId: file.id || fileId,
      fileName: file.name || detail.document.googleFileName,
      mimeType: file.mimeType || detail.document.mimeType,
      openUrl: file.webViewLink || file.webContentLink || "",
    };
  } catch (error) {
    return documentsApiFailure(
      "DOCUMENT_FILE_OPEN_FAILED",
      "Could not open document file.",
      502,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function validateCreateInput(input, bundle) {
  const documentNumber = trim(input.documentNumber);
  const title = trim(input.title);
  const folderRecordId = trim(input.folderRecordId);
  const ownerUserId = trim(input.ownerUserId);
  const currentRevision = trim(input.currentRevision);
  const fileDataUrl = trim(input.fileDataUrl || input.file);
  const fileName = trim(input.fileName);

  if (!documentNumber) {
    return "Document number is required.";
  }
  if (!title) {
    return "Title is required.";
  }
  if (!folderRecordId) {
    return "Folder is required.";
  }
  if (!ownerUserId) {
    return "Owner is required.";
  }
  if (!currentRevision) {
    return "Revision is required.";
  }
  if (!fileDataUrl) {
    return "File is required.";
  }
  if (!fileName) {
    return "File name is required.";
  }
  if (documentNumberAlreadyUsed(bundle.documents, documentNumber)) {
    return "Document number is already in use.";
  }
  const folder = resolveFolderByRecordId(bundle.folders, folderRecordId);
  if (!folder?.googleFolderId) {
    return "Selected folder is not provisioned for this company.";
  }
  const owner = findCompanyUser(bundle.users, ownerUserId);
  if (!owner) {
    return "Owner must be an active company user.";
  }
  if (trim(input.approverUserId)) {
    const approver = findCompanyUser(bundle.users, input.approverUserId);
    if (!approver) {
      return "Approver must be an active company user.";
    }
  }
  const status = normalizeDocumentStatus(input.status) || "Draft";
  const visibility = normalizeDocumentVisibility(input.visibility) || "All Users";
  return {
    documentNumber,
    title,
    description: trim(input.description),
    folder,
    owner,
    approver: trim(input.approverUserId) ? findCompanyUser(bundle.users, input.approverUserId) : null,
    currentRevision,
    status,
    visibility,
    isoClause: trim(input.isoClause),
    department: trim(input.department),
    issueDate: trim(input.issueDate),
    nextReviewDate: trim(input.nextReviewDate),
    reviewFrequencyMonths: trim(input.reviewFrequencyMonths) || String(bundle.settings.defaultReviewFrequencyMonths || 12),
    reminderDays: trim(input.reminderDays) || String(bundle.settings.defaultReminderDays || 14),
    keywords: trim(input.keywords),
    fileDataUrl,
    fileName,
    mimeType: trim(input.mimeType),
  };
}

export async function createDocument(auth, deps, context, actor, input = {}, drive) {
  const startedAt = Date.now();
  if (!canManageDocuments(actor)) {
    return documentsApiFailure("DOCUMENT_FORBIDDEN", "You do not have permission to add documents.", 403);
  }

  const bundle = await loadDocumentsBundle(auth, deps, { ...context, sessionActor: actor }, { bypassCache: true });
  const validated = validateCreateInput(input, bundle);
  if (typeof validated === "string") {
    return documentsApiFailure("DOCUMENT_VALIDATION", validated, 400);
  }

  let uploaded = null;
  try {
    uploaded = await uploadControlledDocumentFile(drive, {
      folderId: validated.folder.googleFolderId,
      fileName: validated.fileName,
      fileDataUrl: validated.fileDataUrl,
      mimeType: validated.mimeType,
    });
  } catch (error) {
    return documentsApiFailure(
      "DOCUMENT_UPLOAD_FAILED",
      error instanceof Error ? error.message : "Upload failed.",
      400,
    );
  }

  const documentId = buildDocumentId();
  const revisionId = buildRevisionId();
  const timestamp = nowIso();
  const actorEmail = normalizeEmail(actor.email);
  const actorName = trim(actor.name || actor.displayName || actor.email);

  const documentRow = {
    DocumentID: documentId,
    DocumentNumber: validated.documentNumber,
    Title: validated.title,
    Description: validated.description,
    GoogleFileID: uploaded.googleFileId,
    GoogleFileName: uploaded.googleFileName,
    MimeType: uploaded.mimeType,
    FolderID: validated.folder.googleFolderId,
    FolderPath: validated.folder.folderPath,
    CurrentRevision: validated.currentRevision,
    Status: validated.status,
    ISOClause: validated.isoClause,
    Department: validated.department,
    OwnerUserID: normalizeEmail(validated.owner.email),
    OwnerName: trim(validated.owner.name),
    ApproverUserID: validated.approver ? normalizeEmail(validated.approver.email) : "",
    ApproverName: validated.approver ? trim(validated.approver.name) : "",
    IssueDate: validated.issueDate,
    LastReviewDate: "",
    NextReviewDate: validated.nextReviewDate,
    ReviewFrequencyMonths: validated.reviewFrequencyMonths,
    ReminderDays: validated.reminderDays,
    CreatedAt: timestamp,
    CreatedByUserID: actorEmail,
    CreatedByName: actorName,
    LastRevisedAt: timestamp,
    LastRevisedByUserID: actorEmail,
    LastRevisedByName: actorName,
    Keywords: validated.keywords,
    Visibility: validated.visibility,
    IsCurrent: "Yes",
    Archived: "No",
    ArchivedAt: "",
    ArchivedByUserID: "",
  };

  const revisionRow = {
    RevisionID: revisionId,
    DocumentID: documentId,
    RevisionNumber: validated.currentRevision,
    GoogleFileID: uploaded.googleFileId,
    GoogleFileName: uploaded.googleFileName,
    IssueDate: validated.issueDate,
    CreatedAt: timestamp,
    CreatedByUserID: actorEmail,
    CreatedByName: actorName,
    ChangeSummary: trim(input.changeSummary) || "Initial issue",
    Status: validated.status,
    IsCurrent: "Yes",
    ArchivedAt: "",
  };

  const appendTabRows = resolveAppendTabRows(deps);
  try {
    await appendTabRows(auth, deps, context.masterSheetId, DOCUMENTS_TAB, DOCUMENTS_TAB_COLUMNS, [documentRow]);
    await appendTabRows(auth, deps, context.masterSheetId, DOCUMENT_MODULE_REVISIONS_TAB, DOCUMENT_MODULE_REVISIONS_TAB_COLUMNS, [
      revisionRow,
    ]);
  } catch (error) {
    await deleteDriveFileQuietly(drive, uploaded.googleFileId);
    return documentsApiFailure(
      "DOCUMENT_REGISTER_FAILED",
      "Document uploaded but registration failed. Please retry without re-uploading if the file already exists.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }

  invalidateListCache(context);
  const mapped = mapDocumentRecord(documentRow);
  console.info("document_upload_timings", {
    companyFolderId: context.companyFolderId,
    documentId,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, document: mapped, revision: mapDocumentRevisionRecord(revisionRow) };
}

export async function getDocumentSettings(auth, deps, context) {
  await ensureDocumentTabs(auth, deps, context.masterSheetId);
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, context.masterSheetId, DOCUMENT_SETTINGS_TAB, {
    expectedHeaders: DOCUMENT_SETTINGS_TAB_COLUMNS,
  });
  const settings = parseSettingsRows(result?.records || []);
  return { ok: true, settings };
}

export async function updateDocumentSettings(auth, deps, context, actor, input = {}) {
  if (!canManageDocumentSettings(actor)) {
    return documentsApiFailure("DOCUMENT_SETTINGS_FORBIDDEN", "You do not have permission to update settings.", 403);
  }
  const current = await getDocumentSettings(auth, deps, context);
  if (!current.ok) {
    return current;
  }
  const next = {
    documentsEnabled: input.documentsEnabled ?? current.settings.documentsEnabled,
    defaultReviewFrequencyMonths:
      input.defaultReviewFrequencyMonths ?? current.settings.defaultReviewFrequencyMonths,
    defaultReminderDays: input.defaultReminderDays ?? current.settings.defaultReminderDays,
    allowAuditorDocumentRead: input.allowAuditorDocumentRead ?? current.settings.allowAuditorDocumentRead,
  };
  const writeTabRecords = deps.writeTabRecords;
  if (typeof writeTabRecords !== "function") {
    const { writeTabRecords: defaultWrite } = await import("./workbook-service.mjs");
    await defaultWrite(auth, deps, context.masterSheetId, DOCUMENT_SETTINGS_TAB, DOCUMENT_SETTINGS_TAB_COLUMNS, settingsRowsFromMap(next, actor));
  } else {
    await writeTabRecords(auth, deps, context.masterSheetId, DOCUMENT_SETTINGS_TAB, DOCUMENT_SETTINGS_TAB_COLUMNS, settingsRowsFromMap(next, actor));
  }
  invalidateListCache(context);
  return { ok: true, settings: next };
}

export { DOCUMENT_MODULE_REQUIRED_TABS };
