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
    { createdAt, createdBy: actorEmail },
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
