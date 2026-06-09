/**
 * Save company schedules to the Schedules tab (multi-role assigned users).
 */
import { resolveCompanyById } from "./company-registry-service.mjs";
import {
  SCHEDULES_TAB,
  SCHEDULES_TAB_COLUMNS,
  SCHEDULE_SAVE_FAILED_CODE,
  SCHEDULE_SAVE_FAILED_MESSAGE,
  assignedUsersFromSchedule,
  buildSchedulesTabRows,
} from "../shared/schedule-save.mjs";

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function mapRowObjectToHeaders(headers, rowObject) {
  return headers.map((header) => String(rowObject?.[header] ?? "").trim());
}

export async function saveCompanySchedules(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  let masterSheetId = String(input.masterSheetId || "").trim();
  const companyFolderId = String(input.companyFolderId || companyId).trim();
  const schedules = Array.isArray(input.schedules) ? input.schedules : [];
  const createdBy = String(input.createdBy || "").trim();

  let registryRecord = null;
  if (companyId) {
    registryRecord = await resolveCompanyById(auth, deps, companyId).catch(() => null);
  }

  if (!registryRecord && !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
  }

  const resolvedCompanyId = String(
    companyFolderId ||
      registryRecord?.companyId ||
      registryRecord?.rootFolderId ||
      registryRecord?.companyFolderId ||
      companyId,
  ).trim();

  if (!masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company master sheet is not configured.",
      message: "Company master sheet is not configured.",
      httpStatus: 404,
    };
  }

  const {
    google,
    withSheetsQuotaRetry,
    getTabValues,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    writeLegacyCompanySchedules,
  } = deps;

  try {
    const sheets = google.sheets({ version: "v4", auth });
    let workbook = await getWorkbook(auth, masterSheetId);
    const { workbook: workbookAfterTab } = await ensureTabExists(auth, masterSheetId, SCHEDULES_TAB, workbook);
    workbook = workbookAfterTab;
    await ensureColumns(auth, masterSheetId, SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS);

    const headers = SCHEDULES_TAB_COLUMNS;
    const existingRows = await getTabValues(auth, masterSheetId, SCHEDULES_TAB);
    const existingDataRows = existingRows.length > 0 ? existingRows.slice(1) : [];
    const companyFolderIndex = headers.indexOf("Company Folder ID");

    const keptRows = existingDataRows.filter(
      (row) => String(row[companyFolderIndex] || "").trim() !== resolvedCompanyId,
    );

    const nextRows = schedules.flatMap((schedule) => {
      const assignedUsers = assignedUsersFromSchedule({
        ...schedule,
        createdBy: schedule.createdBy || createdBy,
      });
      return buildSchedulesTabRows(
        {
          ...schedule,
          companyFolderId: schedule.companyFolderId || resolvedCompanyId,
          createdBy: schedule.createdBy || createdBy,
        },
        assignedUsers,
      );
    });

    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId: masterSheetId,
        range: `${SCHEDULES_TAB}!A:ZZ`,
      }),
    );
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: masterSheetId,
        range: `${SCHEDULES_TAB}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [headers, ...keptRows, ...nextRows.map((row) => mapRowObjectToHeaders(headers, row))],
        },
      }),
    );

    if (typeof writeLegacyCompanySchedules === "function") {
      await writeLegacyCompanySchedules(auth, masterSheetId, resolvedCompanyId, schedules);
    }

    return {
      ok: true,
      companyId: resolvedCompanyId,
      masterSheetId,
      written: nextRows.length,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: SCHEDULE_SAVE_FAILED_CODE,
      error: SCHEDULE_SAVE_FAILED_MESSAGE,
      message: SCHEDULE_SAVE_FAILED_MESSAGE,
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}
