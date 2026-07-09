/**
 * Folder-first NCR writes — appends rows to the company workbook NCRs tab.
 */
import {
  NCR_TAB,
  NCR_TAB_COLUMNS,
  buildNcrWorkbookRow,
  isNcrFindingAnswer,
  nextNcrReferenceFromRows,
} from "../shared/ncr.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
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

/**
 * Append NCR rows for fail/nc findings after check completion.
 */
export async function appendNcrsFromCheckCompletion(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const companyFolderId = context.companyFolderId;
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const ncrFindings = findings.filter((finding) => isNcrFindingAnswer(finding.answer));
  if (ncrFindings.length === 0) {
    return { ok: true, written: 0, ncrs: [], companyFolderId, masterSheetId: context.masterSheetId };
  }

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
    });
    rowsToAppend.push(row);
    createdNcrs.push({
      ncrId: reference,
      reference,
      auditId,
      questionId,
      status: "Open",
    });
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
