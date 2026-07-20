/**
 * Folder-first NCR writes — appends rows to the company workbook NCRs tab.
 */
import {
  NCR_TAB,
  NCR_TAB_COLUMNS,
  buildNcrWorkbookRow,
  filterEvidenceRefsForQuestion,
  isNcrFindingAnswer,
  nextNcrReferenceFromRows,
  ncrEvidenceRefsToClientEvidence,
  sanitizeNcrEvidenceRefs,
  serializeNcrEvidenceRefs,
} from "../shared/ncr.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

function pickField(record = {}, keys = []) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) return direct;
  }
  return "";
}

function companyRowMatches(row, companyFolderId) {
  const rowCompany = pickField(row, ["Company Folder ID", "Company ID"]);
  return !rowCompany || rowCompany === companyFolderId;
}

function findingKey(auditId, questionId, resultId, localSubmissionId = "") {
  const localId = trim(localSubmissionId);
  if (localId) {
    return `local::${localId}::${trim(questionId)}`;
  }
  return `${auditId}::${questionId}::${resultId}`;
}

function existingNcrKeys(rows, companyFolderId) {
  const keys = new Set();
  for (const row of rows) {
    if (!companyRowMatches(row, companyFolderId)) continue;
    const questionId = pickField(row, ["Source Question ID"]);
    const localSubmissionId = pickField(row, ["Local Submission ID"]);
    if (localSubmissionId && questionId) {
      keys.add(findingKey("", questionId, "", localSubmissionId));
    }
    keys.add(
      findingKey(
        pickField(row, ["Source Audit ID"]),
        questionId,
        pickField(row, ["Result ID"]),
      ),
    );
  }
  return keys;
}

function summarizeCreatedNcr(row, evidenceRefs = []) {
  const questionId = trim(row["Source Question ID"]);
  const scopedEvidence = filterEvidenceRefsForQuestion(evidenceRefs, questionId, { fallbackToAll: true });
  return {
    ncrId: trim(row["NCR ID"] || row.Reference),
    reference: trim(row.Reference || row["NCR ID"]),
    auditId: trim(row["Source Audit ID"]),
    questionId,
    status: trim(row.Status) || "Open",
    resultId: trim(row["Result ID"]),
    evidence: ncrEvidenceRefsToClientEvidence(scopedEvidence),
    evidenceRefs: scopedEvidence,
    evidenceCount: scopedEvidence.length,
  };
}

/** True when server-resolved context has the fields required for NCR writes. */
export function isValidNcrResolvedContext(resolvedContext, input = {}) {
  if (!resolvedContext || resolvedContext.ok !== true) {
    return false;
  }
  const companyFolderId = trim(resolvedContext.companyFolderId || resolvedContext.companyId);
  const masterSheetId = trim(resolvedContext.masterSheetId);
  if (!companyFolderId || !masterSheetId) {
    return false;
  }
  const inputFolderId = trim(input.companyFolderId || input.companyId);
  if (inputFolderId && inputFolderId !== companyFolderId) {
    return false;
  }
  const inputMasterSheetId = trim(input.masterSheetId);
  if (inputMasterSheetId && inputMasterSheetId !== masterSheetId) {
    return false;
  }
  return true;
}

async function resolveNcrWriteContext(auth, deps, input = {}) {
  if (isValidNcrResolvedContext(input.resolvedContext, input)) {
    const resolved = input.resolvedContext;
    return {
      ok: true,
      companyId: trim(resolved.companyFolderId || resolved.companyId),
      companyFolderId: trim(resolved.companyFolderId || resolved.companyId),
      companyName: trim(resolved.companyName),
      masterSheetId: trim(resolved.masterSheetId),
      alternateIds: resolved.alternateIds,
      registryRecord: resolved.registryRecord ?? null,
    };
  }
  const resolveFn =
    typeof deps?.resolveCompanyScheduleContext === "function"
      ? deps.resolveCompanyScheduleContext
      : resolveCompanyScheduleContext;
  return resolveFn(auth, deps, input);
}

/**
 * Append NCR rows for fail/nc findings after check completion.
 */
export async function appendNcrsFromCheckCompletion(auth, deps, input = {}) {
  const context = await resolveNcrWriteContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const companyFolderId = context.companyFolderId;
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const ncrFindings = findings.filter((finding) => isNcrFindingAnswer(finding.answer));
  if (ncrFindings.length === 0) {
    return { ok: true, written: 0, ncrs: [], companyFolderId, masterSheetId: context.masterSheetId };
  }

  const allEvidenceRefs = sanitizeNcrEvidenceRefs(input.evidenceRefs ?? input.evidence ?? []);
  const readTabRecords = resolveReadTabRecords(deps);
  let existingRows = [];
  try {
    const read = await readTabRecords(auth, deps, context.masterSheetId, NCR_TAB, {
      expectedHeaders: NCR_TAB_COLUMNS,
    });
    existingRows = read?.records || [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/header|column/i.test(message)) {
      return {
        ok: false,
        code: "NCR_TAB_MISSING_HEADERS",
        error: "NCR tab is missing required columns in the company workbook.",
        message: "NCR tab is missing required columns in the company workbook.",
        httpStatus: 500,
      };
    }
    return {
      ok: false,
      code: "COMPANY_WORKBOOK_NOT_FOUND",
      error: "Could not read NCR records from the company workbook.",
      message: "Could not read NCR records from the company workbook.",
      httpStatus: 502,
    };
  }

  const companyRows = existingRows.filter((row) => companyRowMatches(row, companyFolderId));
  const usedKeys = existingNcrKeys(companyRows, companyFolderId);
  const resultId = trim(input.resultId);
  const auditId = trim(input.auditId);
  const auditName = trim(input.auditName);
  const site = trim(input.site || input.areaId);
  const auditorName = trim(input.completedByName || input.auditorName);
  const auditorUserId = trim(input.completedByEmail || input.auditorUserId);
  const raisedAt = trim(input.completedAt) || new Date().toISOString();
  const localSubmissionId = trim(input.localSubmissionId);

  const rowsToAppend = [];
  const createdNcrs = [];
  let skippedDuplicates = 0;
  let nextReference = nextNcrReferenceFromRows(companyRows);

  for (const finding of ncrFindings) {
    const questionId = trim(finding.questionId);
    if (!questionId || !auditId) {
      continue;
    }
    const key = findingKey(auditId, questionId, resultId, localSubmissionId);
    if (usedKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    usedKeys.add(key);
    const reference = nextReference;
    nextReference = nextNcrReferenceFromRows([...companyRows, ...rowsToAppend, { Reference: reference }]);
    const evidenceRefs = filterEvidenceRefsForQuestion(allEvidenceRefs, questionId, { fallbackToAll: true });
    const row = buildNcrWorkbookRow({
      ncrId: reference,
      reference,
      companyFolderId,
      auditId,
      auditName,
      questionId,
      questionText: trim(finding.questionText),
      answer: trim(finding.answer),
      note: trim(finding.note),
      site,
      auditorName,
      auditorUserId,
      assignedLineManager: trim(input.assignedLineManager),
      assignedLineManagerEmail: trim(input.assignedLineManagerEmail),
      raisedAt,
      createdBy: auditorUserId,
      resultId,
      localSubmissionId,
      status: "Open",
      evidenceRefs,
      fallbackEvidenceToAll: true,
    });
    rowsToAppend.push(row);
    createdNcrs.push(summarizeCreatedNcr(row, evidenceRefs));
  }

  if (rowsToAppend.length === 0 && skippedDuplicates > 0) {
    return {
      ok: true,
      written: 0,
      skipped: skippedDuplicates,
      code: "NCR_DUPLICATE_SKIPPED",
      message: "Non-conformance already recorded for this check answer.",
      ncrs: [],
      companyFolderId,
      masterSheetId: context.masterSheetId,
    };
  }

  if (rowsToAppend.length === 0) {
    return { ok: true, written: 0, ncrs: [], companyFolderId, masterSheetId: context.masterSheetId };
  }

  const appendTabRows = resolveAppendTabRows(deps);
  try {
    await appendTabRows(auth, deps, context.masterSheetId, NCR_TAB, NCR_TAB_COLUMNS, rowsToAppend);
    return {
      ok: true,
      written: rowsToAppend.length,
      ncrs: createdNcrs,
      companyFolderId,
      masterSheetId: context.masterSheetId,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "NCR_WRITE_FAILED",
      error: "Could not save non-conformance records to the company workbook.",
      message: "Could not save non-conformance records to the company workbook.",
      technicalError,
      httpStatus: 502,
    };
  }
}

/**
 * After Drive upload, backfill Evidence Refs onto NCR rows created for this result.
 * Best-effort — does not fail check completion.
 */
export async function linkEvidenceRefsToNcrs(auth, deps, input = {}) {
  const masterSheetId = trim(input.masterSheetId);
  const resultId = trim(input.resultId);
  const evidenceRefs = sanitizeNcrEvidenceRefs(input.evidenceRefs ?? []);
  const ncrs = Array.isArray(input.ncrs) ? input.ncrs : [];

  if (!masterSheetId || !resultId || evidenceRefs.length === 0 || ncrs.length === 0) {
    return {
      ok: true,
      updated: 0,
      ncrs: ncrs.map((entry) => ({
        ...entry,
        evidence: Array.isArray(entry.evidence) ? entry.evidence : [],
        evidenceRefs: Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : [],
      })),
    };
  }

  try {
    const ensureTabColumns = resolveEnsureTabColumns(deps);
    await ensureTabColumns(auth, deps, masterSheetId, NCR_TAB, NCR_TAB_COLUMNS);
  } catch {
    return {
      ok: false,
      code: "NCR_EVIDENCE_LINK_FAILED",
      message: "Could not prepare NCR evidence columns in the company workbook.",
      updated: 0,
      ncrs,
    };
  }

  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const updatedNcrs = [];
  let updated = 0;
  let linkFailed = false;

  for (const entry of ncrs) {
    const reference = trim(entry.reference || entry.ncrId);
    const questionId = trim(entry.questionId);
    if (!reference) {
      updatedNcrs.push(entry);
      continue;
    }
    const scopedEvidence = filterEvidenceRefsForQuestion(evidenceRefs, questionId, { fallbackToAll: true });
    const nextEntry = {
      ...entry,
      evidenceRefs: scopedEvidence,
      evidence: ncrEvidenceRefsToClientEvidence(scopedEvidence),
      evidenceCount: scopedEvidence.length,
    };
    if (scopedEvidence.length === 0) {
      updatedNcrs.push(nextEntry);
      continue;
    }
    try {
      await patchTabRowByHeader(
        auth,
        deps,
        masterSheetId,
        NCR_TAB,
        "NCR ID",
        reference,
        {
          "Evidence Refs": serializeNcrEvidenceRefs(scopedEvidence),
          "Evidence Count": String(scopedEvidence.length),
          "Updated At": new Date().toISOString(),
        },
        { matchHeaderAliases: ["Reference", "NCR ID"] },
      );
      updated += 1;
      updatedNcrs.push(nextEntry);
    } catch {
      linkFailed = true;
      updatedNcrs.push(nextEntry);
    }
  }

  if (linkFailed && updated === 0) {
    return {
      ok: false,
      code: "NCR_EVIDENCE_LINK_FAILED",
      message: "Could not link uploaded evidence to non-conformance records.",
      updated,
      ncrs: updatedNcrs,
    };
  }

  return {
    ok: true,
    updated,
    warning: linkFailed ? "Some NCR evidence links could not be saved to the workbook." : "",
    ncrs: updatedNcrs,
  };
}

export async function saveCompanyNcrs(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const ncrs = Array.isArray(input.ncrs) ? input.ncrs : [];
  if (ncrs.length === 0) {
    return { ok: true, written: 0, companyFolderId: context.companyFolderId, masterSheetId: context.masterSheetId };
  }

  const rows = ncrs.map((entry) =>
    buildNcrWorkbookRow({
      ...entry,
      companyFolderId: context.companyFolderId,
    }),
  );

  const appendTabRows = resolveAppendTabRows(deps);
  try {
    await appendTabRows(auth, deps, context.masterSheetId, NCR_TAB, NCR_TAB_COLUMNS, rows);
    return {
      ok: true,
      written: rows.length,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
    };
  } catch (error) {
    return {
      ok: false,
      code: "NCR_WRITE_FAILED",
      error: "Could not save non-conformance records.",
      message: "Could not save non-conformance records.",
      httpStatus: 502,
    };
  }
}
