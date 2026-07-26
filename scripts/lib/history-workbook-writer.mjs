/**
 * Cached, resumable Google Sheets writer for Midlands demo history seeding.
 * Fetches workbook metadata once, batches tab/header preparation, and reuses caches.
 */
import fs from "node:fs";
import path from "node:path";
import { rowsToRecords } from "../../server/workbook-service.mjs";
import { upsertByKey } from "./demo-environment-script-utils.mjs";
import { createSheetsQuotaRetry } from "./sheets-quota-retry.mjs";

const READ_GAP_MS = Math.min(3000, Math.max(0, Number(process.env.SHEETS_READ_GAP_MS || 150) || 150));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value = "") {
  return trim(value).toLowerCase();
}

function sheetEndColumnLetter(columnCount) {
  const count = Math.max(Number(columnCount) || 1, 1);
  if (count <= 26) {
    return String.fromCharCode(64 + count);
  }
  let remaining = count;
  let letters = "";
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

export function buildHistoryApplyProgressPath(sessionsRoot) {
  return path.join(sessionsRoot, "demo-environment-history", "live-apply-progress.json");
}

export function loadHistoryApplyProgress(progressPath, { masterSheetId, companyFolderId, fingerprint }) {
  if (!fs.existsSync(progressPath)) {
    return { completedTabs: [] };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(progressPath, "utf8"));
    if (
      trim(saved.masterSheetId) !== trim(masterSheetId) ||
      trim(saved.companyFolderId) !== trim(companyFolderId) ||
      trim(saved.fingerprint) !== trim(fingerprint)
    ) {
      return { completedTabs: [], stale: true };
    }
    return {
      completedTabs: Array.isArray(saved.completedTabs) ? [...saved.completedTabs] : [],
      updatedAt: saved.updatedAt,
    };
  } catch {
    return { completedTabs: [] };
  }
}

export function saveHistoryApplyProgress(progressPath, state) {
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(
    progressPath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function clearHistoryApplyProgress(progressPath) {
  if (fs.existsSync(progressPath)) {
    fs.unlinkSync(progressPath);
  }
}

export class HistoryWorkbookWriter {
  constructor(auth, deps, spreadsheetId, options = {}) {
    this.auth = auth;
    this.deps = deps;
    this.spreadsheetId = trim(spreadsheetId);
    this.withSheetsQuotaRetry =
      typeof deps.withSheetsQuotaRetry === "function"
        ? deps.withSheetsQuotaRetry
        : createSheetsQuotaRetry({ label: options.retryLabel || "demo-history" });
    this.workbook = null;
    this.tabTitles = new Set();
    this.headersByTab = new Map();
    this.stats = {
      getWorkbookCalls: 0,
      batchGetCalls: 0,
      getTabValuesCalls: 0,
      valuesUpdateCalls: 0,
      batchUpdateCalls: 0,
    };
  }

  sheets() {
    return this.deps.google.sheets({ version: "v4", auth: this.auth });
  }

  async pauseBetweenReads() {
    if (READ_GAP_MS > 0) {
      await sleep(READ_GAP_MS);
    }
  }

  async fetchWorkbook(force = false) {
    if (!force && this.workbook) {
      return this.workbook;
    }
    this.stats.getWorkbookCalls += 1;
    const sheets = this.sheets();
    const response = await this.withSheetsQuotaRetry(
      () =>
        sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: "properties(title),sheets(properties(sheetId,title))",
        }),
      { operation: "get_workbook_metadata" },
    );
    this.workbook = response;
    this.tabTitles = new Set(
      (response.data.sheets || [])
        .map((sheet) => trim(sheet.properties?.title))
        .filter(Boolean)
        .map((title) => safeLower(title)),
    );
    return this.workbook;
  }

  hasTab(tabName) {
    return this.tabTitles.has(safeLower(tabName));
  }

  mergeHeaders(existingHeaders = [], expectedHeaders = []) {
    const lower = safeLower;
    const merged = [...existingHeaders];
    for (const header of expectedHeaders) {
      if (!merged.some((existing) => lower(existing) === lower(header))) {
        merged.push(header);
      }
    }
    return merged;
  }

  headersNeedUpdate(existingHeaders = [], expectedHeaders = []) {
    const merged = this.mergeHeaders(existingHeaders, expectedHeaders);
    return merged.length !== existingHeaders.length ? merged : null;
  }

  async batchCreateTabs(tabNames = []) {
    const missing = tabNames.filter((tab) => !this.hasTab(tab));
    if (!missing.length) {
      return [];
    }
    const sheets = this.sheets();
    this.stats.batchUpdateCalls += 1;
    await this.withSheetsQuotaRetry(
      () =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
          },
        }),
      { operation: `batch_create_tabs:${missing.join(",")}` },
    );
    for (const tab of missing) {
      this.tabTitles.add(safeLower(tab));
    }
    return missing;
  }

  async batchReadHeaderRows(tabSpecs = []) {
    if (!tabSpecs.length) {
      return [];
    }
    const sheets = this.sheets();
    const ranges = tabSpecs.map(({ tab, columns }) => {
      const width = Math.max(columns.length, 1);
      return `${tab}!A1:${sheetEndColumnLetter(width)}1`;
    });
    this.stats.batchGetCalls += 1;
    await this.pauseBetweenReads();
    const response = await this.withSheetsQuotaRetry(
      () =>
        sheets.spreadsheets.values.batchGet({
          spreadsheetId: this.spreadsheetId,
          ranges,
        }),
      { operation: "batch_read_headers" },
    );
    return (response.data.valueRanges || []).map((entry) => entry.values || []);
  }

  async updateHeaderRow(tab, headers) {
    if (!headers.length) {
      return;
    }
    const sheets = this.sheets();
    const lastCol = sheetEndColumnLetter(headers.length);
    this.stats.valuesUpdateCalls += 1;
    await this.withSheetsQuotaRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${tab}!A1:${lastCol}1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [headers] },
        }),
      { operation: `update_headers:${tab}` },
    );
    this.headersByTab.set(safeLower(tab), headers);
  }

  async prepareTabs(tabSpecs = []) {
    await this.fetchWorkbook();
    const created = await this.batchCreateTabs(tabSpecs.map((spec) => spec.tab));
    if (created.length > 0) {
      await this.fetchWorkbook(true);
    }

    const headerRows = await this.batchReadHeaderRows(tabSpecs);
    const headerUpdates = [];
    for (let index = 0; index < tabSpecs.length; index += 1) {
      const { tab, columns } = tabSpecs[index];
      const existing = headerRows[index]?.[0] || [];
      const merged = this.mergeHeaders(existing, columns);
      this.headersByTab.set(safeLower(tab), merged);
      const needsWrite =
        existing.length === 0 || this.headersNeedUpdate(existing, columns) !== null;
      if (needsWrite) {
        headerUpdates.push({ tab, headers: merged });
      }
    }

    for (const update of headerUpdates) {
      await this.updateHeaderRow(update.tab, update.headers);
    }

    return {
      prepared: tabSpecs.length,
      createdTabs: created,
      headerUpdates: headerUpdates.length,
      stats: { ...this.stats },
    };
  }

  async readTabRecords(tab) {
    const sheets = this.sheets();
    this.stats.getTabValuesCalls += 1;
    await this.pauseBetweenReads();
    let values = [];
    try {
      const response = await this.withSheetsQuotaRetry(
        () =>
          sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${tab}!A1:ZZ5000`,
          }),
        { operation: `read_tab:${tab}` },
      );
      values = response.data.values || [];
    } catch {
      values = [];
    }
    return rowsToRecords(values);
  }

  async writeTabRecords(tab, columns, dataRows) {
    const sheets = this.sheets();
    const rows = [columns, ...dataRows.map((row) => columns.map((header) => String(row[header] ?? "").trim()))];
    const rowCount = Math.max(rows.length, 2);
    const lastCol = sheetEndColumnLetter(columns.length);
    this.stats.valuesUpdateCalls += 1;
    await this.withSheetsQuotaRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${tab}!A1:${lastCol}${rowCount}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rows },
        }),
      { operation: `write_tab:${tab}` },
    );
    return dataRows.length;
  }

  async writeMergedTab(tab, columns, nextRows, keyFields) {
    const existing = await this.readTabRecords(tab);
    const merged = upsertByKey(existing, nextRows, keyFields);
    await this.writeTabRecords(tab, columns, merged);
    return merged.length;
  }
}

export async function applyHistoryWorkbookWrites({
  auth,
  deps,
  masterSheetId,
  companyFolderId,
  fingerprint,
  writes,
  progressPath,
  onTabComplete,
}) {
  const writer = new HistoryWorkbookWriter(auth, deps, masterSheetId);
  await writer.fetchWorkbook();

  const tabSpecs = writes.map(([tab, columns]) => ({ tab, columns }));
  const progress = loadHistoryApplyProgress(progressPath, { masterSheetId, companyFolderId, fingerprint });
  const completed = new Set(progress.completedTabs || []);
  const pending = writes.filter(([tab]) => !completed.has(tab));

  if (pending.length > 0) {
    await writer.prepareTabs(tabSpecs);
  }

  const applied = [];
  for (const [tab, columns, rows, keys] of writes) {
    if (completed.has(tab)) {
      console.log(`[live] skip ${tab} (already applied for fingerprint ${fingerprint})`);
      applied.push({ tab, skipped: true, rowCount: rows.length });
      continue;
    }
    const rowCount = await writer.writeMergedTab(tab, columns, rows, keys);
    completed.add(tab);
    saveHistoryApplyProgress(progressPath, {
      masterSheetId,
      companyFolderId,
      fingerprint,
      completedTabs: [...completed],
    });
    if (typeof onTabComplete === "function") {
      onTabComplete({ tab, rowCount });
    }
    console.log(`[live] upserted ${rows.length} rows into ${tab} (${rowCount} total rows)`);
    applied.push({ tab, skipped: false, rowCount });
  }

  const allTabs = writes.map(([tab]) => tab);
  const allComplete = allTabs.every((tab) => completed.has(tab));
  if (allComplete) {
    clearHistoryApplyProgress(progressPath);
  }

  return {
    writer,
    applied,
    completedTabs: [...completed],
    allComplete,
    stats: writer.stats,
    resumedFrom: progress.completedTabs?.length || 0,
  };
}
