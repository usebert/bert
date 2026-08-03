/**
 * Document Control service — ControlledDocuments, DocumentRevisions, DocumentControlIndex.
 * Dedicated module: never reads or writes Schedules, Audits, LOLER, Calendar, or Messages.
 */
import {
  CONTROLLED_DOCUMENTS_TAB,
  CONTROLLED_DOCUMENTS_TAB_COLUMNS,
  DOCUMENT_CONTROL_INDEX_TAB,
  DOCUMENT_CONTROL_INDEX_TAB_COLUMNS,
  DOCUMENT_REVISIONS_TAB,
  DOCUMENT_REVISIONS_TAB_COLUMNS,
  DOCUMENT_REVIEW_DUE_SOON_DAYS,
  appendChangeLog,
  buildDocumentId,
  buildIndexRowFromDocument,
  buildRevisionId,
  documentNumberAlreadyUsed,
  documentReviewDerivedStatus,
  formatChangeLogEntry,
  formatClauseReferences,
  formatDocumentNumber,
  formatRevisionLabel,
  groupDocumentsByClause,
  highestSequenceForPrefix,
  mapControlledDocumentRecord,
  mapDocumentRevisionRecord,
  nextDocumentNumberForPrefix,
  normalizeDocumentType,
  parseDocumentNumber,
  prefixForDocumentType,
  summarizeDocumentControl,
  validateControlledDocumentInput,
} from "../shared/document-control.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import {
  isActiveVerificationDocument,
  isVerificationDocument,
  isVerificationDocumentId,
  isVerificationDocumentNumber,
  PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
} from "../shared/production-verification-document.mjs";
import {
  deleteDocumentControlDriveFile,
  DocumentControlUploadError,
  ensureDocumentControlFolderStructure,
  googleDriveErrorDetails,
  logDocumentUploadTiming,
  uploadDocumentControlFile,
  verifyDocumentControlFolder,
} from "./document-control-file-service.mjs";

export {
  CONTROLLED_DOCUMENTS_TAB,
  CONTROLLED_DOCUMENTS_TAB_COLUMNS,
  DOCUMENT_REVISIONS_TAB,
  DOCUMENT_REVISIONS_TAB_COLUMNS,
  DOCUMENT_CONTROL_INDEX_TAB,
  DOCUMENT_CONTROL_INDEX_TAB_COLUMNS,
};

export const DOCUMENT_CONTROL_ROUTE_TIMEOUT_MS = 90_000;

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

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

function resolveReplaceTabRows(deps) {
  return typeof deps?.replaceTabRows === "function" ? deps.replaceTabRows : null;
}

export function canViewDocumentControl(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

/** Create / revise / archive — Master, Admin, Manager. */
export function canManageDocumentControl(actor) {
  if (!canViewDocumentControl(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Approve / publish — Master, Admin (Manager when conventions allow: Manager may approve in Phase 1). */
export function canApproveDocumentControl(actor) {
  if (!canViewDocumentControl(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** View superseded revisions (with warning) — Master, Admin, Manager. */
export function canViewSupersededRevisions(actor) {
  return canManageDocumentControl(actor);
}

export function actorCanAccessCompanyDocumentControl(actor, companyFolderId, alternateIds = []) {
  if (!canViewDocumentControl(actor)) {
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

export function documentControlApiFailure(code, error, httpStatus = 400, details = "") {
  const safeError = trim(error) || "Request failed.";
  return {
    ok: false,
    code,
    error: safeError,
    message: safeError,
    details: trim(details) || undefined,
    httpStatus,
  };
}

async function ensureDocumentControlTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, CONTROLLED_DOCUMENTS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, DOCUMENT_REVISIONS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, DOCUMENT_CONTROL_INDEX_TAB, DOCUMENT_CONTROL_INDEX_TAB_COLUMNS);
}

async function readDocumentRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, {
    expectedHeaders: CONTROLLED_DOCUMENTS_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readRevisionRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, {
    expectedHeaders: DOCUMENT_REVISIONS_TAB_COLUMNS,
  });
  return result?.records || [];
}

function mapDocumentsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapControlledDocumentRecord(record);
      if (mapped) items.push(mapped);
    } catch {
      /* skip */
    }
  }
  return items;
}

function mapRevisionsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapDocumentRevisionRecord(record);
      if (mapped) items.push(mapped);
    } catch {
      /* skip */
    }
  }
  return items;
}

function isAuditorActor(actor) {
  return trim(actor?.role) === "Auditor";
}

function decorateDocument(doc, todayKey) {
  return {
    ...doc,
    reviewStatus: documentReviewDerivedStatus(doc.nextReviewDate, todayKey, DOCUMENT_REVIEW_DUE_SOON_DAYS),
  };
}

function filterDocumentsForActor(documents, actor, options = {}) {
  const includeArchived = Boolean(options.includeArchived);
  const statusFilter = trim(options.status).toLowerCase();
  let list = documents;
  if (!includeArchived) {
    list = list.filter((doc) => doc.documentStatus !== "archived");
  }
  if (statusFilter) {
    list = list.filter((doc) => doc.documentStatus === statusFilter);
  }
  if (isAuditorActor(actor) || !canManageDocumentControl(actor)) {
    // Ordinary users / auditors: current approved only
    list = list.filter((doc) => doc.documentStatus === "current");
  }
  return list;
}

async function allocateDocumentNumber(auth, deps, masterSheetId, documentType, requestedNumber, allowMigration) {
  const records = await readDocumentRecords(auth, deps, masterSheetId);
  const existingNumbers = records.map((row) => trim(row.DocumentNumber)).filter(Boolean);
  const prefix = prefixForDocumentType(documentType);

  if (requestedNumber) {
    if (!allowMigration) {
      return { ok: false, error: "Manual document numbers are only allowed for authorised migration." };
    }
    if (documentNumberAlreadyUsed(existingNumbers, requestedNumber)) {
      return { ok: false, error: "Document number is already in use." };
    }
    const parsed = parseDocumentNumber(requestedNumber);
    if (!parsed) {
      return { ok: false, error: "Document number format is invalid." };
    }
    return { ok: true, documentNumber: formatDocumentNumber(parsed.prefix, parsed.sequence) };
  }

  // Retry loop for concurrent allocation safety (do not use array length).
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const refreshed = attempt === 0 ? existingNumbers : (await readDocumentRecords(auth, deps, masterSheetId))
      .map((row) => trim(row.DocumentNumber))
      .filter(Boolean);
    const candidate = nextDocumentNumberForPrefix(refreshed, prefix);
    if (!documentNumberAlreadyUsed(refreshed, candidate)) {
      return { ok: true, documentNumber: candidate, sequence: highestSequenceForPrefix(refreshed, prefix) + 1 };
    }
  }
  return { ok: false, error: "Could not allocate a unique document number. Try again." };
}

async function rebuildIndexInternal(auth, deps, masterSheetId) {
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
  const revisionById = new Map(revisions.map((rev) => [rev.revisionId, rev]));
  const indexRows = documents.map((doc) => {
    const currentRev =
      revisionById.get(doc.currentRevisionId) ||
      revisions.find((rev) => rev.documentId === doc.documentId && rev.revisionStatus === "current") ||
      null;
    return buildIndexRowFromDocument(doc, currentRev);
  }).filter(Boolean);

  const replaceTabRows = resolveReplaceTabRows(deps);
  if (replaceTabRows) {
    await replaceTabRows(auth, deps, masterSheetId, DOCUMENT_CONTROL_INDEX_TAB, DOCUMENT_CONTROL_INDEX_TAB_COLUMNS, indexRows);
    return indexRows;
  }

  // Fallback: clear via patching is unavailable — append-only rebuild marker:
  // Prefer deps.clearTabAndWrite when provided by tests / workbook helpers.
  if (typeof deps?.clearTabAndWrite === "function") {
    await deps.clearTabAndWrite(auth, deps, masterSheetId, DOCUMENT_CONTROL_INDEX_TAB, DOCUMENT_CONTROL_INDEX_TAB_COLUMNS, indexRows);
    return indexRows;
  }

  // Last resort for workbook mock without replace: wipe known rows by rewriting via ensure + append after deleteAll.
  if (typeof deps?.deleteAllTabRows === "function") {
    await deps.deleteAllTabRows(auth, deps, masterSheetId, DOCUMENT_CONTROL_INDEX_TAB);
    if (indexRows.length) {
      await resolveAppendTabRows(deps)(
        auth,
        deps,
        masterSheetId,
        DOCUMENT_CONTROL_INDEX_TAB,
        DOCUMENT_CONTROL_INDEX_TAB_COLUMNS,
        indexRows,
      );
    }
    if (deps && typeof deps === "object") {
      deps._documentControlIndex = indexRows;
    }
    return indexRows;
  }

  // In-memory / simple mock path used by verifier: store on deps._indexOverride
  if (deps && typeof deps === "object") {
    deps._documentControlIndex = indexRows;
  }
  return indexRows;
}

async function syncIndexAfterChange(auth, deps, masterSheetId) {
  try {
    await rebuildIndexInternal(auth, deps, masterSheetId);
  } catch {
    /* index sync best-effort; rebuild endpoint can repair */
  }
}

function buildDocumentRow(documentId, documentNumber, normalized, actor, revisionId, revisionLabel, status, timestamps = {}) {
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const createdAt = timestamps.createdAt || nowIso();
  return {
    DocumentId: documentId,
    DocumentNumber: documentNumber,
    Title: normalized.title,
    DocumentType: normalized.documentType,
    Department: normalized.department,
    OwnerPersonId: normalized.ownerPersonId,
    OwnerName: normalized.ownerName,
    OwnerEmail: normalized.ownerEmail,
    PrimaryStandard: normalized.primaryStandard,
    ClauseReferences: formatClauseReferences(normalized.clauseReferences),
    Keywords: normalized.keywords,
    VerificationSource: normalized.verificationSource || "",
    CurrentRevisionId: status === "current" ? revisionId : timestamps.currentRevisionId || "",
    CurrentRevision: status === "current" ? revisionLabel : timestamps.currentRevision || "",
    DocumentStatus: status,
    IssueDate: normalized.issueDate,
    EffectiveDate: normalized.effectiveDate,
    NextReviewDate: normalized.nextReviewDate,
    ApprovalRequired: normalized.approvalRequired,
    CreatedAt: createdAt,
    CreatedBy: timestamps.createdBy || actorEmail,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
    ArchivedAt: timestamps.archivedAt || "",
    ArchivedBy: timestamps.archivedBy || "",
  };
}

function buildRevisionRow(revisionId, documentId, documentNumber, sequence, normalized, actor, status, extras = {}) {
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const createdAt = extras.createdAt || nowIso();
  const changeLog = appendChangeLog(
    extras.changeLog || "",
    formatChangeLogEntry(extras.logAction || "revision_created", actorEmail, {
      DocumentId: documentId,
      RevisionId: revisionId,
    }),
  );
  return {
    RevisionId: revisionId,
    DocumentId: documentId,
    DocumentNumber: documentNumber,
    Revision: formatRevisionLabel(sequence),
    RevisionSequence: String(sequence),
    FileId: normalized.fileId || extras.fileId || "",
    FileName: normalized.fileName || extras.fileName || "",
    FileUrl: normalized.fileUrl || extras.fileUrl || "",
    MimeType: normalized.mimeType || extras.mimeType || "",
    FileSize: normalized.fileSize || extras.fileSize || "",
    RevisionStatus: status,
    ChangeSummary: normalized.changeSummary || extras.changeSummary || "",
    PreparedBy: extras.preparedBy || actorEmail,
    PreparedAt: extras.preparedAt || createdAt,
    ReviewedBy: extras.reviewedBy || "",
    ReviewedAt: extras.reviewedAt || "",
    ApprovedBy: extras.approvedBy || "",
    ApprovedAt: extras.approvedAt || "",
    IssueDate: normalized.issueDate || extras.issueDate || "",
    EffectiveDate: normalized.effectiveDate || extras.effectiveDate || "",
    SupersededAt: extras.supersededAt || "",
    SupersededByRevisionId: extras.supersededByRevisionId || "",
    CreatedAt: createdAt,
    CreatedBy: extras.createdBy || actorEmail,
    ChangeLog: changeLog,
  };
}

export async function listDocumentControlDocuments(auth, deps, resolved, actor, options = {}) {
  if (!canViewDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You do not have access to Document Control.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  if (!masterSheetId) {
    return documentControlApiFailure("DOCUMENT_CONTROL_NO_WORKBOOK", "Company workbook is not linked.", 400);
  }
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const todayKey = options.todayKey || getUkTodayKey();
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId)).map((doc) =>
    decorateDocument(doc, todayKey),
  );
  const visible = filterDocumentsForActor(documents, actor, options);
  const summary = summarizeDocumentControl(documents, todayKey);
  const clauseGroups = groupDocumentsByClause(visible.filter((doc) => doc.documentStatus === "current" || canManageDocumentControl(actor)));
  return {
    ok: true,
    companyFolderId: trim(resolved?.companyFolderId),
    documents: visible,
    summary,
    clauseGroups,
    canManage: canManageDocumentControl(actor),
    canApprove: canApproveDocumentControl(actor),
    canViewSuperseded: canViewSupersededRevisions(actor),
  };
}

export async function getDocumentControlDocument(auth, deps, resolved, actor, documentId, options = {}) {
  if (!canViewDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You do not have access to Document Control.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(documentId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const todayKey = options.todayKey || getUkTodayKey();
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === id);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  if (!canManageDocumentControl(actor) && document.documentStatus !== "current") {
    return documentControlApiFailure(
      "DOCUMENT_NOT_CURRENT",
      "Only the current approved revision is available.",
      403,
    );
  }
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).filter(
    (rev) => rev.documentId === id,
  );
  const currentRevision =
    revisions.find((rev) => rev.revisionId === document.currentRevisionId) ||
    revisions.find((rev) => rev.revisionStatus === "current") ||
    null;

  let visibleRevisions = revisions;
  if (!canViewSupersededRevisions(actor)) {
    visibleRevisions = currentRevision ? [currentRevision] : [];
  }

  return {
    ok: true,
    document: decorateDocument(document, todayKey),
    currentRevision,
    revisions: visibleRevisions.sort((a, b) => b.revisionSequence - a.revisionSequence),
    resolvedRevisionId: currentRevision?.revisionId || document.currentRevisionId,
    canManage: canManageDocumentControl(actor),
    canApprove: canApproveDocumentControl(actor),
    canViewSuperseded: canViewSupersededRevisions(actor),
  };
}

export async function createControlledDocument(auth, deps, resolved, actor, input = {}) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot create controlled documents.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  if (!masterSheetId) {
    return documentControlApiFailure("DOCUMENT_CONTROL_NO_WORKBOOK", "Company workbook is not linked.", 400);
  }
  const validation = validateControlledDocumentInput(input);
  if (!validation.ok) {
    return documentControlApiFailure("DOCUMENT_VALIDATION_FAILED", validation.errors[0], 400, validation.errors.join(" "));
  }
  await ensureDocumentControlTabs(auth, deps, masterSheetId);

  const allowMigration = Boolean(input.migrationNumber || input.documentNumber) && canApproveDocumentControl(actor);
  const allocation = await allocateDocumentNumber(
    auth,
    deps,
    masterSheetId,
    validation.normalized.documentType,
    validation.normalized.documentNumber,
    allowMigration,
  );
  if (!allocation.ok) {
    return documentControlApiFailure("DOCUMENT_NUMBER_FAILED", allocation.error, 409);
  }

  // Re-check uniqueness immediately before write
  const existingNumbers = (await readDocumentRecords(auth, deps, masterSheetId))
    .map((row) => trim(row.DocumentNumber))
    .filter(Boolean);
  if (documentNumberAlreadyUsed(existingNumbers, allocation.documentNumber)) {
    return documentControlApiFailure("DOCUMENT_NUMBER_DUPLICATE", "Document number is already in use.", 409);
  }

  const documentId = buildDocumentId(resolved?.companyFolderId);
  const sequence = 1;
  const revisionId = buildRevisionId(documentId, sequence);
  const revisionLabel = formatRevisionLabel(sequence);
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const createdAt = nowIso();

  const revisionStatus = "draft";
  const documentStatus = "draft";

  const documentRow = buildDocumentRow(
    documentId,
    allocation.documentNumber,
    validation.normalized,
    actor,
    revisionId,
    revisionLabel,
    documentStatus,
    {
      createdAt,
      createdBy: actorEmail,
      // Drafts still show working revision "1" in the register (not blank).
      currentRevisionId: revisionId,
      currentRevision: revisionLabel,
    },
  );
  const revisionRow = buildRevisionRow(
    revisionId,
    documentId,
    allocation.documentNumber,
    sequence,
    validation.normalized,
    actor,
    revisionStatus,
    { createdAt, logAction: "document_created" },
  );

  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, CONTROLLED_DOCUMENTS_TAB_COLUMNS, [documentRow]);
  await appendTabRows(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, DOCUMENT_REVISIONS_TAB_COLUMNS, [revisionRow]);
  await syncIndexAfterChange(auth, deps, masterSheetId);

  const document = mapControlledDocumentRecord(documentRow);
  const revision = mapDocumentRevisionRecord(revisionRow);
  return {
    ok: true,
    document: decorateDocument(document, getUkTodayKey()),
    revision,
  };
}

export async function updateControlledDocument(auth, deps, resolved, actor, documentId, input = {}) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot edit controlled documents.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(documentId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const existing = documents.find((doc) => doc.documentId === id);
  if (!existing) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  if (existing.documentStatus === "archived") {
    return documentControlApiFailure("DOCUMENT_ARCHIVED", "Archived documents cannot be edited until restored.", 400);
  }

  const next = {
    title: trim(input.title) || existing.title,
    documentType: normalizeDocumentType(input.documentType) || existing.documentType,
    department: trim(input.department) || existing.department,
    ownerPersonId: input.ownerPersonId !== undefined ? trim(input.ownerPersonId) : existing.ownerPersonId,
    ownerName: input.ownerName !== undefined ? trim(input.ownerName) : existing.ownerName,
    ownerEmail: input.ownerEmail !== undefined ? trim(input.ownerEmail).toLowerCase() : existing.ownerEmail,
    primaryStandard: input.primaryStandard !== undefined ? trim(input.primaryStandard) : existing.primaryStandard,
    clauseReferences:
      input.clauseReferences !== undefined || input.clauses !== undefined
        ? input.clauseReferences || input.clauses
        : existing.clauseReferences,
    keywords: input.keywords !== undefined ? trim(input.keywords) : existing.keywords,
    issueDate: input.issueDate !== undefined ? trim(input.issueDate) : existing.issueDate,
    effectiveDate: input.effectiveDate !== undefined ? trim(input.effectiveDate) : existing.effectiveDate,
    nextReviewDate: input.nextReviewDate !== undefined ? trim(input.nextReviewDate) : existing.nextReviewDate,
  };

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", id, {
    Title: next.title,
    DocumentType: next.documentType,
    Department: next.department,
    OwnerPersonId: next.ownerPersonId,
    OwnerName: next.ownerName,
    OwnerEmail: next.ownerEmail,
    PrimaryStandard: next.primaryStandard,
    ClauseReferences: formatClauseReferences(next.clauseReferences),
    Keywords: next.keywords,
    IssueDate: next.issueDate,
    EffectiveDate: next.effectiveDate,
    NextReviewDate: next.nextReviewDate,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  });
  await syncIndexAfterChange(auth, deps, masterSheetId);
  return getDocumentControlDocument(auth, deps, resolved, actor, id);
}

export async function createDocumentRevision(auth, deps, resolved, actor, documentId, input = {}) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot create revisions.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(documentId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === id);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  if (document.documentStatus === "archived") {
    return documentControlApiFailure("DOCUMENT_ARCHIVED", "Archived documents cannot receive new revisions.", 400);
  }

  const changeSummary = trim(input.changeSummary);
  if (!changeSummary) {
    return documentControlApiFailure("REVISION_VALIDATION_FAILED", "A change summary is required for a new revision.", 400);
  }
  const hasFile = Boolean(trim(input.fileId) || trim(input.fileUrl) || trim(input.fileName) || input.fileDataUrl);
  if (!hasFile) {
    return documentControlApiFailure("REVISION_VALIDATION_FAILED", "A replacement file is required for a new revision.", 400);
  }

  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).filter(
    (rev) => rev.documentId === id,
  );
  const openDraft = revisions.find((rev) => rev.revisionStatus === "draft" || rev.revisionStatus === "awaiting_approval");
  if (openDraft) {
    return documentControlApiFailure(
      "REVISION_ALREADY_OPEN",
      "A draft or awaiting-approval revision already exists.",
      409,
    );
  }

  const maxSeq = revisions.reduce((max, rev) => Math.max(max, Number(rev.revisionSequence) || 0), 0);
  const sequence = maxSeq + 1;
  const revisionId = buildRevisionId(id, sequence);
  const normalized = {
    fileId: trim(input.fileId),
    fileName: trim(input.fileName),
    fileUrl: trim(input.fileUrl),
    mimeType: trim(input.mimeType),
    fileSize: trim(input.fileSize),
    changeSummary,
    issueDate: trim(input.issueDate),
    effectiveDate: trim(input.effectiveDate),
  };

  // Important: do NOT supersede the current revision until the new one is approved.
  const revisionRow = buildRevisionRow(
    revisionId,
    id,
    document.documentNumber,
    sequence,
    normalized,
    actor,
    "draft",
    { logAction: "revision_created", changeSummary },
  );
  await resolveAppendTabRows(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, DOCUMENT_REVISIONS_TAB_COLUMNS, [
    revisionRow,
  ]);
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", id, {
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor?.email) || "unknown",
  });
  // Current revision stays current until approval.
  await syncIndexAfterChange(auth, deps, masterSheetId);
  return {
    ok: true,
    revision: mapDocumentRevisionRecord(revisionRow),
    document,
    currentRevisionUnchanged: true,
  };
}

export async function submitDocumentRevision(auth, deps, resolved, actor, revisionId) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot submit revisions.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(revisionId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
  const revision = revisions.find((rev) => rev.revisionId === id);
  if (revision?.revisionStatus === "awaiting_approval") {
    return getDocumentControlDocument(auth, deps, resolved, actor, revision.documentId);
  }
  return transitionRevision(auth, deps, resolved, actor, revisionId, "awaiting_approval", "revision_submitted", {
    requireStatuses: ["draft", "rejected"],
    documentStatus: "awaiting_approval",
  });
}

export async function rejectDocumentRevision(auth, deps, resolved, actor, revisionId, input = {}) {
  if (!canApproveDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot reject revisions.", 403);
  }
  return transitionRevision(auth, deps, resolved, actor, revisionId, "rejected", "revision_rejected", {
    requireStatuses: ["awaiting_approval", "draft"],
    documentStatus: "current", // keep published current if present; else draft
    note: trim(input.reason),
  });
}

export async function approveDocumentRevision(auth, deps, resolved, actor, revisionId) {
  if (!canApproveDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot approve revisions.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(revisionId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
  const revision = revisions.find((rev) => rev.revisionId === id);
  if (!revision) {
    return documentControlApiFailure("REVISION_NOT_FOUND", "Revision not found.", 404);
  }
  if (revision.revisionStatus === "current") {
    return getDocumentControlDocument(auth, deps, resolved, actor, revision.documentId);
  }
  if (revision.revisionStatus !== "awaiting_approval" && revision.revisionStatus !== "draft") {
    return documentControlApiFailure("REVISION_NOT_APPROVABLE", "Revision is not awaiting approval.", 400);
  }
  if (!revision.fileId && !revision.fileUrl && !revision.fileName) {
    return documentControlApiFailure("REVISION_MISSING_FILE", "Revision file is required before approval.", 400);
  }

  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === revision.documentId);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  if (document.documentStatus === "archived") {
    return documentControlApiFailure("DOCUMENT_ARCHIVED", "Archived documents cannot be published.", 400);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const approvedAt = nowIso();
  const previousCurrent = revisions.find(
    (rev) => rev.documentId === revision.documentId && rev.revisionStatus === "current" && rev.revisionId !== id,
  );

  if (previousCurrent) {
    await resolvePatchTabRowByHeader(deps)(
      auth,
      deps,
      masterSheetId,
      DOCUMENT_REVISIONS_TAB,
      "RevisionId",
      previousCurrent.revisionId,
      {
        RevisionStatus: "superseded",
        SupersededAt: approvedAt,
        SupersededByRevisionId: id,
        ChangeLog: appendChangeLog(
          previousCurrent.changeLog,
          formatChangeLogEntry("revision_superseded", actorEmail, {
            DocumentId: document.documentId,
            RevisionId: previousCurrent.revisionId,
            SupersededBy: id,
          }),
        ),
      },
    );
  }

  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", id, {
    RevisionStatus: "current",
    ApprovedBy: actorEmail,
    ApprovedAt: approvedAt,
    ReviewedBy: actorEmail,
    ReviewedAt: approvedAt,
    IssueDate: revision.issueDate || document.issueDate || approvedAt.slice(0, 10),
    EffectiveDate: revision.effectiveDate || document.effectiveDate || approvedAt.slice(0, 10),
    ChangeLog: appendChangeLog(
      revision.changeLog,
      formatChangeLogEntry("revision_approved", actorEmail, {
        DocumentId: document.documentId,
        RevisionId: id,
      }),
    ),
  });

  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", document.documentId, {
    DocumentStatus: "current",
    CurrentRevisionId: id,
    CurrentRevision: revision.revision,
    IssueDate: revision.issueDate || document.issueDate || approvedAt.slice(0, 10),
    EffectiveDate: revision.effectiveDate || document.effectiveDate || approvedAt.slice(0, 10),
    UpdatedAt: approvedAt,
    UpdatedBy: actorEmail,
  });

  await syncIndexAfterChange(auth, deps, masterSheetId);
  return getDocumentControlDocument(auth, deps, resolved, actor, document.documentId);
}

async function transitionRevision(auth, deps, resolved, actor, revisionId, nextStatus, logAction, options = {}) {
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(revisionId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
  const revision = revisions.find((rev) => rev.revisionId === id);
  if (!revision) {
    return documentControlApiFailure("REVISION_NOT_FOUND", "Revision not found.", 404);
  }
  const allowed = options.requireStatuses || [];
  if (allowed.length && !allowed.includes(revision.revisionStatus)) {
    return documentControlApiFailure("REVISION_INVALID_STATE", "Revision cannot transition from its current status.", 400);
  }
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === revision.documentId);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", id, {
    RevisionStatus: nextStatus,
    ChangeLog: appendChangeLog(
      revision.changeLog,
      formatChangeLogEntry(logAction, actorEmail, {
        DocumentId: document.documentId,
        RevisionId: id,
        Note: options.note || "",
      }),
    ),
  });

  // Document status: awaiting_approval when submitted; on reject keep current if published else draft
  let documentStatus = document.documentStatus;
  if (options.documentStatus === "awaiting_approval") {
    documentStatus = document.documentStatus === "current" ? "current" : "awaiting_approval";
    // Spec: document can be awaiting_approval while previous current stays for published docs.
    // For first revision, mark document awaiting_approval.
    if (document.documentStatus === "draft" || document.documentStatus === "awaiting_approval") {
      documentStatus = "awaiting_approval";
    }
  } else if (logAction === "revision_rejected") {
    const hasCurrent = revisions.some(
      (rev) => rev.documentId === document.documentId && rev.revisionStatus === "current",
    );
    documentStatus = hasCurrent ? "current" : "draft";
  }

  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", document.documentId, {
    DocumentStatus: documentStatus,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  });
  await syncIndexAfterChange(auth, deps, masterSheetId);
  return getDocumentControlDocument(auth, deps, resolved, actor, document.documentId);
}

export async function getDocumentRevisionFile(auth, deps, resolved, actor, revisionId, options = {}) {
  if (!canViewDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You do not have access to Document Control.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(revisionId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
  const revision = revisions.find((rev) => rev.revisionId === id);
  if (!revision) {
    return documentControlApiFailure("REVISION_NOT_FOUND", "Revision not found.", 404);
  }

  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === revision.documentId);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }

  const isCurrent = revision.revisionStatus === "current" && document.documentStatus === "current";
  const isSuperseded = revision.revisionStatus === "superseded";

  if (!canManageDocumentControl(actor)) {
    // Ordinary users: only current approved revision file
    if (!isCurrent) {
      return documentControlApiFailure(
        "REVISION_ACCESS_DENIED",
        "Only the current approved revision is available.",
        403,
      );
    }
  } else if (isSuperseded && !options.acknowledgedSupersededWarning) {
    return {
      ok: false,
      code: "SUPERSEDED_WARNING_REQUIRED",
      error: "Superseded document",
      message: "This is not the current approved revision and must not be used for operational purposes.",
      httpStatus: 409,
      warning: {
        title: "Superseded document",
        body: "This is not the current approved revision and must not be used for operational purposes.",
        revision: revision.revision,
        revisionId: revision.revisionId,
        currentRevision: document.currentRevision,
        currentRevisionId: document.currentRevisionId,
        supersededAt: revision.supersededAt,
      },
    };
  }

  if (isSuperseded && options.acknowledgedSupersededWarning && canViewSupersededRevisions(actor)) {
    await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", id, {
      ChangeLog: appendChangeLog(
        revision.changeLog,
        formatChangeLogEntry("superseded_revision_accessed", normalizeEmail(actor?.email) || "unknown", {
          DocumentId: document.documentId,
          RevisionId: id,
        }),
      ),
    });
  }

  if (isCurrent) {
    await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", id, {
      ChangeLog: appendChangeLog(
        revision.changeLog,
        formatChangeLogEntry("current_document_opened", normalizeEmail(actor?.email) || "unknown", {
          DocumentId: document.documentId,
          RevisionId: id,
        }),
      ),
    });
  }

  if (revision.revisionStatus === "draft" || revision.revisionStatus === "awaiting_approval" || revision.revisionStatus === "rejected") {
    if (!canManageDocumentControl(actor)) {
      return documentControlApiFailure("REVISION_ACCESS_DENIED", "Draft revisions are not available.", 403);
    }
  }

  return {
    ok: true,
    revision,
    document,
    file: {
      fileId: revision.fileId,
      fileName: revision.fileName,
      fileUrl: revision.fileUrl,
      mimeType: revision.mimeType,
      fileSize: revision.fileSize,
    },
  };
}

export async function archiveControlledDocument(auth, deps, resolved, actor, documentId) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot archive documents.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(documentId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === id);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const archivedAt = nowIso();
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", id, {
    DocumentStatus: "archived",
    ArchivedAt: archivedAt,
    ArchivedBy: actorEmail,
    UpdatedAt: archivedAt,
    UpdatedBy: actorEmail,
  });
  await syncIndexAfterChange(auth, deps, masterSheetId);
  return getDocumentControlDocument(auth, deps, resolved, actor, id, { includeArchived: true });
}

export async function restoreControlledDocument(auth, deps, resolved, actor, documentId) {
  if (!canApproveDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot restore documents.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(documentId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === id);
  if (!document) {
    return documentControlApiFailure("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  }
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).filter(
    (rev) => rev.documentId === id,
  );
  const hasCurrent = revisions.some((rev) => rev.revisionStatus === "current");
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", id, {
    DocumentStatus: hasCurrent ? "current" : "draft",
    ArchivedAt: "",
    ArchivedBy: "",
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  });
  await syncIndexAfterChange(auth, deps, masterSheetId);
  return getDocumentControlDocument(auth, deps, resolved, actor, id);
}

export async function listDocumentControlIndex(auth, deps, resolved, actor) {
  if (!canViewDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You do not have access to Document Control.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  if (deps?._documentControlIndex) {
    let rows = deps._documentControlIndex;
    if (!canManageDocumentControl(actor)) {
      rows = rows.filter((row) => trim(row.DocumentStatus).toLowerCase() === "current");
    }
    return { ok: true, index: rows };
  }
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, DOCUMENT_CONTROL_INDEX_TAB, {
    expectedHeaders: DOCUMENT_CONTROL_INDEX_TAB_COLUMNS,
  });
  let rows = result?.records || [];
  if (!rows.length) {
    rows = await rebuildIndexInternal(auth, deps, masterSheetId);
  }
  if (!canManageDocumentControl(actor)) {
    rows = rows.filter((row) => trim(row.DocumentStatus || row.documentStatus).toLowerCase() === "current");
  }
  return { ok: true, index: rows };
}

export async function rebuildDocumentControlIndex(auth, deps, resolved, actor) {
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot rebuild the document control index.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const index = await rebuildIndexInternal(auth, deps, masterSheetId);
  return { ok: true, index, rebuilt: true };
}

function logDocumentMutationTiming(operation, stage, meta = {}) {
  console.info("[document:mutation-timing]", {
    operation,
    stage,
    documentId: trim(meta.documentId),
    workbookId: trim(meta.workbookId),
    updatedRows: Number(meta.updatedRows) || 0,
    durationMs: Number(meta.durationMs) || 0,
    totalMs: Number(meta.totalMs) || Number(meta.durationMs) || 0,
  });
}

export async function createDraftVerificationDocument(auth, deps, resolved, actor, input = {}) {
  const startedAt = Date.now();
  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot create controlled documents.", 403);
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  if (!masterSheetId) {
    return documentControlApiFailure("DOCUMENT_CONTROL_NO_WORKBOOK", "Company workbook is not linked.", 400);
  }
  const documentId = trim(input.documentId);
  const documentNumber = trim(input.documentNumber).toUpperCase();
  if (!isVerificationDocumentId(documentId)) {
    return documentControlApiFailure(
      "DOCUMENT_VERIFICATION_ID_REQUIRED",
      "Verification documents must use the bert-smoke-doc- ID prefix.",
      403,
    );
  }
  if (!isVerificationDocumentNumber(documentNumber)) {
    return documentControlApiFailure(
      "DOCUMENT_VERIFICATION_NUMBER_REQUIRED",
      "Verification documents must use the BERT-VERIFY-DOC- number prefix.",
      403,
    );
  }

  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const existing = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId)).find(
    (doc) => doc.documentId === documentId,
  );
  if (existing) {
    if (!isVerificationDocument(existing)) {
      return documentControlApiFailure("DOCUMENT_ID_CONFLICT", "Document ID is already used by a non-verification record.", 409);
    }
    return {
      ok: true,
      document: decorateDocument(existing, getUkTodayKey()),
      alreadyExists: true,
      updatedRows: 0,
      revision: mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).find(
        (rev) => rev.documentId === documentId,
      ),
    };
  }

  const existingNumbers = (await readDocumentRecords(auth, deps, masterSheetId))
    .map((row) => trim(row.DocumentNumber))
    .filter(Boolean);
  if (documentNumberAlreadyUsed(existingNumbers, documentNumber)) {
    return documentControlApiFailure("DOCUMENT_NUMBER_DUPLICATE", "Document number is already in use.", 409);
  }

  const validation = validateControlledDocumentInput(
    {
      ...input,
      documentNumber: "",
      title: trim(input.title),
      documentType: input.documentType || "procedure",
      department: input.department || "Verification",
      ownerName: trim(input.ownerName || actor?.name || actor?.email),
      ownerEmail: trim(input.ownerEmail || actor?.email),
      primaryStandard: input.primaryStandard || "COMPANY",
      clauseReferences: input.clauseReferences || ["COMPANY:VERIFICATION"],
      keywords: trim(input.keywords) || `verification ${PRODUCTION_VERIFICATION_DOCUMENT_SOURCE}`,
      nextReviewDate: input.nextReviewDate,
      changeSummary: trim(input.changeSummary) || "Initial verification revision.",
    },
    { allowMissingFile: true },
  );
  if (!validation.ok) {
    return documentControlApiFailure("DOCUMENT_VALIDATION_FAILED", validation.errors[0], 400, validation.errors.join(" "));
  }

  const normalized = {
    ...validation.normalized,
    verificationSource: PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
  };
  const sequence = 1;
  const revisionId = buildRevisionId(documentId, sequence);
  const revisionLabel = formatRevisionLabel(sequence);
  const createdAt = nowIso();
  const documentRow = buildDocumentRow(
    documentId,
    documentNumber,
    normalized,
    actor,
    revisionId,
    revisionLabel,
    "draft",
    { createdAt, createdBy: normalizeEmail(actor?.email) || "unknown", currentRevisionId: revisionId, currentRevision: revisionLabel },
  );
  const revisionRow = buildRevisionRow(
    revisionId,
    documentId,
    documentNumber,
    sequence,
    normalized,
    actor,
    "draft",
    { createdAt, logAction: "document_created", changeSummary: normalized.changeSummary },
  );

  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, CONTROLLED_DOCUMENTS_TAB_COLUMNS, [documentRow]);
  await appendTabRows(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, DOCUMENT_REVISIONS_TAB_COLUMNS, [revisionRow]);
  await syncIndexAfterChange(auth, deps, masterSheetId);
  logDocumentMutationTiming("create", "draft", {
    documentId,
    workbookId: masterSheetId,
    updatedRows: 2,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    document: decorateDocument(mapControlledDocumentRecord(documentRow), getUkTodayKey()),
    revision: mapDocumentRevisionRecord(revisionRow),
    updatedRows: 2,
  };
}

export async function uploadVerificationRevisionFile(auth, deps, resolved, actor, revisionId, input = {}) {
  const startedAt = Date.now();
  const stageStartedAt = Date.now();
  const companyFolderId = trim(resolved?.companyFolderId);
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(revisionId);
  const documentIdHint = trim(input.documentId);
  let currentStage = "company_resolution";
  let targetFolderId = "";
  let uploadedFileId = "";

  const logStage = (stage, extra = {}) => {
    currentStage = stage;
    logDocumentUploadTiming({
      stage,
      documentId: extra.documentId || documentIdHint,
      revisionId: id,
      companyFolderId,
      masterSheetId,
      targetFolderId: extra.targetFolderId || targetFolderId,
      mimeType: trim(input.mimeType) || extra.mimeType || "",
      fileSize: Number(extra.fileSize) || 0,
      durationMs: Date.now() - stageStartedAt,
      totalMs: Date.now() - startedAt,
      ...extra,
    });
  };

  const uploadFailure = (message, code, httpStatus = 500, extra = {}) => {
    const details = [
      trim(extra.details),
      extra.stage ? `stage=${extra.stage}` : "",
      extra.google?.googleErrorReason ? `googleReason=${extra.google.googleErrorReason}` : "",
      extra.google?.googleErrorMessage ? `googleMessage=${extra.google.googleErrorMessage}` : "",
      targetFolderId ? `targetFolderId=${targetFolderId}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return documentControlApiFailure(code, message, httpStatus, details);
  };

  if (!canManageDocumentControl(actor)) {
    return documentControlApiFailure("DOCUMENT_CONTROL_FORBIDDEN", "You cannot upload revision files.", 403);
  }
  if (!masterSheetId) {
    return uploadFailure("Company workbook is not linked.", "DOCUMENT_CONTROL_NO_WORKBOOK", 400, { stage: "company_resolution" });
  }
  if (!companyFolderId) {
    return uploadFailure("Company folder is not linked.", "DOCUMENT_CONTROL_NO_COMPANY_FOLDER", 400, { stage: "company_resolution" });
  }

  logStage("company_resolution");

  try {
    currentStage = "revision_lookup";
    await ensureDocumentControlTabs(auth, deps, masterSheetId);
    const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId));
    const revision = revisions.find((rev) => rev.revisionId === id);
    if (!revision) {
      logStage("revision_lookup", { failureStage: "revision_lookup" });
      return uploadFailure("Revision not found.", "REVISION_NOT_FOUND", 404, { stage: "revision_lookup" });
    }
    const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
    const document = documents.find((doc) => doc.documentId === revision.documentId);
    if (!document || !isVerificationDocument(document)) {
      logStage("revision_lookup", { documentId: revision.documentId, failureStage: "revision_lookup" });
      return uploadFailure(
        "Only verification revisions can use this upload path.",
        "DOCUMENT_NOT_VERIFICATION",
        403,
        { stage: "revision_lookup", documentId: revision.documentId },
      );
    }
    if (revision.fileId || revision.fileUrl) {
      logStage("readback", { documentId: document.documentId, fileSize: Number(revision.fileSize) || 0 });
      return { ok: true, revision, document, alreadyUploaded: true, updatedRows: 0 };
    }

    const drive = deps?.google?.drive ? deps.google.drive({ version: "v3", auth }) : null;
    if (!drive) {
      logStage("drive_client", { documentId: document.documentId, failureStage: "drive_client" });
      return uploadFailure("Google Drive is not available for verification upload.", "DRIVE_UNAVAILABLE", 503, {
        stage: "drive_client",
        documentId: document.documentId,
      });
    }

    currentStage = "drafts_folder_resolution";
    const folders = await ensureDocumentControlFolderStructure(drive, companyFolderId, { stage: currentStage });
    targetFolderId = trim(folders.folders.Drafts);
    logStage("drafts_folder_resolution", { documentId: document.documentId, targetFolderId });

    currentStage = "drafts_folder_check";
    const draftsCheck = await verifyDocumentControlFolder(drive, targetFolderId, { stage: currentStage });
    if (!draftsCheck.ok) {
      logStage("drafts_folder_check", {
        documentId: document.documentId,
        targetFolderId,
        failureStage: "drafts_folder_check",
        googleErrorCode: draftsCheck.google?.googleErrorCode,
        googleErrorReason: draftsCheck.google?.googleErrorReason,
      });
      return uploadFailure(
        draftsCheck.message || "Document Control Drafts folder is not accessible.",
        "UPLOAD_DRAFTS_FOLDER_INACCESSIBLE",
        403,
        { stage: "drafts_folder_check", documentId: document.documentId, google: draftsCheck.google },
      );
    }
    logStage("drafts_folder_check", { documentId: document.documentId, targetFolderId });

    currentStage = "file_validation";
    const fileName = trim(input.fileName) || "bert-verify-doc.pdf";
    const mimeType = trim(input.mimeType) || "application/pdf";
    const uploaded = await uploadDocumentControlFile(drive, {
      folderId: targetFolderId,
      fileName,
      fileDataUrl: input.fileDataUrl,
      mimeType,
    });
    uploadedFileId = trim(uploaded.fileId);
    logStage("drive_create", {
      documentId: document.documentId,
      targetFolderId,
      mimeType: uploaded.mimeType,
      fileSize: Number(uploaded.fileSize) || 0,
    });

    currentStage = "metadata_patch";
    const patchResult = await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", id, {
      FileId: uploaded.fileId,
      FileName: uploaded.fileName,
      FileUrl: uploaded.fileUrl,
      MimeType: uploaded.mimeType,
      FileSize: uploaded.fileSize,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor?.email) || "unknown",
    });
    const updatedRows = Number(patchResult?.updatedRows ?? patchResult?.updated ?? 1);
    if (updatedRows <= 0) {
      logStage("metadata_patch", {
        documentId: document.documentId,
        targetFolderId,
        mimeType: uploaded.mimeType,
        fileSize: Number(uploaded.fileSize) || 0,
        failureStage: "metadata_patch",
      });
      const cleanup = await deleteDocumentControlDriveFile(drive, uploadedFileId);
      return uploadFailure(
        "Revision file metadata patch returned zero-row acknowledgement.",
        "UPLOAD_METADATA_PATCH_FAILED",
        500,
        {
          stage: "metadata_patch",
          documentId: document.documentId,
          details: `Drive file ${uploadedFileId} cleanup deleted=${cleanup.deleted === true}`,
        },
      );
    }
    logStage("metadata_patch", {
      documentId: document.documentId,
      targetFolderId,
      mimeType: uploaded.mimeType,
      fileSize: Number(uploaded.fileSize) || 0,
    });

    currentStage = "readback";
    const refreshed = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).find((rev) => rev.revisionId === id);
    if (!refreshed || trim(refreshed.fileId) !== uploadedFileId) {
      logStage("readback", {
        documentId: document.documentId,
        targetFolderId,
        mimeType: uploaded.mimeType,
        fileSize: Number(uploaded.fileSize) || 0,
        failureStage: "readback",
      });
      const cleanup = await deleteDocumentControlDriveFile(drive, uploadedFileId);
      return uploadFailure(
        "Uploaded revision file was not visible on readback.",
        "UPLOAD_READBACK_FAILED",
        500,
        {
          stage: "readback",
          documentId: document.documentId,
          details: `Drive file ${uploadedFileId} cleanup deleted=${cleanup.deleted === true}`,
        },
      );
    }
    logStage("readback", {
      documentId: document.documentId,
      targetFolderId,
      mimeType: uploaded.mimeType,
      fileSize: Number(uploaded.fileSize) || 0,
    });

    logDocumentMutationTiming("upload", "upload", {
      documentId: document.documentId,
      workbookId: masterSheetId,
      updatedRows: 1,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, revision: refreshed, document, updatedRows: 1 };
  } catch (error) {
    const google = error instanceof DocumentControlUploadError ? error.google : googleDriveErrorDetails(error);
    const stage = error instanceof DocumentControlUploadError ? error.stage : currentStage;
    const code = error instanceof DocumentControlUploadError ? error.code : "DOCUMENT_CONTROL_UPLOAD_FAILED";
    const httpStatus =
      error instanceof DocumentControlUploadError
        ? error.httpStatus
        : google.googleErrorCode && google.googleErrorCode >= 400
          ? google.googleErrorCode
          : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[document-control-upload] failed:", {
      stage,
      revisionId: id,
      companyFolderId,
      masterSheetId,
      targetFolderId,
      uploadedFileId: uploadedFileId || undefined,
      code,
      httpStatus,
      ...google,
    });
    logDocumentUploadTiming({
      stage,
      revisionId: id,
      companyFolderId,
      masterSheetId,
      targetFolderId,
      mimeType: trim(input.mimeType),
      durationMs: Date.now() - stageStartedAt,
      totalMs: Date.now() - startedAt,
      failureStage: stage,
      googleErrorCode: google?.googleErrorCode,
      googleErrorReason: google?.googleErrorReason,
    });
    if (uploadedFileId && deps?.google?.drive) {
      const drive = deps.google.drive({ version: "v3", auth });
      await deleteDocumentControlDriveFile(drive, uploadedFileId);
    }
    return uploadFailure(message, code, httpStatus, { stage, google });
  }
}

export async function cleanupVerificationDocument(auth, deps, resolved, actor, documentId, input = {}) {
  const startedAt = Date.now();
  const id = trim(documentId);
  if (!isVerificationDocumentId(id)) {
    return documentControlApiFailure(
      "CLEANUP_NOT_VERIFICATION_DOCUMENT",
      "Only verification documents with the bert-smoke-doc- prefix can be cleaned up through this path.",
      403,
    );
  }
  const masterSheetId = trim(resolved?.masterSheetId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const document = documents.find((doc) => doc.documentId === id);
  if (!document) {
    return { ok: true, cleaned: true, alreadyCleaned: true, documentId: id, updatedRows: 0 };
  }
  if (!isVerificationDocument(document)) {
    return documentControlApiFailure("CLEANUP_NOT_VERIFICATION_DOCUMENT", "Only verification documents can be cleaned up through this path.", 403);
  }
  if (trim(document.documentStatus).toLowerCase() === PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS) {
    return { ok: true, cleaned: true, alreadyCleaned: true, documentId: id, status: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS, updatedRows: 0 };
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const timestamp = nowIso();
  await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, CONTROLLED_DOCUMENTS_TAB, "DocumentId", id, {
    DocumentStatus: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
    VerificationSource: PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
    ArchivedAt: timestamp,
    ArchivedBy: actorEmail,
    UpdatedAt: timestamp,
    UpdatedBy: actorEmail,
  });
  const revisions = mapRevisionsSafely(await readRevisionRecords(auth, deps, masterSheetId)).filter((rev) => rev.documentId === id);
  for (const revision of revisions) {
    await resolvePatchTabRowByHeader(deps)(auth, deps, masterSheetId, DOCUMENT_REVISIONS_TAB, "RevisionId", revision.revisionId, {
      RevisionStatus: "archived",
      ChangeLog: appendChangeLog(
        revision.changeLog,
        formatChangeLogEntry("verification_cleaned", actorEmail, { DocumentId: id, RevisionId: revision.revisionId }),
      ),
    });
  }
  await syncIndexAfterChange(auth, deps, masterSheetId);
  logDocumentMutationTiming("cleanup", "cleanup", {
    documentId: id,
    workbookId: masterSheetId,
    updatedRows: 1 + revisions.length,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    cleaned: true,
    documentId: id,
    status: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
    updatedRows: 1 + revisions.length,
  };
}

export async function cleanupStaleVerificationDocuments(auth, deps, resolved, actor) {
  const masterSheetId = trim(resolved?.masterSheetId);
  await ensureDocumentControlTabs(auth, deps, masterSheetId);
  const documents = mapDocumentsSafely(await readDocumentRecords(auth, deps, masterSheetId));
  const stale = documents.filter((doc) => isActiveVerificationDocument(doc));
  const results = [];
  for (const document of stale) {
    const cleaned = await cleanupVerificationDocument(auth, deps, resolved, actor, document.documentId);
    results.push({ documentId: document.documentId, ok: cleaned.ok === true, status: cleaned.status });
  }
  return { ok: true, cleanedCount: results.filter((item) => item.ok).length, results };
}
